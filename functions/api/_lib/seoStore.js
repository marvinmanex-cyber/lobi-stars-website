// SEO Scanner (Super Admins only): storage. Settings, target keywords,
// competitor domains, automation rules, scans, the crawled pages, issues and
// fixes, plus the daily figures kept for the dashboard. Search Console totals
// per page and per search phrase come from the Analytics sync (gsc_daily); the
// scanner adds what it needs on top (keyword + page pairs, PageSpeed, the
// optional licensed rank tracker). Indexed so the dashboard and the bell read
// few rows (Cloudflare's free plan: 5 million rows read a day for the whole site).
import { logAdminAction } from './adminSession.js';
import { roleOf } from './adminRoles.js';

const now = () => new Date().toISOString();
export const lagosDay = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10);
export const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

let ready = false;
export async function ensureSeoSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL UNIQUE, target_path TEXT, priority TEXT NOT NULL DEFAULT 'medium',
      confirmed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_competitors (domain TEXT PRIMARY KEY, note TEXT, created_at TEXT NOT NULL, created_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_rules (type TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off', scope TEXT NOT NULL DEFAULT 'all', daily_max INTEGER NOT NULL DEFAULT 5,
      notify TEXT NOT NULL DEFAULT 'email', updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_scans (id TEXT PRIMARY KEY, kind TEXT NOT NULL, trigger TEXT, started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL DEFAULT '{}',
      pages INTEGER NOT NULL DEFAULT 0, score INTEGER, counts TEXT, summary TEXT, started_by TEXT, updated_at TEXT, lock_until INTEGER)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_scans_started ON seo_scans (started_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_scans_open ON seo_scans (finished_at, started_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_scans_kind ON seo_scans (kind, started_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_pages (path TEXT PRIMARY KEY, status INTEGER, scanned_at TEXT, in_sitemap INTEGER NOT NULL DEFAULT 0, lastmod TEXT, data TEXT NOT NULL DEFAULT '{}')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_issues (id TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL, path TEXT, detail TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open', impact INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, fixed_at TEXT, ignored_reason TEXT, ignored_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_issues_status ON seo_issues (status, severity)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_fixes (id TEXT PRIMARY KEY, issue_id TEXT, type TEXT NOT NULL, path TEXT, status TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0,
      proposal TEXT, before TEXT, applied TEXT, note TEXT, created_by TEXT, created_at TEXT NOT NULL, applied_at TEXT, undone_at TEXT, checked_at TEXT, metrics TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_fixes_issue ON seo_fixes (issue_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_fixes_created ON seo_fixes (created_at)`),
    // Search Console keyword + page pairs (the target keywords only) and the licensed rank tracker.
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_ranks (date TEXT NOT NULL, keyword TEXT NOT NULL, source TEXT NOT NULL, device TEXT NOT NULL DEFAULT 'all', page TEXT,
      position REAL, clicks INTEGER, impressions INTEGER, PRIMARY KEY (date, keyword, source, device))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_speed (date TEXT NOT NULL, path TEXT NOT NULL, strategy TEXT NOT NULL, score INTEGER, lcp REAL, inp REAL, cls REAL, fcp REAL,
      PRIMARY KEY (date, path, strategy))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seo_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, day TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_alerts_kind_day ON seo_alerts (kind, day)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_issues_path ON seo_issues (path)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_seo_ranks_kw ON seo_ranks (keyword, date)`),
  ]);
  ready = true;
}

// ── Settings ──
export const SETTING_DEFAULTS = {
  rank_provider: 'off',            // off | dataforseo | serpapi (keys in env: DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD or SERPAPI_KEY)
  rank_country: 'Nigeria', rank_language: 'English',
  ai_daily_limit_usd: '1',         // SEO Scanner's own daily cap (the site-wide monthly AI budget also applies)
  ai_monthly_limit_usd: '5',       // and its own monthly cap
  scan_hour: '3',                  // full scan at 03:00 Nigeria time
  alert_emails: '',                // extra addresses for alerts (the Super Admins always get them)
  developer_email: '',             // "Send to developer"
  weekly_report: '1',
};
export async function getSeoSettings(db) {
  await ensureSeoSchema(db);
  const out = { ...SETTING_DEFAULTS };
  for (const r of (await db.prepare(`SELECT key, value FROM seo_settings`).all()).results) out[r.key] = r.value ?? '';
  return out;
}
export async function setSeoSetting(db, key, value, by = 'system') {
  await ensureSeoSchema(db);
  await db.prepare(`INSERT INTO seo_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(key, value == null ? null : String(value), by, now()).run();
}

// ── Target keywords ──
// Suggestions until a Super Admin confirms them (no academy or women's team: the club has neither).
export const SEED_KEYWORDS = [
  ['Lobi Stars', '/', 'high'], ['Lobi Stars FC', '/', 'high'], ['Lobi Stars news', '/news/', 'high'], ['Lobi Stars fixtures', '/fixtures/', 'high'],
  ['Lobi Stars results', '/fixtures/', 'medium'], ['Lobi Stars squad', '/squad/', 'medium'], ['Lobi Stars tickets', '/tickets/', 'high'],
  ['Lobi Stars live', '/watch/', 'medium'], ['McCarthy Stadium Makurdi', '/club/stadium/', 'medium'], ['NNL Conference D table', '/table/', 'medium'], ['Pride of Benue', '/', 'low'],
];
export const PRIORITIES = ['high', 'medium', 'low'];
const cleanKeyword = s => String(s || '').replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const cleanPath = p => { const s = String(p || '').trim(); if (!s) return null; try { const u = new URL(s, 'https://lobistarsfc.com'); return u.pathname.replace(/\/?$/, '/'); } catch { return null; } };
export async function listKeywords(db) {
  await ensureSeoSchema(db);
  const rows = (await db.prepare(`SELECT * FROM seo_keywords ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, keyword`).all()).results;
  if (rows.length) return rows;
  // First visit: the suggestions, marked unconfirmed.
  const at = now();
  await db.batch(SEED_KEYWORDS.map(([k, p, pr]) => db.prepare(`INSERT OR IGNORE INTO seo_keywords (keyword, target_path, priority, confirmed, created_at, created_by) VALUES (?, ?, ?, 0, ?, 'Suggested')`).bind(k, p, pr, at)));
  return (await db.prepare(`SELECT * FROM seo_keywords ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, keyword`).all()).results;
}
export async function saveKeyword(db, admin, { id = null, keyword, target_path, priority = 'medium', confirmed = true }) {
  await ensureSeoSchema(db);
  const k = cleanKeyword(keyword);
  if (k.length < 2) return { error: 'Type the search phrase (at least 2 characters).', status: 400 };
  if (/academy|women'?s team|ladies/i.test(k)) return { error: 'Lobi Stars has no academy or women’s team, so that phrase is not used.', status: 400 };
  const path = cleanPath(target_path);
  const pr = PRIORITIES.includes(priority) ? priority : 'medium';
  if (id) await db.prepare(`UPDATE seo_keywords SET keyword = ?, target_path = ?, priority = ?, confirmed = ? WHERE id = ?`).bind(k, path, pr, confirmed ? 1 : 0, Number(id)).run();
  else {
    const dup = await db.prepare(`SELECT id FROM seo_keywords WHERE lower(keyword) = lower(?)`).bind(k).first();
    if (dup) return { error: 'That phrase is already on the list.', status: 409 };
    await db.prepare(`INSERT INTO seo_keywords (keyword, target_path, priority, confirmed, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`).bind(k, path, pr, confirmed ? 1 : 0, now(), admin.name).run();
  }
  await logAdminAction(db, admin, 'seo_keyword', `${id ? 'Changed' : 'Added'} the SEO target keyword "${k}"${path ? ` → ${path}` : ''} (${pr} priority)`);
  return { ok: true };
}
export async function deleteKeyword(db, admin, id) {
  await ensureSeoSchema(db);
  const k = await db.prepare(`SELECT keyword FROM seo_keywords WHERE id = ?`).bind(Number(id)).first();
  if (!k) return { error: 'Not found.', status: 404 };
  await db.prepare(`DELETE FROM seo_keywords WHERE id = ?`).bind(Number(id)).run();
  await logAdminAction(db, admin, 'seo_keyword', `Removed the SEO target keyword "${k.keyword}"`);
  return { ok: true };
}

// ── Competitor domains (for comparison in the licensed rank tracker only) ──
export async function listCompetitors(db) {
  await ensureSeoSchema(db);
  return (await db.prepare(`SELECT * FROM seo_competitors ORDER BY domain`).all()).results;
}
export async function saveCompetitor(db, admin, { domain, note = '' }) {
  await ensureSeoSchema(db);
  let d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { error: 'Type a website address, e.g. kwaraunited.com', status: 400 };
  if (d.endsWith('lobistarsfc.com')) return { error: 'That is our own website.', status: 400 };
  await db.prepare(`INSERT INTO seo_competitors (domain, note, created_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET note = excluded.note`).bind(d, String(note || '').slice(0, 120), now(), admin.name).run();
  await logAdminAction(db, admin, 'seo_competitor', `Added the competitor website ${d} to the SEO Scanner`);
  return { ok: true };
}
export async function deleteCompetitor(db, admin, domain) {
  await ensureSeoSchema(db);
  await db.prepare(`DELETE FROM seo_competitors WHERE domain = ?`).bind(String(domain || '')).run();
  await logAdminAction(db, admin, 'seo_competitor', `Removed the competitor website ${domain} from the SEO Scanner`);
  return { ok: true };
}

/** Who may use the SEO Scanner: the Super Admins only (checked on every request). */
export const isSeoAdmin = admin => !!admin && roleOf(admin) === 'super_admin';
export { now };
