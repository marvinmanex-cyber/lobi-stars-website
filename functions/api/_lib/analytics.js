// First-party, privacy-friendly analytics. No raw IP addresses are stored.
//
// - Visitors who ACCEPT the cookie banner: page views carry a random browser
//   id (localStorage) plus a salted DAILY hash for counting unique visitors.
// - Visitors who REJECT (or haven't chosen): an anonymous page view only,
//   with no id and no hash.
// - Bots/crawlers and signed-in admin staff are never counted.

let ready = false;
export async function ensureAnalyticsSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS pageviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    referrer_host TEXT,
    country TEXT,
    city TEXT,
    device TEXT,
    is_new_visitor INTEGER NOT NULL DEFAULT 0
  )`).run();
  const { results } = await db.prepare(`PRAGMA table_info(pageviews)`).all();
  const have = new Set(results.map(r => r.name));
  for (const [name, type] of [
    ['visitor_hash', 'TEXT'], ['consent', 'INTEGER NOT NULL DEFAULT 1'], ['region', 'TEXT'], ['browser', 'TEXT'],
    ['utm_source', 'TEXT'], ['utm_medium', 'TEXT'], ['utm_campaign', 'TEXT'],
  ]) {
    if (!have.has(name)) await db.prepare(`ALTER TABLE pageviews ADD COLUMN ${name} ${type}`).run();
  }
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_pageviews_ts ON pageviews(ts)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS track_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      label TEXT,
      path TEXT,
      visitor_key TEXT,
      device TEXT,
      country TEXT,
      region TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_track_events_ts ON track_events(ts, name)`),
  ]);
  ready = true;
}

export const EVENT_NAMES = [
  'partner_click', 'commentary_click', 'watch_play', 'motm_vote', 'prediction_submit', 'ticket_purchase',
  'shop_click', 'programme_download', 'brochure_download', 'whatsapp_click',
  'commentary_play', 'commentary_pause', 'commentary_error', 'commentary_heartbeat',
];

const BOT_RE = /bot|crawl|spider|slurp|scrape|fetch|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp\/|telegrambot|embedly|bingpreview|python-|curl\/|wget|httpclient|monitor|uptime|axios|node-fetch|go-http/i;
export function isBot(ua) {
  return !ua || BOT_RE.test(ua);
}

export function browserOf(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

export function deviceOf(ua = '') {
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Salted hash that changes every day (Nigerian date), so visitors can't be followed across days. */
export async function dailyVisitorHash(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const day = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const salt = env.ANALYTICS_SALT || env.SESSION_SECRET || 'lobi-stars';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${ip}|${ua}`));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Records a server-side event (e.g. a completed ticket purchase). Never throws. */
export async function recordServerEvent(env, name, label = '', request = null) {
  try {
    await ensureAnalyticsSchema(env.DB);
    const cf = request?.cf || {};
    await env.DB.prepare(`INSERT INTO track_events (name, label, country, region) VALUES (?, ?, ?, ?)`)
      .bind(name, String(label).slice(0, 120), cf.country || null, cf.region || null).run();
  } catch { /* analytics must never break the site */ }
}
