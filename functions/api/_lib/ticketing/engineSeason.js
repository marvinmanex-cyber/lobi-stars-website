// Ticketing engine: season passes (contract 1.1, GET /season and season_bundle orders).
// One pass per person, valid once per home match, exactly as the club's own season tickets:
// the same /season-tickets page, success page, email and gate. The local season_orders /
// season_passes rows are a display copy (the pass number is the engine's token).
import { engine, EngineError, fanMessage } from './engineClient.js';
import { ensureEngineSchema, logTicketing, intlPhone, isEngineToken, getSetting, setSetting, processorName } from './engineStore.js';
import { standTier } from './engineCatalogue.js';
import { seasonEmailHtml, TIERS, TIER_LABELS } from '../seasonTickets.js';
import { randomId } from '../crypto.js';
import { sendEmail } from '../email.js';
import { captureContact, splitName } from '../contacts.js';
import { naira } from '../tickets/rules.js';

const MEMO_MS = 30e3, KEEP_MS = 10 * 60e3, CACHE_KEY = 'ticketing_season_cache';
let memo = { at: 0, data: undefined };
export const _resetSeasonMemo = () => { memo = { at: 0, data: undefined }; };

/** The engine's season pass offer ({ season, sale_open, sale_close, stands }) or null when none is on sale. */
export async function engineSeasonOffer(env) {
  if (memo.data !== undefined && Date.now() - memo.at < MEMO_MS) return memo.data;
  try {
    const d = await engine.season(env);
    memo = { at: Date.now(), data: d && Array.isArray(d.stands) ? d : null };
  } catch (err) {
    if (err instanceof EngineError && err.status === 404) memo = { at: Date.now(), data: null };
    else {
      await logTicketing(env, 'error', 'season_failed', { code: err.code, status: err.status });
      try { const c = JSON.parse((await getSetting(env.DB, CACHE_KEY)) || 'null'); if (c && Date.now() - c.at < KEEP_MS) return c.data; } catch { /* no copy */ }
      return null;
    }
  }
  await setSetting(env.DB, CACHE_KEY, JSON.stringify({ at: memo.at, data: memo.data }), 'engine').catch(() => {});
  return memo.data;
}

/** Per stand (VIP / Premium / Regular): price, passes left and whether it is on sale now. */
export function seasonTiers(offer, now = Date.now()) {
  const open = !!offer && (!offer.sale_open || Date.parse(offer.sale_open) <= now) && (!offer.sale_close || Date.parse(offer.sale_close) > now);
  const out = {};
  for (const t of TIERS) {
    const st = (offer?.stands || []).find(s => standTier(s) === t);
    const left = st && st.available !== undefined && st.available !== null ? Math.max(0, Number(st.available) || 0) : null;
    out[t] = { tier: t, label: TIER_LABELS[t], stand: st || null, priceKobo: st ? Math.max(0, Math.round(Number(st.price_kobo) || 0)) : 0, remaining: left, limit: left === null ? 0 : left, onSale: open && !!st && Number(st.price_kobo) > 0 };
  }
  return { open, season: offer?.season || '', tiers: out };
}

/** Creates a season order in the engine and its display copy. Returns { ok, authorizationUrl, reference } or { ok: false, status, body }. */
export async function createEngineSeasonOrder(env, { tier, quantity, buyer, origin }) {
  const db = env.DB;
  await ensureEngineSchema(db);
  const view = seasonTiers(await engineSeasonOffer(env));
  const t = view.tiers[tier];
  if (!t?.onSale) return { ok: false, status: 409, body: { error: 'That stand is not on sale.' } };
  if (t.remaining !== null && t.remaining < quantity) return { ok: false, status: 409, body: { error: t.remaining ? `Only ${t.remaining} left in the ${t.label}.` : `The ${t.label} is sold out.` } };
  const id = randomId('LS-SZO'), reference = randomId('LSSZN');
  const shown = t.priceKobo * quantity;
  await db.prepare(`INSERT INTO season_orders (id, season, tier, quantity, unit_price_kobo, total_kobo, buyer_name, buyer_email, buyer_phone, paystack_reference, backend)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engine')`).bind(id, view.season, tier, quantity, t.priceKobo, shown, buyer.name, buyer.email, buyer.phone, reference).run();
  const fail = async (status, body) => { await db.prepare(`UPDATE season_orders SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`).bind(id).run().catch(() => {}); return { ok: false, status, body }; };
  let o;
  try {
    o = await engine.createOrder(env, { client_reference: reference, season_bundle: true, items: [{ stand_id: String(t.stand.stand_id), quantity, ticket_type: 'adult' }],
      buyer: { name: buyer.name, email: buyer.email, phone: intlPhone(buyer.phone) }, return_url: `${origin}/season-tickets/success/` }, reference);
  } catch (err) {
    await logTicketing(env, 'error', 'order_create_failed', { reference, code: err.code, status: err.status });
    return fail(/sold_out|not_available/.test(err.code || '') ? 409 : 502, { error: fanMessage(err) });
  }
  const total = Math.round(Number(o.amount_total_kobo));
  if (total !== shown) { _resetSeasonMemo(); return fail(409, { error: `The price has just changed to ${naira(total)}. Check and try again.` }); }
  await db.prepare(`UPDATE season_orders SET engine_order_id = ?, engine_status = ? WHERE id = ?`).bind(String(o.order_id), String(o.status || 'pending_payment'), id).run();
  const url = o.payment?.authorization_url;
  if (!url || !/^https:\/\//.test(url)) return fail(502, { error: 'Payment could not be started. Please try again.' });
  return { ok: true, authorizationUrl: url, reference };
}

const PASS_STATUS = { valid: 'valid', scanned: 'valid', void: 'void' }; // a scanned season pass stays valid for the next match

/** Applies an engine season order to the display copy (callback / poll). { ok: false } when it is not a season order of this site. */
export async function applyEngineSeasonOrder(env, o, tickets = [], { waitUntil = null, email = true } = {}) {
  const db = env.DB;
  await ensureEngineSchema(db);
  let order = o?.client_reference ? await db.prepare(`SELECT * FROM season_orders WHERE paystack_reference = ?`).bind(String(o.client_reference)).first() : null;
  if (!order && o?.order_id) order = await db.prepare(`SELECT * FROM season_orders WHERE engine_order_id = ?`).bind(String(o.order_id)).first();
  if (!order) return { ok: false };
  const status = String(o.status || '');
  await db.prepare(`UPDATE season_orders SET engine_status = ? WHERE id = ?`).bind(status || null, order.id).run();
  if (status === 'failed' || status === 'expired') {
    await db.prepare(`UPDATE season_orders SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`).bind(order.id).run();
    return { ok: true, season: order };
  }
  if (['paid', 'refunded', 'partially_refunded'].includes(status)) {
    await db.prepare(`UPDATE season_orders SET payment_status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND payment_status != 'paid'`).bind(o.paid_at || new Date().toISOString(), order.id).run();
  }
  const stmts = [];
  for (const t of tickets || []) {
    const token = String(t.token || '').toUpperCase();
    if (!isEngineToken(token)) continue;
    stmts.push(db.prepare(`INSERT OR IGNORE INTO season_passes (id, order_id, season, tier, holder_name, status, engine_ticket_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(token, order.id, String(t.season || order.season), order.tier, order.buyer_name, PASS_STATUS[t.status] || 'valid', String(t.ticket_id || '')));
    stmts.push(db.prepare(`UPDATE season_passes SET status = ? WHERE id = ?`).bind(PASS_STATUS[t.status] || 'valid', token));
  }
  if (status === 'refunded') stmts.push(db.prepare(`UPDATE season_passes SET status = 'void' WHERE order_id = ?`).bind(order.id));
  if (stmts.length) await db.batch(stmts);

  // One email with the passes, once (sent again on the next callback / poll if it failed).
  if (email && status === 'paid' && env.RESEND_API_KEY) {
    const { results } = await db.prepare(`SELECT id FROM season_passes WHERE order_id = ? AND status = 'valid' ORDER BY id`).bind(order.id).all();
    const claim = results.length ? await db.prepare(`UPDATE season_orders SET emailed = 1 WHERE id = ? AND emailed = 0`).bind(order.id).run() : null;
    if (claim?.meta.changes) {
      const fresh = await db.prepare(`SELECT * FROM season_orders WHERE id = ?`).bind(order.id).first();
      const name = await processorName(db);
      let html = seasonEmailHtml(fresh, results.map(r => r.id));
      if (name) html = html.replace(/<\/div>\s*$/, `<p style="color:#5B6472;font-size:12px">Payments processed by ${String(name).replace(/[<>&"]/g, '')}.</p></div>`);
      const n = splitName(fresh.buyer_name);
      const send = Promise.all([
        captureContact(env, { source: 'ticket_buyer', refTable: 'season_orders', refId: fresh.id, email: fresh.buyer_email, phone: fresh.buyer_phone, firstName: n.firstName, surname: n.surname, label: `Season ticket ${fresh.season}` }).catch(() => {}),
        sendEmail(env, { to: fresh.buyer_email, subject: `Your Lobi Stars season ticket${results.length > 1 ? 's' : ''} ${fresh.season}`, html }),
      ]).catch(async () => {
        await logTicketing(env, 'error', 'email_failed', { ref: fresh.paystack_reference });
        await db.prepare(`UPDATE season_orders SET emailed = 0 WHERE id = ?`).bind(order.id).run();
      });
      if (waitUntil) waitUntil(send); else await send;
    }
  }
  return { ok: true, season: order };
}

/** The season success page: asks the engine when the callback has not arrived yet. */
export async function pollEngineSeason(env, order, { waitUntil = null } = {}) {
  try {
    const o = order.engine_order_id ? await engine.getOrder(env, order.engine_order_id) : await engine.orderByReference(env, order.paystack_reference);
    if (o?.order_id || o?.client_reference) await applyEngineSeasonOrder(env, { client_reference: order.paystack_reference, ...o }, o.tickets || [], { waitUntil });
  } catch (err) {
    await logTicketing(env, 'error', 'poll_failed', { ref: order.paystack_reference, code: err.code, status: err.status });
  }
  return env.DB.prepare(`SELECT * FROM season_orders WHERE id = ?`).bind(order.id).first();
}
