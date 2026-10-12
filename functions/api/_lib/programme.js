// Digital Match Day Programme: a 4-page programme per match. Registered fans
// read it online (four page images) or download the PDF. Files live in R2
// (binding PROGRAMME_BUCKET), everything else in D1. Staff upload and publish
// at /admin/programmes; scheduling needs no cron (checked on every request).
//
// Until the R2 bucket is connected, bucket(env) is null: the admin page says
// so, the public API reports { enabled: false } and /programme keeps showing
// the older single-image programme attached to the fixture.

let ready = false;
export async function ensureProgrammeSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS programmes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      opponent TEXT,
      competition TEXT,
      venue TEXT,
      kickoff_at TEXT,                    -- ISO 8601 UTC
      status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | published | hidden
      publish_at TEXT,                    -- UTC, used when status = 'scheduled'
      published_at TEXT,
      version INTEGER NOT NULL DEFAULT 0, -- bumps on every (re)upload
      pdf_key TEXT,
      pdf_size_bytes INTEGER,
      cover_key TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS programme_pages (
      programme_id INTEGER NOT NULL REFERENCES programmes(id),
      page_number INTEGER NOT NULL,
      image_key TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      PRIMARY KEY (programme_id, page_number)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS programme_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER NOT NULL REFERENCES programmes(id),
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS programme_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER NOT NULL,
      fan_id TEXT,                         -- members.id when signed in
      type TEXT NOT NULL,                  -- landing | open | page_view | download | link_click | share
      page INTEGER,
      link_id INTEGER,
      src TEXT,                            -- qr-gate, qr-screen, homepage, social…
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS programme_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by TEXT)`),
    // One-time sign-in codes for fans (only the hash is stored; ip_hash, never the raw IP).
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_login_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fan_login_codes_email ON fan_login_codes (email, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fan_login_codes_ip ON fan_login_codes (ip_hash, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_programmes_status ON programmes (status, kickoff_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_programme_events ON programme_events (programme_id, type, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_programme_events_fan ON programme_events (fan_id)`),
    db.prepare(`INSERT OR IGNORE INTO programme_settings (key, value) VALUES
      ('programme_enabled', 'true'), ('programme_session_days', '90'), ('programme_max_pdf_mb', '25'), ('programme_homepage_banner', 'true'),
      ('scan_auto_download', 'true')`),
  ]);
  // Sign-in emails also carry a one-tap link (QR campaigns); only its hash is stored.
  const cols = new Set((await db.prepare(`PRAGMA table_info(fan_login_codes)`).all()).results.map(r => r.name));
  if (!cols.has('link_token_hash')) await db.prepare(`ALTER TABLE fan_login_codes ADD COLUMN link_token_hash TEXT`).run();
  ready = true;
}

export const PAGE_COUNT = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_COVER_BYTES = 500 * 1024;
export const STATUSES = ['draft', 'scheduled', 'published', 'hidden'];

/** The R2 bucket, or null while it isn't connected yet. */
export const bucket = env => env.PROGRAMME_BUCKET || null;

export async function programmeSettings(db) {
  await ensureProgrammeSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM programme_settings`).all();
  const s = Object.fromEntries(results.map(r => [r.key, r.value]));
  return {
    enabled: s.programme_enabled !== 'false',
    sessionDays: Math.min(365, Math.max(1, Number(s.programme_session_days) || 90)),
    maxPdfMb: Math.min(50, Math.max(1, Number(s.programme_max_pdf_mb) || 25)),
    homepageBanner: s.programme_homepage_banner !== 'false',
    scanAutoDownload: s.scan_auto_download !== 'false',
  };
}

/** Published, or scheduled and its publish time has come. */
export function isLive(p, now = new Date()) {
  if (!p || !p.pdf_key) return false;
  if (p.status === 'published') return true;
  return p.status === 'scheduled' && !!p.publish_at && new Date(p.publish_at) <= now;
}
/** SQL for the same rule (bind the current time as an ISO string, twice not needed). */
export const LIVE_SQL = `pdf_key IS NOT NULL AND (status = 'published' OR (status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ?))`;

/**
 * The programme to show now: among live ones, the nearest upcoming kick-off,
 * otherwise the most recent past one. Also the next scheduled one that isn't
 * live yet (for a countdown).
 */
export async function getCurrentProgramme(db, now = new Date()) {
  await ensureProgrammeSchema(db);
  const iso = now.toISOString();
  const upcoming = await db.prepare(`SELECT * FROM programmes WHERE ${LIVE_SQL} AND kickoff_at >= ? ORDER BY kickoff_at ASC LIMIT 1`).bind(iso, iso).first();
  const current = upcoming || await db.prepare(`SELECT * FROM programmes WHERE ${LIVE_SQL} ORDER BY kickoff_at DESC, id DESC LIMIT 1`).bind(iso).first();
  const next = await db.prepare(`SELECT * FROM programmes WHERE status = 'scheduled' AND pdf_key IS NOT NULL AND publish_at > ? ORDER BY publish_at ASC LIMIT 1`).bind(iso).first();
  return { current: current || null, next: next || null };
}

export async function liveBySlug(db, slug, now = new Date()) {
  await ensureProgrammeSchema(db);
  const p = await db.prepare(`SELECT * FROM programmes WHERE slug = ?`).bind(String(slug || '').toLowerCase().slice(0, 120)).first();
  return isLive(p, now) ? p : null;
}

export function slugify(title, kickoffAt) {
  const base = String(title || 'programme').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'programme';
  const d = kickoffAt && !Number.isNaN(Date.parse(kickoffAt)) ? new Date(kickoffAt).toISOString().slice(0, 10) : '';
  return d ? `${base}-${d}` : base;
}
export async function ensureUniqueSlug(db, slug, exceptId = null) {
  let s = slug, i = 2;
  while (await db.prepare(`SELECT 1 FROM programmes WHERE slug = ? AND id IS NOT ?`).bind(s, exceptId).first()) s = `${slug}-${i++}`;
  return s;
}

export function r2Keys(slug, version) {
  const base = `programmes/${slug}/v${version}`;
  return {
    pdf: `${base}/programme.pdf`,
    cover: `${base}/cover.jpg`,
    pages: Array.from({ length: PAGE_COUNT }, (_, i) => `${base}/page-${i + 1}.jpg`),
  };
}

/** "Lobi-Stars-vs-Enyimba-Matchday-Programme.pdf" */
export function friendlyPdfName(p) {
  const t = String(p.title || 'Lobi Stars').replace(/&/g, 'and').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${t || 'Lobi-Stars'}-Matchday-Programme.pdf`;
}

/** Public fields for one programme. */
export function toPublic(p, origin = '') {
  return {
    slug: p.slug, title: p.title, opponent: p.opponent || '', competition: p.competition || '', venue: p.venue || '',
    kickoffAt: p.kickoff_at, publishAt: p.publish_at, version: p.version, pageCount: PAGE_COUNT, pdfSizeBytes: p.pdf_size_bytes || null,
    coverUrl: p.cover_key ? `${origin}/api/programme/${p.slug}/cover.jpg?v=${p.version}` : null,
  };
}

const STARTS = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
export const isPdf = bytes => STARTS(bytes, [0x25, 0x50, 0x44, 0x46, 0x2D]); // "%PDF-"
export const isJpeg = bytes => STARTS(bytes, [0xFF, 0xD8, 0xFF]);

/** Only https links (or a page on this site) for the quick links. */
export function cleanLinkUrl(u) {
  const s = String(u || '').trim();
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s.slice(0, 500);
  try { const x = new URL(s); return x.protocol === 'https:' ? x.href.slice(0, 500) : null; } catch { return null; }
}
export const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').trim();

/** Streams an R2 object, or 404. */
export async function streamObject(env, key, headers) {
  const b = bucket(env);
  const obj = b && key ? await b.get(key) : null;
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'X-Content-Type-Options': 'nosniff', ...headers } });
}

/** Records a reading event (never fails the request). */
export async function logEvent(db, { programmeId, fanId = null, type, page = null, linkId = null, src = null }) {
  try {
    await db.prepare(`INSERT INTO programme_events (programme_id, fan_id, type, page, link_id, src) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(programmeId, fanId, type, page, linkId, src ? String(src).replace(/[^a-z0-9-]/gi, '').slice(0, 30) || null : null).run();
  } catch (err) { console.error('[programme] event', err); }
}

/** Stats for the admin page. */
export async function programmeStats(db, id) {
  const one = sql => db.prepare(sql).bind(id);
  const [readers, counts, pages, links, srcs, newFans] = await db.batch([
    one(`SELECT COUNT(DISTINCT fan_id) AS n FROM programme_events WHERE programme_id = ? AND fan_id IS NOT NULL AND type IN ('open', 'page_view', 'download')`),
    one(`SELECT type, COUNT(*) AS n FROM programme_events WHERE programme_id = ? GROUP BY type`),
    one(`SELECT page, COUNT(*) AS n FROM programme_events WHERE programme_id = ? AND type = 'page_view' GROUP BY page`),
    one(`SELECT l.id, l.label, (SELECT COUNT(*) FROM programme_events e WHERE e.programme_id = l.programme_id AND e.type = 'link_click' AND e.link_id = l.id) AS clicks
         FROM programme_links l WHERE l.programme_id = ? ORDER BY l.sort_order`),
    one(`SELECT COALESCE(src, 'direct') AS src, COUNT(*) AS n FROM programme_events WHERE programme_id = ? AND type = 'landing' GROUP BY COALESCE(src, 'direct') ORDER BY n DESC`),
    db.prepare(`SELECT COUNT(*) AS n FROM members WHERE first_programme = ?`).bind(String(id)),
  ]);
  const by = Object.fromEntries(counts.results.map(r => [r.type, r.n]));
  const pageViews = Array.from({ length: PAGE_COUNT }, (_, i) => pages.results.find(r => r.page === i + 1)?.n || 0);
  return {
    uniqueReaders: readers.results[0]?.n || 0,
    landings: by.landing || 0, opens: by.open || 0, downloads: by.download || 0, shares: by.share || 0, linkClicks: by.link_click || 0,
    pageViews, links: links.results, sources: srcs.results, newFans: newFans.results[0]?.n || 0,
  };
}

/** Validates the match details from the admin form: { value } or { error }. */
export function cleanDetails(b) {
  const str = (v, n) => stripTags(v).slice(0, n);
  const out = { title: str(b.title, 120), opponent: str(b.opponent, 80), competition: str(b.competition, 80), venue: str(b.venue, 120), notes: str(b.notes, 1000) };
  const k = String(b.kickoffAt || '').trim();
  if (k && Number.isNaN(Date.parse(k))) return { error: 'Please enter a valid kick-off date and time.' };
  out.kickoffAt = k ? new Date(k).toISOString() : null;
  if (!out.title) return { error: 'Please enter the match title, e.g. "Lobi Stars vs Enyimba".' };
  return { value: out };
}
