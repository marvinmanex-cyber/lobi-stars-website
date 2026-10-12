// QR advert campaigns for the Match Day Programme. Each printed or posted QR
// code is a short link lobistarsfc.com/p/<code> (e.g. /p/gate) that goes to
// the scan landing page /programme/scan?c=<code>. Every step is counted per
// campaign in qr_events: scan, landing, signin_started, signin_completed,
// download, read. Only the campaign, the programme and a coarse device type
// are stored: never IP addresses, emails or user agents. Codes can never be
// changed or deleted, because printed QR codes must keep working.
import { getCurrentProgramme } from './programme.js';

export const CHANNELS = ['poster', 'screen', 'social', 'whatsapp', 'radio', 'flyer', 'sponsor', 'other'];
export const EVENT_TYPES = ['scan', 'landing', 'signin_started', 'signin_completed', 'download', 'read'];
export const RESERVED = ['admin', 'api', 'programme', 'p', 'scan', 'confirm', 'login'];
export const CODE_RE = /^[a-z0-9-]{3,12}$/;
const SEED = [
  ['gate', 'Stadium gate posters', 'poster'], ['screen', 'Stadium big screen', 'screen'], ['social', 'Social media', 'social'],
  ['status', 'WhatsApp status', 'whatsapp'], ['radio', 'Lobi Stars Radio', 'radio'], ['flyer', 'Flyers and handbills', 'flyer'],
  ['kiosk', 'Food kiosk', 'poster'],
];

let ready = false;
export async function ensureQrSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      channel TEXT NOT NULL,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      programme_id INTEGER,
      fan_id TEXT,
      type TEXT NOT NULL,
      device TEXT,
      in_app INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_events_campaign ON qr_events (campaign_id, type, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_events_programme ON qr_events (programme_id, type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_campaigns_code ON qr_campaigns (code)`),
    ...SEED.map(([code, label, channel]) => db.prepare(`INSERT OR IGNORE INTO qr_campaigns (code, label, channel, created_by) VALUES (?, ?, ?, 'setup')`).bind(code, label, channel)),
  ]);
  ready = true;
}

/** { device: android | ios | desktop | other, inApp } from a user agent (nothing is stored but these two). */
export function parseDevice(ua) {
  const s = String(ua || '');
  const device = /android/i.test(s) ? 'android' : /iphone|ipad|ipod/i.test(s) ? 'ios' : /windows|macintosh|linux|cros/i.test(s) ? 'desktop' : 'other';
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|musical_ly/.test(s);
  return { device, inApp };
}

/** Link previews and robots (WhatsApp, Facebook, crawlers…) and anything that isn't a GET. */
export function isBotOrPreview(ua, method = 'GET') {
  if (String(method).toUpperCase() !== 'GET') return true;
  return /bot|crawler|spider|facebookexternalhit|WhatsApp\/|Twitterbot|Slackbot|TelegramBot|Googlebot|HeadlessChrome|curl|python-requests/i.test(String(ua || ''));
}

export const validSrc = v => (typeof v === 'string' && /^[a-z0-9-]{1,20}$/.test(v) ? v : null);

/** Codes for new campaigns: 5 characters without look-alikes (no i, l, o, 0, 1). */
export function randomCode(n = 5) {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(n * 2));
  let out = '';
  for (const b of buf) { if (b < 248) out += A[b % 31]; if (out.length === n) break; } // 248 = 8 x 31, no bias
  return out.length === n ? out : randomCode(n);
}

/**
 * Records a campaign step. Never throws; when `waitUntil` is given it runs in
 * the background so it can't slow the response.
 * extras: { request, fanId, programmeId, device, inApp }
 */
export function logCampaignEvent(env, src, type, extras = {}, waitUntil = null) {
  const job = (async () => {
    try {
      const code = validSrc(src);
      if (!code || !EVENT_TYPES.includes(type)) return;
      const db = env.DB;
      await ensureQrSchema(db);
      const c = await db.prepare(`SELECT id FROM qr_campaigns WHERE code = ?`).bind(code).first();
      let programmeId = extras.programmeId ?? null;
      if (programmeId === null) programmeId = (await getCurrentProgramme(db).catch(() => ({ current: null }))).current?.id ?? null;
      const d = extras.request ? parseDevice(extras.request.headers.get('User-Agent')) : { device: extras.device || null, inApp: !!extras.inApp };
      await db.prepare(`INSERT INTO qr_events (campaign_id, programme_id, fan_id, type, device, in_app) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(c?.id ?? null, programmeId, extras.fanId ?? null, type, d.device, d.inApp ? 1 : 0).run();
    } catch (err) {
      console.error('[qr] event', err);
    }
  })();
  if (waitUntil) { waitUntil(job); return Promise.resolve(); }
  return job;
}

/** Funnel numbers for a filter: { campaignId?, programmeId?, from?, to? } (ISO UTC). */
export async function qrStats(db, f = {}) {
  await ensureQrSchema(db);
  const where = [], binds = [];
  if (f.campaignId) { where.push('e.campaign_id = ?'); binds.push(f.campaignId); }
  if (f.programmeId) { where.push('e.programme_id = ?'); binds.push(f.programmeId); }
  if (f.from) { where.push('e.created_at >= ?'); binds.push(sqlTime(f.from)); }
  if (f.to) { where.push('e.created_at < ?'); binds.push(sqlTime(f.to)); }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const AND = where.length ? `${W} AND` : 'WHERE';
  const fanWhere = [], fanBinds = [];
  if (f.from) { fanWhere.push('m.created_at >= ?'); fanBinds.push(sqlTime(f.from)); }
  if (f.to) { fanWhere.push('m.created_at < ?'); fanBinds.push(sqlTime(f.to)); }
  if (f.programmeId) { fanWhere.push('m.first_programme = ?'); fanBinds.push(String(f.programmeId)); }
  const [types, devices, inApp, perCampaign, perDay, newFans] = await db.batch([
    db.prepare(`SELECT e.type, COUNT(*) AS n FROM qr_events e ${W} GROUP BY e.type`).bind(...binds),
    db.prepare(`SELECT COALESCE(e.device, 'other') AS device, COUNT(*) AS n FROM qr_events e ${AND} e.type = 'scan' GROUP BY COALESCE(e.device, 'other')`).bind(...binds),
    db.prepare(`SELECT COALESCE(SUM(e.in_app), 0) AS n FROM qr_events e ${AND} e.type = 'scan'`).bind(...binds),
    db.prepare(`SELECT e.campaign_id, e.type, COUNT(*) AS n FROM qr_events e ${W} GROUP BY e.campaign_id, e.type`).bind(...binds),
    db.prepare(`SELECT substr(e.created_at, 1, 10) AS day, e.type, COUNT(*) AS n FROM qr_events e ${W} GROUP BY day, e.type ORDER BY day`).bind(...binds),
    db.prepare(`SELECT m.first_src AS code, COUNT(*) AS n FROM members m WHERE m.first_src IS NOT NULL ${fanWhere.length ? `AND ${fanWhere.join(' AND ')}` : ''} GROUP BY m.first_src`).bind(...fanBinds),
  ]);
  const by = Object.fromEntries(EVENT_TYPES.map(t => [t, 0]));
  for (const r of types.results) by[r.type] = r.n;
  const campaigns = {};
  for (const r of perCampaign.results) {
    const k = r.campaign_id ?? 'unknown';
    campaigns[k] ||= Object.fromEntries(EVENT_TYPES.map(t => [t, 0]));
    campaigns[k][r.type] = r.n;
  }
  const days = {};
  for (const r of perDay.results) { days[r.day] ||= Object.fromEntries(EVENT_TYPES.map(t => [t, 0])); days[r.day][r.type] = r.n; }
  const newFansByCode = Object.fromEntries(newFans.results.map(r => [r.code, r.n]));
  return {
    funnel: by,
    conversion: by.scan ? by.download / by.scan : 0,
    devices: Object.fromEntries(devices.results.map(r => [r.device, r.n])),
    inAppShare: by.scan ? (inApp.results[0]?.n || 0) / by.scan : 0,
    perCampaign: campaigns,
    perDay: Object.entries(days).map(([day, v]) => ({ day, ...v })),
    newFansByCode,
  };
}
// D1 datetime('now') format: "YYYY-MM-DD HH:MM:SS" (UTC).
const sqlTime = iso => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
