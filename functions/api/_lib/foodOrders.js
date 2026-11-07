// In-seat food orders.
//
// Order life cycle (order_status):
//   AWAITING_PAYMENT -> PAID -> ACCEPTED (kitchen saw it) -> PREPARING -> OUT_FOR_DELIVERY (ready) -> DELIVERED
// When an order becomes PAID the kitchen is alerted (kitchenNotify.js) and
// alerted again every few minutes until someone accepts it.
//   plus PAYMENT_FAILED, EXPIRED, CANCELLED, REFUNDED.
//
// An order is saved as AWAITING_PAYMENT with a reference such as
// FD-20261011-0042 before the fan goes to Paystack. It becomes PAID ONLY
// after the server has asked Paystack's Verify Transaction API and Paystack
// says: status success, the exact order total, NGN and the same reference
// (confirmFoodPayment). This runs from the Paystack webhook and, as a
// back-up if the webhook is slow, when the fan's status page asks the server.
// The browser can never mark an order paid. Confirming twice does nothing
// the second time. Unpaid orders become EXPIRED after the payment time limit
// (15 minutes by default, Admin -> In-Seat Food settings).
// Each order line keeps a copy of the item name and price at the time of the
// order, so later menu changes never change past orders or reports.
//
// WhatsApp orders (channel 'whatsapp'): the fan chooses food on /food and
// presses "Order on WhatsApp". The order is saved as AWAITING_WHATSAPP and
// WhatsApp opens with the order message to the club number. Staff then:
//   AWAITING_WHATSAPP -> CONFIRMED (asked the fan to pay, e.g. bank transfer)
//   -> PAID (staff confirm the money arrived) -> PREPARING -> OUT_FOR_DELIVERY
//   (or "ready for pickup") -> DELIVERED.  Unconfirmed WhatsApp orders expire
// after a few hours (Admin -> Menu & Prices -> Ordering settings).
// Orders can be delivered to the seat or collected at a pickup point.
import { verifyFood } from './paystackClient.js';
import { captureContact, splitName } from './contacts.js';
import { sendEmail, foodOrderEmailHtml } from './email.js';
import { raiseFoodAlert } from './foodAlerts.js';

export const STATUS = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', color: '#F59E0B' },
  AWAITING_WHATSAPP: { label: 'WhatsApp – to confirm', color: '#25D366' },
  CONFIRMED: { label: 'Confirmed – awaiting payment', color: '#0EA5E9' },
  PAID: { label: 'Paid', color: '#16A34A' },
  ACCEPTED: { label: 'Accepted by kitchen', color: '#0D9488' },
  PREPARING: { label: 'Preparing', color: '#2563EB' },
  READY: { label: 'Ready', color: '#0891B2' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', color: '#7C3AED' },
  FAILED_DELIVERY: { label: 'Delivery failed', color: '#DC2626' },
  REJECTED: { label: 'Rejected', color: '#6B7280' },
  DELIVERED: { label: 'Delivered', color: '#166534' },
  PAYMENT_FAILED: { label: 'Payment failed', color: '#DC2626' },
  EXPIRED: { label: 'Expired', color: '#6B7280' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280' },
  REFUNDED: { label: 'Refunded', color: '#6B7280' },
};
/** Moves staff may make (from -> allowed next statuses). */
export const STAFF_MOVES = {
  AWAITING_WHATSAPP: ['CONFIRMED', 'PAID', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'REJECTED', 'CANCELLED'],
  PAID: ['ACCEPTED', 'PREPARING', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED_DELIVERY', 'CANCELLED'],
  FAILED_DELIVERY: ['READY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: ['REFUNDED'],
  REJECTED: ['REFUNDED'],
  REFUNDED: [],
};
// Why an order can be rejected (the note is required for "other").
export const REJECT_REASONS = { sold_out: 'An item is sold out', kitchen_at_capacity: 'The kitchen is at capacity', outside_delivery_zone: 'Outside the delivery area', payment_issue: 'A problem with the payment', other: 'Other' };
/** The fan gives this to the runner, to prove the order reached them. */
export const newDeliveryCode = () => String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
// The first venue: existing orders and staff belong to it. Its details are data, not logic.
export const DEFAULT_VENUE = 'venue-main';
const STAMP = { ACCEPTED: 'accepted_iso', READY: 'ready_at', FAILED_DELIVERY: 'failed_at', REJECTED: 'cancelled_at', CONFIRMED: 'confirmed_at', PREPARING: 'preparing_at', OUT_FOR_DELIVERY: 'out_at', DELIVERED: 'delivered_at', CANCELLED: 'cancelled_at', REFUNDED: 'refunded_at' };

const nowIso = () => new Date().toISOString();

let ready = false;
export async function ensureFoodSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS food_orders (
    id TEXT PRIMARY KEY, seat TEXT NOT NULL, stand TEXT, phone TEXT NOT NULL, email TEXT NOT NULL,
    items_json TEXT NOT NULL, total_kobo INTEGER NOT NULL, paystack_reference TEXT UNIQUE NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
  )`).run();
  const cols = new Set((await db.prepare(`PRAGMA table_info(food_orders)`).all()).results.map(r => r.name));
  for (const [name, type] of [
    ['status', "TEXT NOT NULL DEFAULT 'new'"],   // old staff status (kept for history)
    ['status_by', 'TEXT'], ['status_at', 'TEXT'],
    ['ref', 'TEXT'],                              // FD-YYYYMMDD-NNNN (older orders: their id)
    ['order_status', 'TEXT'],
    ['customer_name', 'TEXT'],
    ['notes', 'TEXT'],
    ['event_id', 'TEXT'],                         // the match it was ordered for
    ['view_token', 'TEXT'],                       // lets the fan see their order status page
    ['created_iso', 'TEXT'], ['expires_at', 'TEXT'],
    ['paid_iso', 'TEXT'], ['paid_reference', 'TEXT'], ['paid_late', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_verify_at', 'TEXT'],
    ['preparing_at', 'TEXT'], ['out_at', 'TEXT'], ['delivered_at', 'TEXT'], ['cancelled_at', 'TEXT'], ['refunded_at', 'TEXT'],
    ['emailed', 'INTEGER NOT NULL DEFAULT 0'],
    ['channel', "TEXT NOT NULL DEFAULT 'paystack'"],   // paystack / whatsapp
    ['fulfilment', "TEXT NOT NULL DEFAULT 'seat'"],     // seat (deliver to seat) / pickup
    ['pickup_point', 'TEXT'],
    ['confirmed_at', 'TEXT'],
    // Kitchen alerts: first alert (stops duplicates), who accepted and when, repeat alerts.
    ['kitchen_alerted_at', 'TEXT'], ['kitchen_ack_at', 'TEXT'], ['kitchen_ack_by', 'TEXT'],
    ['repeat_count', 'INTEGER NOT NULL DEFAULT 0'], ['last_alert_at', 'TEXT'],
    // Receipts sent to the buyer from the Live Order Board (when, and by whom).
    ['receipt_email_at', 'TEXT'], ['receipt_email_to', 'TEXT'], ['receipt_wa_at', 'TEXT'], ['receipt_by', 'TEXT'],
    // When the fan wants it: now / kickoff / half-time, and the time it is due (kick-off, or kick-off + 50 minutes).
    ['deliver_when', 'TEXT'], ['deliver_at', 'TEXT'],
    // The fan's browser push subscription for this order ("Tell me when it's on the way").
    ['push_sub', 'TEXT'],
    // The order workflow (6 Nov 2026): its venue, when it was ready, when delivery failed, why it was rejected or cancelled.
    ['venue_id', 'TEXT'], ['ready_at', 'TEXT'], ['failed_at', 'TEXT'], ['reject_reason', 'TEXT'], ['reject_note', 'TEXT'], ['cancel_reason', 'TEXT'],
    // Phase 2: the fan's 4-digit delivery code, the runner who took the order, when it was accepted.
    ['delivery_code', 'TEXT'], ['claimed_by', 'TEXT'], ['claimed_name', 'TEXT'], ['claimed_at', 'TEXT'], ['accepted_iso', 'TEXT'],
  ]) if (!cols.has(name)) await db.prepare(`ALTER TABLE food_orders ADD COLUMN ${name} ${type}`).run();
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_ref ON food_orders(ref) WHERE ref IS NOT NULL`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_status ON food_orders(order_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_kitchen ON food_orders(order_status, kitchen_ack_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_ref_counter (day TEXT PRIMARY KEY, n INTEGER NOT NULL)`),
    // Every status change, by whom and why (only ever added to). See migrations/0012_kitchen_workflow.sql.
    db.prepare(`CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'status', from_status TEXT, to_status TEXT, by_id TEXT, by_name TEXT, by_role TEXT, reason TEXT, note TEXT, at TEXT NOT NULL, ack_at TEXT, ack_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_order_events_flag ON order_events (kind, ack_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_refunds (order_id TEXT PRIMARY KEY, amount_kobo INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'manual', created_by TEXT, created_at TEXT NOT NULL, done_by TEXT, done_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_venue_shifts (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, started_by TEXT, started_at TEXT NOT NULL, ended_by TEXT, ended_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_venue_shift ON mk_venue_shifts (venue_id, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_escalations (order_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (order_id, kind))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_item_venue (item_id TEXT NOT NULL, venue_id TEXT NOT NULL, sold_out INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (item_id, venue_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mk_venues (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT)`),
    db.prepare(`INSERT OR IGNORE INTO mk_venues (id, name, active, settings_json, created_at) VALUES (?, 'McCarthy Stadium', 1, ?, ?)`).bind(DEFAULT_VENUE, JSON.stringify({ whatsappNumber: '2347080094985', bankDetails: 'Aeson Sports Management Limited, Fidelity Bank: 4011459917' }), new Date().toISOString()),
    db.prepare(`UPDATE food_orders SET venue_id = ? WHERE venue_id IS NULL`).bind(DEFAULT_VENUE),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    // Existing orders get the new statuses (nothing is deleted).
    db.prepare(`UPDATE food_orders SET ref = id WHERE ref IS NULL`),
    db.prepare(`UPDATE food_orders SET order_status = CASE
        WHEN payment_status = 'paid' AND status = 'preparing' THEN 'PREPARING'
        WHEN payment_status = 'paid' AND status = 'delivered' THEN 'DELIVERED'
        WHEN payment_status = 'paid' AND status = 'cancelled' THEN 'CANCELLED'
        WHEN payment_status = 'paid' THEN 'PAID'
        WHEN payment_status = 'failed' THEN 'PAYMENT_FAILED'
        ELSE 'AWAITING_PAYMENT' END
      WHERE order_status IS NULL`),
    db.prepare(`UPDATE food_orders SET created_iso = replace(created_at, ' ', 'T') || 'Z' WHERE created_iso IS NULL AND created_at NOT LIKE '%T%'`),
    db.prepare(`UPDATE food_orders SET paid_iso = replace(paid_at, ' ', 'T') || 'Z' WHERE paid_iso IS NULL AND paid_at IS NOT NULL AND paid_at NOT LIKE '%T%'`),
  ]);
  ready = true;
}

// ── Settings ──
// orderingMode: 'open' (always), 'closed', or 'auto' (from autoOpenMinutes before kick-off
// of a home game until full time). stands: list for the seat form's Section drop-down (default: the three
// McCarthy Stadium stands; saved as an empty list = free text).
// The only WhatsApp number for food orders: fans send to it and replies come from it. Fixed here, not a setting.
export const OFFICIAL_WHATSAPP = '2347080094985';
const localWhatsapp = n => { const d = String(n || OFFICIAL_WHATSAPP); return `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`; };
export const WA_TEMPLATES = {
  msgConfirmed: 'Hi {name}, this is MatchDay Kitchen. We have received your food order {ref} of {total}, and it is waiting for payment. Kindly pay the sum of {total} to {bank} and forward the receipt to our WhatsApp number, {whatsapp}, for confirmation.',
  msgPaid: "Hi {name}, we've received your payment for order {ref}. We're preparing your food now.",
  msgReady: 'Hi {name}, your order {ref} is ready. {where}',
  msgCancelled: "Hi {name}, sorry, your MatchDay Kitchen order {ref} has been cancelled. Please message us if you have any questions.",
};
export const FOOD_DEFAULTS = {
  paymentExpiryMinutes: 15, orderingMode: 'open', autoOpenMinutes: 90, stands: ['Popular Stand', 'Grand Stand', 'VIP Seating'], minOrderKobo: 0,
  // Order on WhatsApp. The number is the club WhatsApp shown on the site.
  whatsappEnabled: true, whatsappNumber: OFFICIAL_WHATSAPP, whatsappExpiryHours: 3, pickupPoints: [], bankDetails: 'Aeson Sports Management Limited, Fidelity Bank: 4011459917',
  ...WA_TEMPLATES,
};
export async function foodSettings(db) {
  await ensureFoodSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM food_settings`).all();
  const s = { ...FOOD_DEFAULTS, stands: [...FOOD_DEFAULTS.stands], pickupPoints: [] }; // a stands list saved in Admin › Food replaces the default
  for (const r of results) {
    if (r.key === 'whatsappEnabled') s.whatsappEnabled = r.value === '1';
    if (r.key === 'whatsappExpiryHours') s.whatsappExpiryHours = Math.min(48, Math.max(1, Number(r.value) || 3));
    if (r.key === 'bankDetails') s.bankDetails = String(r.value || '').slice(0, 300);
    if (r.key in WA_TEMPLATES && r.value) s[r.key] = String(r.value).slice(0, 500);
    if (r.key === 'pickupPoints') { try { const v = JSON.parse(r.value); if (Array.isArray(v)) s.pickupPoints = v.map(String).filter(Boolean).slice(0, 20); } catch {} }
    if (r.key === 'paymentExpiryMinutes') s.paymentExpiryMinutes = Math.min(120, Math.max(1, Number(r.value) || 15));
    if (r.key === 'orderingMode' && ['open', 'closed', 'auto'].includes(r.value)) s.orderingMode = r.value;
    if (r.key === 'autoOpenMinutes') s.autoOpenMinutes = Math.min(600, Math.max(0, Number(r.value) || 90));
    if (r.key === 'minOrderKobo') s.minOrderKobo = Math.max(0, Number(r.value) || 0);
    if (r.key === 'stands') { try { const v = JSON.parse(r.value); if (Array.isArray(v)) s.stands = v.map(String).filter(Boolean).slice(0, 40); } catch {} }
  }
  // The venue's own WhatsApp number (the only one for orders and replies; not an Ordering setting) and its account.
  const venue = await db.prepare(`SELECT settings_json FROM mk_venues WHERE id = ?`).bind(DEFAULT_VENUE).first().catch(() => null);
  try {
    const v = JSON.parse(venue?.settings_json || '{}');
    if (/^234\d{10}$/.test(v.whatsappNumber || '')) s.whatsappNumber = v.whatsappNumber;
    if (v.bankDetails && !results.some(r => r.key === 'bankDetails')) s.bankDetails = String(v.bankDetails).slice(0, 300);
  } catch { /* the defaults above */ }
  return s;
}
export async function saveFoodSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO food_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, String(value), nowIso(), by).run();
}

/** Unpaid orders past their time limit become EXPIRED (run whenever orders are read). */
export async function expireStale(db) {
  await ensureFoodSchema(db);
  // Paystack orders and unconfirmed WhatsApp orders past their time limit.
  await db.prepare(`UPDATE food_orders SET order_status = 'EXPIRED' WHERE order_status IN ('AWAITING_PAYMENT', 'AWAITING_WHATSAPP') AND expires_at IS NOT NULL AND expires_at < ?`).bind(nowIso()).run();
}

/** The next reference for today (Nigerian date): FD-20261011-0042. */
export async function nextRef(db) {
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const row = await db.prepare(`INSERT INTO food_ref_counter (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1 RETURNING n`).bind(day).first();
  return `FD-${day}-${String(row.n).padStart(4, '0')}`;
}

/** One line in the order's history. A failure here never stops the order moving. */
export async function recordOrderEvent(db, orderId, { kind = 'status', from = null, to = null, byId = null, byName = null, byRole = null, reason = null, note = null } = {}) {
  try {
    await db.prepare(`INSERT INTO order_events (order_id, kind, from_status, to_status, by_id, by_name, by_role, reason, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(String(orderId), kind, from, to, byId, byName, byRole, reason, note, new Date().toISOString()).run();
  } catch (err) { console.error('[food] order event', err); }
}

/**
 * Everything that follows an order becoming paid, however it was paid (Paystack, or a WhatsApp
 * payment recorded by staff): stock, staff and kitchen alerts, rewards, the contact and the email.
 */
export async function afterFoodPaid(env, order, paid, { waitUntil, origin = 'https://lobistarsfc.com' } = {}) {
  // Items with a stock count go down by what was paid for (0 = sold out).
  try {
    const stmts = JSON.parse(order.items_json).map(i => env.DB.prepare(
      `UPDATE food_items SET stock = MAX(0, stock - ?), sold_out = CASE WHEN stock - ? <= 0 THEN 1 ELSE sold_out END WHERE id = ? AND stock IS NOT NULL`
    ).bind(i.qty, i.qty, i.id));
    if (stmts.length) await env.DB.batch(stmts);
  } catch { /* menu table not created yet */ }

  // Staff alert "PAID – start preparing" (sent once).
  await raiseFoodAlert(env, 'paid', paid, { waitUntil, origin }).catch(err => console.error('[food] paid alert', err));
  // Kitchen alert (Kitchen Screen push + Telegram), repeated until accepted.
  try {
    const { kitchenOnPaid } = await import('./kitchenNotify.js');
    const job = kitchenOnPaid(env, order.id, waitUntil);
    if (!waitUntil) await job;
  } catch (err) { console.error('[food] kitchen alert', err); }
  // The customer's "received" message on WhatsApp, once Meta is connected (their email is further down).
  try {
    const { customerUpdate, whatsappConnected } = await import('./kitchenCustomer.js');
    if (whatsappConnected(env)) await customerUpdate(env, { ...paid, ...(await env.DB.prepare(`SELECT delivery_code, view_token FROM food_orders WHERE id = ?`).bind(order.id).first()) }, 'received');
  } catch (err) { console.error('[food] customer received', err); }
  // Lobi Stars Rewards: Star Points / voucher used are taken, and food points are earned (on the part paid in naira).
  try { const { confirmCheckout } = await import('./rewardsCheckout.js'); await confirmCheckout(env, order.paystack_reference); const { earnFood } = await import('./rewardsEarn.js'); await earnFood(env, paid); } catch (err) { console.error('[food] rewards', err); }
  const n = splitName(order.customer_name || '');
  await captureContact(env, { source: 'food_order', refTable: 'food_orders', refId: order.id, email: order.email || null, phone: order.phone, firstName: n.firstName, surname: n.surname, label: order.ref });
  if (env.RESEND_API_KEY && order.email) {
    const send = sendEmail(env, {
      to: order.email, subject: `MatchDay Kitchen order ${order.ref} confirmed`,
      html: foodOrderEmailHtml({ order: paid, items: JSON.parse(order.items_json), trackUrl: trackUrl(origin, paid) }),
    }).then(() => env.DB.prepare(`UPDATE food_orders SET emailed = 1 WHERE id = ?`).bind(order.id).run())
      .catch(err => console.error('[food] email failed', err));
    if (waitUntil) waitUntil(send); else await send;
  }
}

/**
 * Confirms a payment with Paystack and, only if Paystack agrees, marks the
 * order PAID (once). Returns { order, changed, reason }.
 */
export async function confirmFoodPayment(env, order, { waitUntil, origin = 'https://lobistarsfc.com' } = {}) {
  if (!order) return { order, changed: false, reason: 'not found' };
  if (order.payment_status === 'paid') return { order, changed: false, reason: 'already paid' };
  const t = await verifyFood(env, order.paystack_reference); // throws if Paystack can't be reached
  await env.DB.prepare(`UPDATE food_orders SET last_verify_at = ? WHERE id = ?`).bind(nowIso(), order.id).run();
  if (t.status === 'failed') {
    await env.DB.prepare(`UPDATE food_orders SET order_status = 'PAYMENT_FAILED', payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`).bind(order.id).run();
    try { const { releaseCheckout } = await import('./rewardsCheckout.js'); await releaseCheckout(env, order.paystack_reference); } catch { /* released by the Rewards job */ }
    return { order: { ...order, order_status: 'PAYMENT_FAILED' }, changed: false, reason: 'payment failed' };
  }
  if (t.status !== 'success') return { order, changed: false, reason: `not paid (${t.status})` };
  if (t.reference !== order.paystack_reference || Number(t.amount) !== Number(order.total_kobo) || String(t.currency || '').toUpperCase() !== 'NGN') {
    console.error('[food] payment does not match order', order.ref, t);
    return { order, changed: false, reason: 'payment does not match the order' };
  }
  const at = nowIso();
  const late = order.order_status === 'EXPIRED' ? 1 : 0;
  // The atomic update is the guard against double processing (webhook + status page, or a repeated webhook).
  const res = await env.DB.prepare(
    `UPDATE food_orders SET payment_status = 'paid', order_status = 'PAID', paid_at = datetime('now'), paid_iso = ?, paid_reference = ?, paid_late = ?
     WHERE id = ? AND payment_status != 'paid'`
  ).bind(at, t.reference, late, order.id).run();
  if (!res.meta?.changes) return { order, changed: false, reason: 'already paid' };
  const paid = { ...order, payment_status: 'paid', order_status: 'PAID', paid_iso: at };
  await recordOrderEvent(env.DB, order.id, { from: order.order_status, to: 'PAID', byName: 'Paystack', byRole: 'system' });
  await afterFoodPaid(env, order, paid, { waitUntil, origin });
  return { order: paid, changed: true, reason: 'paid' };
}

export const trackUrl = (origin, o) => `${origin}/food/order/?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`;

/** Staff move (validated). Returns the error text, or null when done. */
// opts: { byId, byRole, reason, note, waitUntil }. Rejected and cancelled paid orders get a refund record.
export async function moveOrder(db, order, to, staffName, env = null, opts = {}) {
  if (!order) return 'Order not found.';
  const allowed = STAFF_MOVES[order.order_status] || [];
  if (!allowed.includes(to)) return `An order that is "${STATUS[order.order_status]?.label || order.order_status}" can't be moved to "${STATUS[to]?.label || to}".`;
  const col = STAMP[to];
  const reason = opts.reason ? String(opts.reason).slice(0, 60) : null, note = opts.note ? String(opts.note).replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  // A runner taking an order: the status check in this one update is what stops two runners taking it.
  const claimBy = to === 'OUT_FOR_DELIVERY' && opts.claimBy ? [`, claimed_by = ?, claimed_name = ?, claimed_at = ?`, [opts.claimBy.id, opts.claimBy.name, nowIso()]] : ['', []];
  const why = to === 'REJECTED' ? [`, reject_reason = ?, reject_note = ?`, [reason, note]] : to === 'CANCELLED' ? [`, cancel_reason = ?`, [[reason, note].filter(Boolean).join(': ') || null]] : claimBy;
  const res = await db.prepare(
    `UPDATE food_orders SET order_status = ?, status_by = ?, status_at = ?${col ? `, ${col} = ?` : ''}${why[0]} WHERE id = ? AND order_status = ?`
  ).bind(...[to, staffName, nowIso(), ...(col ? [nowIso()] : []), ...why[1], order.id, order.order_status]).run();
  if (!res.meta?.changes) return 'Someone else has just changed this order. Refresh and try again.';
  await recordOrderEvent(db, order.id, { from: order.order_status, to, byId: opts.byId || null, byName: staffName, byRole: opts.byRole || null, reason, note });
  if (['REJECTED', 'CANCELLED'].includes(to) && order.payment_status === 'paid') {
    await db.prepare(`INSERT OR IGNORE INTO food_refunds (order_id, amount_kobo, reason, status, created_by, created_at) VALUES (?, ?, ?, 'manual', ?, ?)`)
      .bind(order.id, order.total_kobo, [reason, note].filter(Boolean).join(': ') || to.toLowerCase(), staffName, nowIso()).run().catch(err => console.error('[food] refund record', err));
  }
  // The kitchen has seen it (accepted, or went straight to preparing): stop repeat alerts.
  if (['ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(to) && !order.kitchen_ack_at) {
    await db.prepare(`UPDATE food_orders SET kitchen_ack_at = ?, kitchen_ack_by = ? WHERE id = ? AND kitchen_ack_at IS NULL`).bind(nowIso(), staffName, order.id).run();
  }
  // WhatsApp orders: staff confirm the payment arrived (bank transfer / cash), so it counts as paid in reports.
  if (to === 'PAID' && order.channel === 'whatsapp' && order.payment_status !== 'paid') {
    const at = nowIso(), reference = `WhatsApp: confirmed by ${staffName}`;
    await db.prepare(`UPDATE food_orders SET payment_status = 'paid', paid_at = datetime('now'), paid_iso = ?, paid_reference = ? WHERE id = ?`).bind(at, reference, order.id).run();
    const paid = { ...order, payment_status: 'paid', order_status: 'PAID', paid_iso: at, paid_reference: reference };
    if (env) await afterFoodPaid(env, order, paid);
    else {
      try {
        const stmts = JSON.parse(order.items_json).map(i => db.prepare(
          `UPDATE food_items SET stock = MAX(0, stock - ?), sold_out = CASE WHEN stock - ? <= 0 THEN 1 ELSE sold_out END WHERE id = ? AND stock IS NOT NULL`
        ).bind(i.qty, i.qty, i.id));
        if (stmts.length) await db.batch(stmts);
      } catch { /* menu table not created yet */ }
    }
  }
  // The fan's own alert (cooking now / on the way), when they asked for one.
  if (env && order.push_sub && (['PREPARING', 'OUT_FOR_DELIVERY'].includes(to) || (to === 'READY' && order.fulfilment === 'pickup'))) {
    try { const { notifyFan } = await import('./foodNotify.js'); await notifyFan(env, order, to); } catch (err) { console.error('[food] fan alert', err); }
  }
  // Staff and customer alerts for this step. They never hold up or stop the move.
  if (env) {
    const job = import('./kitchenNotify.js').then(k => k.notifyMove(env, order, to)).catch(err => console.error('[food] move alerts', err));
    if (opts.waitUntil) opts.waitUntil(job); else await job;
  }
  return null;
}

/** "When": order ahead for kick-off or half-time. Saves the choice and the time it is due. */
export async function setDelivery(db, id, when, eventId) {
  const w = ['kickoff', 'half-time'].includes(when) ? when : 'now';
  let at = null;
  if (w !== 'now' && eventId) {
    const e = await db.prepare(`SELECT event_date FROM events WHERE id = ?`).bind(eventId).first().catch(() => null);
    const ko = e ? Date.parse(e.event_date) : NaN;
    if (Number.isFinite(ko)) at = new Date(ko + (w === 'half-time' ? 50 : 0) * 60e3).toISOString();
  }
  await db.prepare(`UPDATE food_orders SET deliver_when = ?, deliver_at = ? WHERE id = ?`).bind(w, at, id).run();
}

/** Popular now: the most ordered dishes of the last 30 days (worked out at most every 15 minutes). */
export async function popularItems(db) {
  const row = await db.prepare(`SELECT value, updated_at FROM food_settings WHERE key = 'popular_cache'`).first().catch(() => null);
  if (row && Date.now() - Date.parse(row.updated_at) < 15 * 60e3) { try { return JSON.parse(row.value); } catch { /* recount */ } }
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { results } = await db.prepare(`SELECT items_json FROM food_orders WHERE payment_status = 'paid' AND COALESCE(paid_iso, created_iso) >= ? AND order_status NOT IN ('CANCELLED', 'REFUNDED', 'REJECTED') ORDER BY COALESCE(paid_iso, created_iso) DESC LIMIT 1500`).bind(since).all();
  const n = {};
  for (const r of results) { try { for (const i of JSON.parse(r.items_json)) n[i.id] = (n[i.id] || 0) + (Number(i.qty) || 0); } catch { /* skip */ } }
  const ids = Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  await saveFoodSetting(db, 'popular_cache', JSON.stringify(ids), 'system').catch(() => {});
  return ids;
}

/** What the fan's status page shows. */
export function publicOrder(o) {
  let items = [];
  try { items = JSON.parse(o.items_json); } catch {}
  return {
    ref: o.ref, status: o.order_status, statusLabel: STATUS[o.order_status]?.label || o.order_status,
    seat: o.seat, stand: o.stand || '', name: o.customer_name || '', notes: o.notes || '',
    channel: o.channel || 'paystack', fulfilment: o.fulfilment || 'seat', pickupPoint: o.pickup_point || '',
    items: items.map(i => ({ name: i.name, qty: i.qty, priceKobo: i.priceKobo })), totalKobo: o.total_kobo,
    createdAt: o.created_iso, paidAt: o.paid_iso, expiresAt: o.expires_at,
    preparingAt: o.preparing_at, outAt: o.out_at, deliveredAt: o.delivered_at,
    deliverWhen: o.deliver_when || 'now', deliverAt: o.deliver_at || null, alerts: !!o.push_sub,
    readyAt: o.ready_at || null,
    // Shown only to the fan (this address needs their token), and only while it is useful.
    deliveryCode: o.fulfilment !== 'pickup' && o.delivery_code && !['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED', 'EXPIRED', 'PAYMENT_FAILED'].includes(o.order_status) ? o.delivery_code : '',
    rejectReason: o.order_status === 'REJECTED' ? (REJECT_REASONS[o.reject_reason] || '') : '',
    refundNote: ['REJECTED', 'CANCELLED'].includes(o.order_status) && o.payment_status === 'paid' ? 'Your payment will be refunded.' : '',
  };
}


/**
 * Checks a cart against the menu in the database: availability, sold out,
 * limits and stock. Prices always come from the database, never the browser.
 * Returns { orderItems, totalKobo, adult } or { error, status }.
 */
export async function priceCart(db, items, venueId = DEFAULT_VENUE) {
  const { results: menu } = await db.prepare(`SELECT * FROM food_items WHERE archived = 0`).all();
  // A dish turned off at this venue only.
  const off = venueId === DEFAULT_VENUE ? [] : (await db.prepare(`SELECT item_id FROM food_item_venue WHERE venue_id = ? AND sold_out = 1`).bind(venueId).all()).results.map(r => r.item_id);
  for (const m of menu) if (off.includes(m.id)) m.sold_out = 1;
  const orderItems = [];
  let totalKobo = 0, adult = false;
  const seen = new Set();
  for (const item of items) {
    const m = menu.find(x => x.id === String(item?.id || ''));
    const qty = Number.parseInt(item?.qty ?? item?.quantity, 10);
    if (!m || !m.available || !Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'One of the items is no longer on the menu. Please refresh the page.', status: 400 };
    if (seen.has(m.id)) return { error: 'The same item appears twice. Please refresh the page.', status: 400 };
    seen.add(m.id);
    if (m.stock === 0) return { error: `Sorry, ${m.name} has just sold out. Please remove it and try again.`, status: 409 };
    if (m.sold_out) return { error: `Sorry, ${m.name} is not ready right now. Please remove it and try again.`, status: 409 };
    if (m.max_per_order && qty > m.max_per_order) return { error: `You can order at most ${m.max_per_order} × ${m.name}.`, status: 400 };
    if (m.stock != null && qty > m.stock) return { error: `Only ${m.stock} × ${m.name} left. Please reduce the quantity.`, status: 409 };
    if (m.adult) adult = true;
    // A copy of the name and price at the time of ordering (later menu changes never alter this order).
    orderItems.push({ id: m.id, name: m.name, priceKobo: m.price_kobo, qty });
    totalKobo += m.price_kobo * qty;
  }
  return { orderItems, totalKobo, adult };
}

export const formatNaira = kobo => '₦' + (Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
/** +2348031234567 -> "0803 123 4567". */
export const localPhone = e164 => { const d = String(e164 || '').replace(/\D/g, '').replace(/^234/, '0'); return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d; };
export const whereText = o => (o.fulfilment === 'pickup' ? `Pickup: ${o.pickup_point || 'pickup point'}` : `Seat ${o.seat}${o.stand ? `, ${o.stand}` : ''}`);

/** The message the fan sends to the club on WhatsApp. */
// bank: where to pay. It goes in the fan's own message, so the details are in the chat straight away
// (WhatsApp doesn't let a website send a message by itself).
export function whatsappOrderMessage(o, items, bank = '', code = '') {
  const lines = ['Hello MatchDay Kitchen,', "I'd like to place a food order.", '', `Order: ${o.ref}`, `Name: ${o.customer_name}`, `Phone: ${localPhone(o.phone)}`, ''];
  for (const i of items) lines.push(`${i.qty} × ${i.name}: ${formatNaira(i.priceKobo * i.qty)}`);
  lines.push('-----------------------', `Total: ${formatNaira(o.total_kobo)}`, '', whereText(o));
  if (o.notes) lines.push(`Note: ${o.notes}`);
  lines.push('', 'Please confirm my order. Thank you.');
  if (code && o.fulfilment !== 'pickup') lines.push('', `Delivery code: ${code}`);
  if (bank) lines.push('', `To pay: ${formatNaira(o.total_kobo)} to ${bank}. I will forward my receipt here for confirmation.`);
  return lines.join('\n');
}
export const whatsappUrl = (number, message) => `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

/** How to pay, for the fan's own screens: only while a WhatsApp order is waiting for payment. */
export function paymentMessage(settings, o) {
  if (o.channel !== 'whatsapp' || o.payment_status === 'paid' || !['AWAITING_WHATSAPP', 'CONFIRMED'].includes(o.order_status) || !settings.bankDetails) return null;
  return staffMessage(settings, o, 'CONFIRMED');
}

/** Staff reply for an order status (templates in Ordering settings). */
export function staffMessage(settings, o, kind) {
  const t = settings[{ CONFIRMED: 'msgConfirmed', PAID: 'msgPaid', READY: 'msgReady', CANCELLED: 'msgCancelled' }[kind]] || '';
  const where = o.fulfilment === 'pickup' ? `Collect it at ${o.pickup_point || 'the pickup point'}.` : `It's on its way to seat ${o.seat}${o.stand ? `, ${o.stand}` : ''}.`;
  // No exclamation marks in WhatsApp messages (also in templates saved before 1 Nov 2026).
  return t.replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/\{(name|ref|total|bank|pickup|seat|where|whatsapp)\}/g, (_, k) => ({
    name: (o.customer_name || '').split(' ')[0] || 'there', ref: o.ref, total: formatNaira(o.total_kobo),
    bank: settings.bankDetails || '[bank details: add them in Ordering settings]', pickup: o.pickup_point || '', seat: o.seat || '', where, whatsapp: localWhatsapp(settings.whatsappNumber),
  }[k]));
}
