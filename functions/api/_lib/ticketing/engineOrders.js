// Ticketing engine orders. The engine prices the order, takes the payment and issues the
// tickets; this site keeps a DISPLAY COPY in its usual tables (league_ticket_orders = the
// basket, orders = one row per match + stand, tickets = one row per ticket with the
// engine's token as its number), so the confirmation page, the ticket email, the PDF,
// "Find my tickets" and the gate's offline list work exactly as before.
import { engine, EngineError, fanMessage, uuid } from './engineClient.js';
import { ensureEngineSchema, logTicketing, intlPhone, isEngineToken } from './engineStore.js';
import { engineEvents, buildIndex } from './engineCatalogue.js';
import { sendBasketEmail } from '../ticketShop.js';
import { listMatches } from '../matchCentre.js';
import { naira } from '../tickets/rules.js';

const MAX_ROW = 10; // orders.quantity is 1..10: bigger lines are split (as today)

/** The price summary the tickets page shows, without local discounts (the engine sets the price). */
export function plainPricing(priced) {
  const byEvent = new Map();
  for (const l of priced.lines) {
    const m = byEvent.get(l.eventId) || { eventId: l.eventId, tickets: 0, adults: 0, children: 0, subtotalKobo: 0, discountKobo: 0, totalKobo: 0, label: null, reason: null, nudge: null, applied: [] };
    m.tickets += l.quantity; m.adults += l.quantity; m.subtotalKobo += l.totalKobo; m.totalKobo += l.totalKobo;
    byEvent.set(l.eventId, m);
  }
  return { ok: true, subtotalKobo: priced.totalKobo, discountKobo: 0, totalKobo: priced.totalKobo, label: null, matches: [...byEvent.values()] };
}

/**
 * Creates the order in the engine and its display copy here. priced: priceBasket's result on the
 * engine-fed catalogue. Returns { ok, authorizationUrl, totalKobo, free } or { ok: false, status, body }.
 */
export async function createEngineBasket(env, { cat, priced, buyer, basketId, reference, expectedTotalKobo, origin }) {
  const db = env.DB;
  await ensureEngineSchema(db);
  const items = [];
  for (const l of priced.lines) {
    const st = cat.get(l.eventId)?.engine?.stands.get(l.tier);
    if (!st) return { ok: false, status: 409, body: { error: 'Tickets for this match are not on sale.', eventId: l.eventId } };
    items.push({ event_id: String(cat.get(l.eventId).engine.ev.event_id), stand_id: String(st.stand_id), quantity: l.quantity });
  }
  const request = { client_reference: reference, season_bundle: false, items, buyer: { name: buyer.name, email: buyer.email, phone: intlPhone(buyer.phone) }, return_url: `${origin}/tickets/success/?basket=${encodeURIComponent(reference)}` };
  let o;
  try {
    o = await engine.createOrder(env, request, reference); // the reference is unique per attempt: safe idempotency key
  } catch (err) {
    await logTicketing(env, 'error', 'order_create_failed', { reference, code: err.code, status: err.status });
    const soldOut = /sold_out|not_available|insufficient|capacity/.test(err.code || '');
    return { ok: false, status: soldOut ? 409 : err instanceof EngineError && err.status >= 400 && err.status < 500 ? 400 : 502, body: { error: fanMessage(err), soldOut } };
  }
  const total = Math.round(Number(o.amount_total_kobo));
  if (!Number.isInteger(total) || total < 0 || (o.currency && o.currency !== 'NGN')) {
    await logTicketing(env, 'error', 'order_bad_response', { reference });
    return { ok: false, status: 502, body: { error: 'Payment could not be started. Please try again.' } };
  }
  // The engine's price differs from what the fan was shown: nothing is paid, the fan sees the new price first.
  if (expectedTotalKobo !== null && expectedTotalKobo !== undefined && Number(expectedTotalKobo) !== total) {
    await logTicketing(env, 'info', 'order_repriced', { reference, shown: Number(expectedTotalKobo), engine: total });
    return { ok: false, status: 409, body: { code: 'repriced', error: `The price has changed to ${naira(total)}. Check your order and press Pay again.`, pricing: pricingFromEngine(o, cat) } };
  }

  // The display copy: the basket and one orders row per match + stand (split in tens, as today).
  const localOf = new Map(priced.lines.map(l => [`${cat.get(l.eventId).engine.ev.event_id}|${cat.get(l.eventId).engine.stands.get(l.tier).stand_id}`, l]));
  const stmts = [db.prepare(`INSERT INTO league_ticket_orders (id, reference, buyer_name, buyer_email, buyer_phone, total_kobo, subtotal_kobo, discount_kobo, backend, engine_order_id, engine_status, engine_payment_ref, engine_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'engine', ?, ?, ?, ?)`).bind(basketId, reference, buyer.name, buyer.email, buyer.phone, total, total, String(o.order_id), String(o.status || 'pending_payment'), o.payment?.reference || null, o.expires_at || null)];
  let n = 0;
  for (const line of o.lines || []) {
    const l = localOf.get(`${line.event_id}|${line.stand_id}`);
    if (!l) continue;
    const unit = Math.round(Number(line.unit_price_kobo) || 0);
    for (let left = Number(line.quantity) || 0; left > 0; left -= MAX_ROW) {
      const q = Math.min(MAX_ROW, left); n++;
      stmts.push(db.prepare(`INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, basket_id, engine_event_id, engine_stand_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).bind(`${basketId}-${n}`, l.eventId, buyer.name, buyer.email, buyer.phone, l.tier, q, unit, unit * q, `${reference}-${n}`, basketId, String(line.event_id), String(line.stand_id)));
    }
  }
  await db.batch(stmts);
  if (o.status === 'paid') { // nothing to pay (free stands): the engine issued the tickets at once
    await applyEngineOrder(env, o, o.tickets || [], {});
    return { ok: true, free: true, totalKobo: total };
  }
  const url = o.payment?.authorization_url;
  if (!url || !/^https:\/\//.test(url)) {
    await logTicketing(env, 'error', 'order_no_payment_url', { reference });
    await db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ?`).bind(basketId).run();
    return { ok: false, status: 502, body: { error: 'Payment could not be started. Please try again.' } };
  }
  return { ok: true, authorizationUrl: url, totalKobo: total };
}

function pricingFromEngine(o, cat) {
  const byLocal = new Map();
  for (const [id, c] of cat) if (c.engine) byLocal.set(String(c.engine.ev.event_id), id);
  const matches = new Map();
  for (const l of o.lines || []) {
    const eventId = byLocal.get(String(l.event_id)); if (!eventId) continue;
    const m = matches.get(eventId) || { eventId, tickets: 0, adults: 0, children: 0, subtotalKobo: 0, discountKobo: 0, totalKobo: 0, label: null, reason: null, nudge: null, applied: [] };
    m.tickets += Number(l.quantity) || 0; m.adults = m.tickets; m.subtotalKobo += Number(l.line_total_kobo) || 0; m.totalKobo = m.subtotalKobo;
    matches.set(eventId, m);
  }
  const total = Math.round(Number(o.amount_total_kobo) || 0);
  return { subtotalKobo: total, discountKobo: 0, totalKobo: total, label: null, matches: [...matches.values()] };
}

/** The local basket of an engine order (by our reference, or the engine's order id). */
export async function basketForOrder(db, o) {
  await ensureEngineSchema(db);
  if (o?.client_reference) { const b = await db.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(String(o.client_reference)).first(); if (b) return b; }
  if (o?.order_id) return db.prepare(`SELECT * FROM league_ticket_orders WHERE engine_order_id = ?`).bind(String(o.order_id)).first();
  return null;
}

const TICKET_STATUS = { valid: 'valid', scanned: 'used', void: 'void' };

/**
 * Applies an engine order (from a callback, a poll or a lookup) to the display copy. Safe to repeat.
 * Paid: basket + lines paid, one tickets row per engine ticket (token = ticket number), ONE email.
 * failed / expired: the pending basket fails. refunded: everything void. partially_refunded and
 * ticket.voided / ticket.reissued: each ticket takes the status the engine gives it.
 * Returns { ok, basket, unmatched? }.
 */
export async function applyEngineOrder(env, o, tickets, { waitUntil = null, email = true } = {}) {
  const db = env.DB;
  const basket = await basketForOrder(db, o);
  if (!basket) { await logTicketing(env, 'error', 'unmatched_order', { order: String(o?.order_id || ''), ref: String(o?.client_reference || '') }); return { ok: false, unmatched: true }; }
  const status = String(o.status || '');
  const stmts = [db.prepare(`UPDATE league_ticket_orders SET engine_status = ?, engine_order_id = COALESCE(engine_order_id, ?) WHERE id = ?`).bind(status || null, o.order_id ? String(o.order_id) : null, basket.id)];
  if (status === 'failed' || status === 'expired') {
    stmts.push(db.prepare(`UPDATE league_ticket_orders SET status = 'failed' WHERE id = ? AND status = 'pending'`).bind(basket.id));
    stmts.push(db.prepare(`UPDATE orders SET payment_status = 'failed' WHERE basket_id = ? AND payment_status = 'pending'`).bind(basket.id));
    await db.batch(stmts);
    return { ok: true, basket };
  }
  if (['paid', 'refunded', 'partially_refunded'].includes(status)) {
    stmts.push(db.prepare(`UPDATE league_ticket_orders SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status IN ('pending', 'failed')`).bind(o.paid_at || new Date().toISOString(), basket.id));
    stmts.push(db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE basket_id = ? AND payment_status IN ('pending', 'failed')`).bind(o.paid_at || new Date().toISOString(), basket.id));
  }
  await db.batch(stmts);
  if (tickets?.length) await storeTickets(env, basket, tickets);
  if (status === 'refunded') {
    await db.batch([
      db.prepare(`UPDATE league_ticket_orders SET status = 'refunded', refunded_at = COALESCE(refunded_at, datetime('now')) WHERE id = ?`).bind(basket.id),
      db.prepare(`UPDATE orders SET refunded_at = COALESCE(refunded_at, datetime('now')) WHERE basket_id = ?`).bind(basket.id),
      db.prepare(`UPDATE tickets SET status = 'void' WHERE order_id IN (SELECT id FROM orders WHERE basket_id = ?) AND status != 'used'`).bind(basket.id),
    ]);
  }
  // One email with every ticket, once (a failed email is tried again next time).
  if (email && status === 'paid') {
    const fresh = await db.prepare(`SELECT * FROM league_ticket_orders WHERE id = ?`).bind(basket.id).first();
    const has = await db.prepare(`SELECT 1 FROM tickets WHERE order_id IN (SELECT id FROM orders WHERE basket_id = ?) LIMIT 1`).bind(basket.id).first();
    if (has) {
      const claim = await db.prepare(`UPDATE league_ticket_orders SET emailed_at = datetime('now') WHERE id = ? AND emailed_at IS NULL`).bind(basket.id).run();
      if (claim.meta.changes) {
        const send = sendBasketEmail(env, fresh).catch(async err => {
          await logTicketing(env, 'error', 'email_failed', { ref: basket.reference });
          await db.prepare(`UPDATE league_ticket_orders SET emailed_at = NULL WHERE id = ?`).bind(basket.id).run();
        });
        if (waitUntil) waitUntil(send); else await send;
      }
    }
  }
  return { ok: true, basket };
}

/** Saves the engine's tickets on the right local lines (match + stand). New tokens are added; known ones take the engine's status. */
export async function storeTickets(env, basket, tickets) {
  const db = env.DB;
  const { results: lines } = await db.prepare(`SELECT id, event_id, tier, quantity, unit_price_kobo, engine_event_id, engine_stand_id FROM orders WHERE basket_id = ? ORDER BY rowid`).bind(basket.id).all();
  const { results: have } = await db.prepare(`SELECT id, order_id FROM tickets WHERE order_id IN (SELECT id FROM orders WHERE basket_id = ?)`).bind(basket.id).all();
  const known = new Set(have.map(t => t.id));
  const used = new Map(lines.map(l => [l.id, have.filter(t => t.order_id === l.id).length]));
  let index = null;
  const stmts = [];
  for (const t of tickets) {
    const token = String(t.token || '').toUpperCase();
    if (!isEngineToken(token)) { await logTicketing(env, 'error', 'bad_token', { ref: basket.reference }); continue; }
    const status = TICKET_STATUS[t.status] || 'valid';
    if (known.has(token)) { stmts.push(db.prepare(`UPDATE tickets SET status = CASE WHEN ? = 'used' OR status = 'used' THEN 'used' ELSE ? END WHERE id = ?`).bind(status, status, token)); continue; }
    let line = lines.find(l => l.engine_event_id === String(t.event_id) && l.engine_stand_id === String(t.stand_id) && used.get(l.id) < l.quantity);
    if (!line) {
      // A reissued ticket (or a line we did not have): map it through the engine's events.
      index ||= buildIndex(await engineEvents(env), await listMatches(db));
      const e = index.byEngine.get(String(t.event_id));
      const tier = e?.tiers.get(String(t.stand_id));
      line = lines.find(l => l.event_id === e?.localId && l.tier === tier) || null;
      if (!line) { await logTicketing(env, 'error', 'ticket_line_missing', { ref: basket.reference, event: String(t.event_id) }); continue; }
    }
    used.set(line.id, (used.get(line.id) || 0) + 1);
    known.add(token);
    stmts.push(db.prepare(`INSERT OR IGNORE INTO tickets (id, order_id, event_id, tier, status, ticket_type, unit_price_kobo, discount_kobo, engine_ticket_id, engine_event_id) VALUES (?, ?, ?, ?, ?, 'adult', ?, 0, ?, ?)`)
      .bind(token, line.id, line.event_id, line.tier, status, line.unit_price_kobo, String(t.ticket_id || ''), String(t.event_id || '')));
  }
  if (stmts.length) await db.batch(stmts);
}

/** The return page and "Find my tickets": ask the engine when the callback has not arrived yet. */
export async function pollEngineOrder(env, basket, { waitUntil = null } = {}) {
  try {
    const o = basket.engine_order_id ? await engine.getOrder(env, basket.engine_order_id) : await engine.orderByReference(env, basket.reference);
    const order = Array.isArray(o?.orders) ? o.orders[0] : o;
    if (order?.order_id || order?.client_reference) await applyEngineOrder(env, { client_reference: basket.reference, ...order }, order.tickets || [], { waitUntil });
  } catch (err) {
    await logTicketing(env, 'error', 'poll_failed', { ref: basket.reference, code: err.code, status: err.status });
  }
  return env.DB.prepare(`SELECT * FROM league_ticket_orders WHERE id = ?`).bind(basket.id).first();
}

export { uuid };
