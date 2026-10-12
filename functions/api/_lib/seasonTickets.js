// Season tickets: one pass per seat for every Lobi Stars home match of a
// season, in a stand (VIP Sitting, Cover Stand, Popular Stand). Bought with
// Paystack like match tickets; each pass has its own QR code (LS-SZN-…). At
// the gate the scanner admits a pass once per home match, only on a match
// day. Staff set the season, prices and how many passes each stand has in
// Admin › Commerce › Season Tickets; it is off until they switch it on.
import { randomId } from './crypto.js';
import { sendEmail } from './email.js';
import { captureContact, splitName } from './contacts.js';
import { isHomeGame } from './matchCentre.js';

export const TIERS = ['VIP', 'Premium', 'Regular'];
export const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Cover Stand', Regular: 'Popular Stand' };
export const MAX_PER_ORDER = 4;
const SITE = 'https://lobistarsfc.com';

let ready = false;
export async function ensureSeasonSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS season_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS season_orders (
      id TEXT PRIMARY KEY,                 -- LS-SZO-…
      season TEXT NOT NULL,
      tier TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_kobo INTEGER NOT NULL,
      total_kobo INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      buyer_phone TEXT NOT NULL,
      paystack_reference TEXT UNIQUE NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed
      emailed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS season_passes (
      id TEXT PRIMARY KEY,                 -- LS-SZN-… (in the QR code)
      order_id TEXT NOT NULL,
      season TEXT NOT NULL,
      tier TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'valid', -- valid | void
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS season_pass_scans (
      pass_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      station TEXT,
      PRIMARY KEY (pass_id, event_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_season_passes_order ON season_passes (order_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_season_orders_status ON season_orders (season, tier, payment_status)`),
  ]);
  ready = true;
}

/** { enabled, season, info, tiers: { VIP: { priceKobo, limit }, … } } */
export async function seasonSettings(db, defaultSeason = '') {
  await ensureSeasonSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM season_settings`).all();
  const s = Object.fromEntries(results.map(r => [r.key, r.value]));
  let tiers = {};
  try { tiers = JSON.parse(s.tiers || '{}'); } catch {}
  return {
    enabled: s.enabled === 'true',
    season: s.season || defaultSeason,
    info: s.info || '',
    tiers: Object.fromEntries(TIERS.map(t => [t, { priceKobo: Math.max(0, Number(tiers[t]?.priceKobo) || 0), limit: Math.max(0, Number(tiers[t]?.limit) || 0) }])),
  };
}

/** Passes sold (paid) and held (pending, last 30 minutes) per stand. */
export async function availability(db, s) {
  const { results } = await db.prepare(`SELECT tier, SUM(quantity) AS n FROM season_orders WHERE season = ?
      AND (payment_status = 'paid' OR (payment_status = 'pending' AND created_at > datetime('now', '-30 minutes'))) GROUP BY tier`).bind(s.season).all();
  return Object.fromEntries(TIERS.map(t => {
    const used = results.find(r => r.tier === t)?.n || 0;
    const { priceKobo, limit } = s.tiers[t];
    return [t, { tier: t, label: TIER_LABELS[t], priceKobo, limit, sold: used, remaining: limit ? Math.max(0, limit - used) : null, onSale: priceKobo > 0 }];
  }));
}

/** "2026/27" -> the season ends before 1 August 2027 (Nigerian football calendar). */
export const seasonEnd = season => { const m = /^(\d{4})\//.exec(String(season || '')); return m ? `${Number(m[1]) + 1}-08-01T00:00:00Z` : null; };

/** Home matches of the season still to come (for "covers N home matches"). */
export async function upcomingHomeMatches(db, season = '') {
  const end = seasonEnd(season) || '9999-12-31';
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date >= ? AND event_date < ? ORDER BY event_date`).bind(new Date(Date.now() - 3 * 3600e3).toISOString(), end).all();
  return results.filter(e => isHomeGame(e));
}

/** The home match being played today (Nigerian time), for the gate. */
export async function todaysHomeMatch(db, now = Date.now()) {
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date >= ? AND event_date <= ? ORDER BY event_date`)
    .bind(new Date(now - 10 * 3600e3).toISOString(), new Date(now + 14 * 3600e3).toISOString()).all();
  const day = d => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 10);
  return results.find(e => isHomeGame(e) && day(e.event_date) === day(now)) || null;
}

/** Marks a season order paid (once), creates its passes, emails them. */
export async function fulfilSeasonOrder(env, order, waitUntil) {
  const db = env.DB;
  const now = new Date().toISOString();
  const res = await db.prepare(`UPDATE season_orders SET payment_status = 'paid', paid_at = ? WHERE id = ? AND payment_status != 'paid'`).bind(now, order.id).run();
  if (!res.meta?.changes) return;
  const passes = Array.from({ length: order.quantity }, () => randomId('LS-SZN', 12));
  await db.batch(passes.map(id => db.prepare(`INSERT INTO season_passes (id, order_id, season, tier, holder_name) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, order.id, order.season, order.tier, order.buyer_name)));
  const n = splitName(order.buyer_name);
  await captureContact(env, { source: 'ticket_buyer', refTable: 'season_orders', refId: order.id, email: order.buyer_email, phone: order.buyer_phone, firstName: n.firstName, surname: n.surname, label: `Season ticket ${order.season}` });
  if (env.RESEND_API_KEY) {
    const send = sendEmail(env, { to: order.buyer_email, subject: `Your Lobi Stars season ticket${passes.length > 1 ? 's' : ''} ${order.season}`, html: seasonEmailHtml(order, passes) })
      .then(() => db.prepare(`UPDATE season_orders SET emailed = 1 WHERE id = ?`).bind(order.id).run())
      .catch(err => console.error('[season] email failed', err));
    if (waitUntil) waitUntil(send); else await send;
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function seasonEmailHtml(order, passes) {
  const cards = passes.map((id, i) => `<tr><td style="padding:10px 0;border-top:1px solid #e2e6ed">
    <table role="presentation" width="100%"><tr><td style="vertical-align:top">
      <div style="font-weight:bold;font-size:16px">Season ticket ${i + 1} of ${passes.length}</div>
      <div style="color:#5B6472;font-size:14px">${esc(TIER_LABELS[order.tier] || order.tier)} · ${esc(order.season)}</div>
      <div style="font-family:monospace;font-size:13px;margin-top:6px">${esc(id)}</div>
    </td><td align="right"><img src="${SITE}/api/qr/${esc(id)}" width="150" height="150" alt="QR code for ${esc(id)}" style="background:#fff;border:1px solid #e2e6ed;padding:6px;border-radius:6px"></td></tr></table>
  </td></tr>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#15181D;max-width:620px">
  <h2 style="margin:0 0 8px">Your Lobi Stars FC season ticket${passes.length > 1 ? 's' : ''}</h2>
  <p>Thank you, ${esc(order.buyer_name)}. Each QR code below gets one person into <b>every Lobi Stars home match of the ${esc(order.season)} season</b> in the ${esc(TIER_LABELS[order.tier] || order.tier)}. Show it at the gate (on your phone or printed); it can be used once per match.</p>
  <table role="presentation" width="100%">${cards}</table>
  <p style="color:#5B6472;font-size:13px">Order ${esc(order.id)} · Keep this email: anyone with the QR code can use it. Questions: info@lobistarsfc.com</p></div>`;
}

/** Gate scan of a season pass: admits once per home match, only on a match day. */
export async function scanSeasonPass(db, passId, station) {
  await ensureSeasonSchema(db);
  const pass = await db.prepare(`SELECT p.*, o.buyer_name FROM season_passes p JOIN season_orders o ON o.id = p.order_id WHERE p.id = ?`).bind(passId).first();
  if (!pass) return { status: 404, body: { valid: false, reason: 'Season ticket not found' } };
  if (pass.status !== 'valid') return { status: 409, body: { valid: false, reason: 'Season ticket void' } };
  const match = await todaysHomeMatch(db);
  if (!match) return { status: 409, body: { valid: false, reason: 'No Lobi Stars home match today' } };
  // A 2026/27 pass only works from July 2026 to July 2027.
  const y = Number((/^(\d{4})\//.exec(pass.season) || [])[1]);
  if (y && (match.event_date < `${y}-07-01` || match.event_date >= seasonEnd(pass.season))) {
    return { status: 409, body: { valid: false, reason: `This season ticket is for ${pass.season}, not this match` } };
  }
  const claim = await db.prepare(`INSERT INTO season_pass_scans (pass_id, event_id, station) VALUES (?, ?, ?) ON CONFLICT (pass_id, event_id) DO NOTHING`)
    .bind(pass.id, match.id, String(station || 'unknown').slice(0, 60)).run();
  if (!claim.meta?.changes) {
    const prev = await db.prepare(`SELECT scanned_at FROM season_pass_scans WHERE pass_id = ? AND event_id = ?`).bind(pass.id, match.id).first();
    return { status: 409, body: { valid: false, reason: `Already used for this match at ${prev?.scanned_at || 'an earlier time'}` } };
  }
  return { status: 200, body: { valid: true, ticket: { id: pass.id, tier: `${TIER_LABELS[pass.tier] || pass.tier} (season ${pass.season})`, buyer_name: pass.holder_name, home_team: match.home_team, away_team: match.away_team, event_date: match.event_date, venue: match.venue, season: true } } };
}
