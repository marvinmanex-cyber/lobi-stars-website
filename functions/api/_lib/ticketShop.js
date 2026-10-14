// Ticket sales on top of the existing ticket system (events, orders, tickets,
// Paystack, QR emails, the gate scanner):
//  - league_ticket_settings: per match capacity per stand, sale open/close,
//    on/off switch, most tickets per order.
//  - league_ticket_orders: one payment for several matches. Each match line
//    is an ordinary `orders` row (orders.basket_id), so tickets, /verify and
//    the gate work exactly as before.
// Seats are held atomically: the order row is only inserted if the seats
// sold plus seats held by unpaid orders (30 minutes) still fit.
import { lagosParts } from './fixtureCard.js';
import { randomId } from './crypto.js';
import { ensureTable, listMatches, toSummary } from './matchCentre.js';
import { ticketState, TIERS, CAP_COL, TIER_LABELS, naira } from './tickets/rules.js';
import { fulfillOrder } from './fulfillOrder.js';
import { sendEmail, ticketBlocksHtml } from './email.js';

export const HOLD_MINUTES = 30;

let ready = false;
export async function ensureTicketShopSchema(db) {
  if (ready) return;
  await ensureTable(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS league_ticket_settings (
      event_id TEXT PRIMARY KEY,
      vip_capacity INTEGER, premium_capacity INTEGER, regular_capacity INTEGER,
      sale_opens_at TEXT, sale_closes_at TEXT,
      max_per_order INTEGER NOT NULL DEFAULT 10,
      is_on_sale INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS league_ticket_orders (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, buyer_phone TEXT NOT NULL,
      total_kobo INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')), paid_at TEXT, emailed_at TEXT, refunded_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_league_ticket_orders_email ON league_ticket_orders (buyer_email)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
  ]);
  const { results } = await db.prepare(`PRAGMA table_info(orders)`).all();
  const have = new Set(results.map(c => c.name));
  if (!have.has('basket_id')) await db.prepare(`ALTER TABLE orders ADD COLUMN basket_id TEXT`).run();
  if (!have.has('refunded_at')) await db.prepare(`ALTER TABLE orders ADD COLUMN refunded_at TEXT`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_basket ON orders (basket_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_event_tier ON orders (event_id, tier, payment_status)`).run();
  // Matches already priced when this switch was added stay on sale (the club
  // had put them on sale); every other match starts switched off.
  const done = await db.prepare(`SELECT 1 FROM settings WHERE key = 'ticket_switch_initialised'`).first();
  if (!done) {
    await db.prepare(`INSERT OR IGNORE INTO league_ticket_settings (event_id, is_on_sale, updated_by)
      SELECT id, 1, 'setup' FROM events WHERE active = 1 AND (vip_price_kobo > 0 OR premium_price_kobo > 0 OR regular_price_kobo > 0)`).run();
    await db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('ticket_switch_initialised', ?)`).bind(new Date().toISOString()).run();
  }
  ready = true;
}

/**
 * Seats sold (valid or used tickets) plus seats held by unpaid orders, per
 * event and stand. (No "IN (…)" lists: D1 allows at most 100 values per query.)
 */
export async function soldCounts(db) {
  const { results } = await db.prepare(`
    SELECT event_id, tier, SUM(n) AS n FROM (
      SELECT event_id, tier, COUNT(*) AS n FROM tickets WHERE status != 'void' GROUP BY event_id, tier
      UNION ALL
      SELECT event_id, tier, SUM(quantity) AS n FROM orders WHERE payment_status = 'pending' AND created_at > datetime('now', '-${HOLD_MINUTES} minutes') GROUP BY event_id, tier
    ) GROUP BY event_id, tier`).all();
  const out = new Map();
  for (const r of results) {
    if (!out.has(r.event_id)) out.set(r.event_id, {});
    out.get(r.event_id)[r.tier] = r.n;
  }
  return out;
}

/** Ticket settings of every match (one row per match: a small table). */
export async function settingsFor(db) {
  const { results } = await db.prepare(`SELECT * FROM league_ticket_settings`).all();
  return new Map(results.map(r => [r.event_id, r]));
}

/** Matchday numbers of linked league fixtures (event id -> matchday). */
async function matchdays(db) {
  try {
    const { results } = await db.prepare(`SELECT event_id, matchday, status FROM league_fixtures WHERE event_id IS NOT NULL`).all();
    return new Map(results.map(r => [r.event_id, r]));
  } catch { return new Map(); }
}

/**
 * Adds { ticket, matchday } to public match summaries (homepage, /fixtures,
 * /api/matches). Never fails the page: on error the matches come back as they were.
 */
export async function decorateMatches(env, summaries, rows = null) {
  try {
    const db = env.DB;
    await ensureTicketShopSchema(db);
    const [settings, sold, md] = await Promise.all([settingsFor(db), soldCounts(db), matchdays(db)]);
    const byId = new Map((rows || []).map(r => [r.id, r]));
    return summaries.map(m => {
      const row = byId.get(m.id) || m;
      const t = ticketState({ ...row, ...m, is_home: m.is_home }, settings.get(m.id), sold.get(m.id) || {});
      const fromKobo = t.tiers.length ? Math.min(...t.tiers.map(x => x.priceKobo)) : null;
      const league = md.get(m.id);
      return { ...m, matchday: league?.matchday ?? null, league_status: league?.status || null,
        ticket: { state: t.state, fromKobo, opensAt: t.opensAt || null, left: t.tiers.some(x => x.remaining !== null) ? t.tiers.reduce((s, x) => s + (x.remaining ?? 0), 0) : null } };
    });
  } catch (err) {
    console.error('[tickets] decorate', err);
    return summaries;
  }
}

/** Every visible match with its ticket state, for /tickets and the basket checks. */
export async function catalogue(env) {
  const db = env.DB;
  await ensureTicketShopSchema(db);
  const rows = await listMatches(db);
  const [settings, sold, md] = await Promise.all([settingsFor(db), soldCounts(db), matchdays(db)]);
  const map = new Map();
  for (const r of rows) {
    const summary = toSummary(r, r);
    const ticket = ticketState({ ...r, is_home: summary.is_home, status: summary.status }, settings.get(r.id), sold.get(r.id) || {});
    map.set(r.id, { event: { ...r, ...summary }, ticket, settings: settings.get(r.id) || null, matchday: md.get(r.id)?.matchday ?? null });
  }
  return map;
}

/**
 * Holds the seats of one basket line by inserting its pending order, but only
 * if they still fit (one SQL statement, so two buyers can't both get the last seat).
 * Returns the statement (for db.batch).
 */
export function holdLineStatement(db, { orderId, basketId, eventId, tier, quantity, unitKobo, buyer, reference }) {
  const cap = CAP_COL[tier];
  return db.prepare(`INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, basket_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
    WHERE (SELECT ${cap} FROM league_ticket_settings WHERE event_id = ?) IS NULL
       OR (SELECT COUNT(*) FROM tickets WHERE event_id = ? AND tier = ? AND status != 'void')
        + (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE event_id = ? AND tier = ? AND payment_status = 'pending' AND created_at > datetime('now', '-${HOLD_MINUTES} minutes'))
        + ? <= (SELECT ${cap} FROM league_ticket_settings WHERE event_id = ?)`)
    .bind(orderId, eventId, buyer.name, buyer.email, buyer.phone, tier, quantity, unitKobo, unitKobo * quantity, reference, basketId,
      eventId, eventId, tier, eventId, tier, quantity, eventId);
}

export const newBasketIds = () => ({ basketId: randomId('LS-BSK', 10), reference: randomId('LSBAS', 12) });

/**
 * A basket was paid: marks it paid (once), issues every line's tickets (each
 * line at most once, via fulfillOrder) and sends ONE email with all of them.
 * Safe to call again (webhook retries, the success page): nothing is duplicated,
 * and a failed email is retried on the next call.
 */
export async function fulfilBasket(env, basket, waitUntil) {
  const db = env.DB;
  await db.prepare(`UPDATE league_ticket_orders SET status = 'paid', paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ? AND status = 'pending'`).bind(basket.id).run();
  const { results: orders } = await db.prepare(`SELECT * FROM orders WHERE basket_id = ? ORDER BY rowid`).bind(basket.id).all();
  const lines = [];
  for (const o of orders) {
    const tickets = await fulfillOrder(env, o, null, { email: false });
    lines.push({ order: o, tickets });
  }
  const claim = await db.prepare(`UPDATE league_ticket_orders SET emailed_at = datetime('now') WHERE id = ? AND emailed_at IS NULL`).bind(basket.id).run();
  if (claim.meta.changes) {
    const send = sendBasketEmail(env, basket).catch(async err => {
      console.error('[tickets] basket email failed', err);
      await db.prepare(`UPDATE league_ticket_orders SET emailed_at = NULL WHERE id = ?`).bind(basket.id).run(); // retried next time
    });
    if (waitUntil) waitUntil(send); else await send;
  }
  return lines;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One email with every ticket of the basket (also used by "Resend email"). */
export async function sendBasketEmail(env, basket) {
  const db = env.DB;
  const { results: orders } = await db.prepare(`SELECT o.*, e.home_team, e.away_team, e.event_date, e.venue, e.competition FROM orders o JOIN events e ON e.id = o.event_id WHERE o.basket_id = ? AND o.payment_status = 'paid' ORDER BY e.event_date`).bind(basket.id).all();
  if (!orders.length) return;
  const sections = [];
  for (const o of orders) {
    const { results: tickets } = await db.prepare(`SELECT id FROM tickets WHERE order_id = ? AND status != 'void'`).bind(o.id).all();
    if (!tickets.length) continue;
    const event = { home_team: o.home_team, away_team: o.away_team, event_date: o.event_date, venue: o.venue, competition: o.competition };
    const fx = await db.prepare(`SELECT id FROM league_fixtures WHERE event_id = ?`).bind(o.event_id).first().catch(() => null);
    const cal = fx ? `https://lobistarsfc.com/api/league/calendar.ics?fixture=${fx.id}` : null;
    sections.push(`<h3 style="color:#0d1a33;margin:26px 0 8px;font-family:Arial,sans-serif;">${esc(o.home_team)} vs ${esc(o.away_team)}</h3>
      <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#333;"><b>Date:</b> ${esc(lagosParts(o.event_date)?.date || 'To be confirmed')}<br><b>Kick-off:</b> ${esc(lagosParts(o.event_date)?.time || 'TBC')}<br><b>Venue:</b> ${esc(o.venue)}${cal ? `<br><a href="${cal}">Add to calendar</a>` : ''}</p>
      ${ticketBlocksHtml({ order: o, event, tickets })}`);
  }
  const total = orders.reduce((s, o) => s + o.total_kobo, 0);
  const html = `<div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif;color:#111;">
    <h2 style="color:#0d1a33;">Your Lobi Stars match tickets</h2>
    <p>Hi ${esc(basket.buyer_name)},</p>
    <p>Your payment of <strong>${naira(total)}</strong> is confirmed. Order reference: <strong>${esc(basket.reference)}</strong>. Below is one QR code per ticket, for each match.</p>
    <p style="background:#f4f5f7;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;"><strong>At the gate:</strong> each QR code admits one person, once, and only on the day of its match. Have it ready on your phone (a screenshot works) or printed. Lost the email? Open lobistarsfc.com/tickets/lookup with your email and order reference.</p>
    ${sections.join('')}
    <p style="background:#FFF8E1;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;"><strong>On match day:</strong> order food and drinks to your seat from your phone. See the menu at <a href="https://lobistarsfc.com/food/">lobistarsfc.com/food</a>.</p>
    <p style="font-size:12px;color:#888;">Pride of Benue &middot; Lobi Stars Football Club</p>
  </div>`;
  await sendEmail(env, { to: basket.buyer_email, subject: `Your Lobi Stars tickets (${orders.length} match${orders.length === 1 ? '' : 'es'}) – ${basket.reference}`, html });
}

export { TIERS, TIER_LABELS };
