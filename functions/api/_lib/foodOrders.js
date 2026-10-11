// In-seat food orders.
//
// Order life cycle (order_status):
//   AWAITING_PAYMENT -> PAID -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED
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
import { verify } from './paystackClient.js';
import { captureContact, splitName } from './contacts.js';
import { sendEmail, foodOrderEmailHtml } from './email.js';
import { raiseFoodAlert } from './foodAlerts.js';

export const STATUS = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', color: '#F59E0B' },
  PAID: { label: 'Paid', color: '#16A34A' },
  PREPARING: { label: 'Preparing', color: '#2563EB' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', color: '#7C3AED' },
  DELIVERED: { label: 'Delivered', color: '#166534' },
  PAYMENT_FAILED: { label: 'Payment failed', color: '#DC2626' },
  EXPIRED: { label: 'Expired', color: '#6B7280' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280' },
  REFUNDED: { label: 'Refunded', color: '#6B7280' },
};
/** Moves staff may make (from -> allowed next statuses). */
export const STAFF_MOVES = {
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'PAID', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'PREPARING', 'CANCELLED'],
  DELIVERED: ['OUT_FOR_DELIVERY'],
  CANCELLED: ['REFUNDED', 'PAID'],
  REFUNDED: [],
};
const STAMP = { PREPARING: 'preparing_at', OUT_FOR_DELIVERY: 'out_at', DELIVERED: 'delivered_at', CANCELLED: 'cancelled_at', REFUNDED: 'refunded_at' };

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
  ]) if (!cols.has(name)) await db.prepare(`ALTER TABLE food_orders ADD COLUMN ${name} ${type}`).run();
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_ref ON food_orders(ref) WHERE ref IS NOT NULL`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_status ON food_orders(order_status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_ref_counter (day TEXT PRIMARY KEY, n INTEGER NOT NULL)`),
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
// of a home game until full time). stands: list for the seat form (empty = free text).
export const FOOD_DEFAULTS = { paymentExpiryMinutes: 15, orderingMode: 'open', autoOpenMinutes: 90, stands: [], minOrderKobo: 0 };
export async function foodSettings(db) {
  await ensureFoodSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM food_settings`).all();
  const s = { ...FOOD_DEFAULTS, stands: [] };
  for (const r of results) {
    if (r.key === 'paymentExpiryMinutes') s.paymentExpiryMinutes = Math.min(120, Math.max(1, Number(r.value) || 15));
    if (r.key === 'orderingMode' && ['open', 'closed', 'auto'].includes(r.value)) s.orderingMode = r.value;
    if (r.key === 'autoOpenMinutes') s.autoOpenMinutes = Math.min(600, Math.max(0, Number(r.value) || 90));
    if (r.key === 'minOrderKobo') s.minOrderKobo = Math.max(0, Number(r.value) || 0);
    if (r.key === 'stands') { try { const v = JSON.parse(r.value); if (Array.isArray(v)) s.stands = v.map(String).filter(Boolean).slice(0, 40); } catch {} }
  }
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
  await db.prepare(`UPDATE food_orders SET order_status = 'EXPIRED' WHERE order_status = 'AWAITING_PAYMENT' AND expires_at IS NOT NULL AND expires_at < ?`).bind(nowIso()).run();
}

/** The next reference for today (Nigerian date): FD-20261011-0042. */
export async function nextRef(db) {
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const row = await db.prepare(`INSERT INTO food_ref_counter (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1 RETURNING n`).bind(day).first();
  return `FD-${day}-${String(row.n).padStart(4, '0')}`;
}

/**
 * Confirms a payment with Paystack and, only if Paystack agrees, marks the
 * order PAID (once). Returns { order, changed, reason }.
 */
export async function confirmFoodPayment(env, order, { waitUntil, origin = 'https://lobistarsfc.com' } = {}) {
  if (!order) return { order, changed: false, reason: 'not found' };
  if (order.payment_status === 'paid') return { order, changed: false, reason: 'already paid' };
  const t = await verify(env, order.paystack_reference); // throws if Paystack can't be reached
  await env.DB.prepare(`UPDATE food_orders SET last_verify_at = ? WHERE id = ?`).bind(nowIso(), order.id).run();
  if (t.status === 'failed') {
    await env.DB.prepare(`UPDATE food_orders SET order_status = 'PAYMENT_FAILED', payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`).bind(order.id).run();
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
  // Items with a stock count go down by what was paid for (0 = sold out).
  try {
    const stmts = JSON.parse(order.items_json).map(i => env.DB.prepare(
      `UPDATE food_items SET stock = MAX(0, stock - ?), sold_out = CASE WHEN stock - ? <= 0 THEN 1 ELSE sold_out END WHERE id = ? AND stock IS NOT NULL`
    ).bind(i.qty, i.qty, i.id));
    if (stmts.length) await env.DB.batch(stmts);
  } catch { /* menu table not created yet */ }

  // Staff alert "PAID – start preparing" (sent once).
  await raiseFoodAlert(env, 'paid', paid, { waitUntil, origin }).catch(err => console.error('[food] paid alert', err));
  const n = splitName(order.customer_name || '');
  await captureContact(env, { source: 'food_order', refTable: 'food_orders', refId: order.id, email: order.email, phone: order.phone, firstName: n.firstName, surname: n.surname, label: order.ref });
  if (env.RESEND_API_KEY) {
    const send = sendEmail(env, {
      to: order.email, subject: `Lobi Stars food order ${order.ref} confirmed`,
      html: foodOrderEmailHtml({ order: paid, items: JSON.parse(order.items_json), trackUrl: trackUrl(origin, paid) }),
    }).then(() => env.DB.prepare(`UPDATE food_orders SET emailed = 1 WHERE id = ?`).bind(order.id).run())
      .catch(err => console.error('[food] email failed', err));
    if (waitUntil) waitUntil(send); else await send;
  }
  return { order: paid, changed: true, reason: 'paid' };
}

export const trackUrl = (origin, o) => `${origin}/food/order/?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`;

/** Staff move (validated). Returns the error text, or null when done. */
export async function moveOrder(db, order, to, staffName) {
  if (!order) return 'Order not found.';
  const allowed = STAFF_MOVES[order.order_status] || [];
  if (!allowed.includes(to)) return `An order that is "${STATUS[order.order_status]?.label || order.order_status}" can't be moved to "${STATUS[to]?.label || to}".`;
  const col = STAMP[to];
  const res = await db.prepare(
    `UPDATE food_orders SET order_status = ?, status_by = ?, status_at = ?${col ? `, ${col} = ?` : ''} WHERE id = ? AND order_status = ?`
  ).bind(...[to, staffName, nowIso(), ...(col ? [nowIso()] : []), order.id, order.order_status]).run();
  return res.meta?.changes ? null : 'Someone else has just changed this order. Refresh and try again.';
}

/** What the fan's status page shows. */
export function publicOrder(o) {
  let items = [];
  try { items = JSON.parse(o.items_json); } catch {}
  return {
    ref: o.ref, status: o.order_status, statusLabel: STATUS[o.order_status]?.label || o.order_status,
    seat: o.seat, stand: o.stand || '', name: o.customer_name || '', notes: o.notes || '',
    items: items.map(i => ({ name: i.name, qty: i.qty, priceKobo: i.priceKobo })), totalKobo: o.total_kobo,
    createdAt: o.created_iso, paidAt: o.paid_iso, expiresAt: o.expires_at,
    preparingAt: o.preparing_at, outAt: o.out_at, deliveredAt: o.delivered_at,
  };
}
