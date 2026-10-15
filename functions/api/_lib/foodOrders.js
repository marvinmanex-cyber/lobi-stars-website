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
import { verify } from './paystackClient.js';
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
  OUT_FOR_DELIVERY: { label: 'Out for delivery', color: '#7C3AED' },
  DELIVERED: { label: 'Delivered', color: '#166534' },
  PAYMENT_FAILED: { label: 'Payment failed', color: '#DC2626' },
  EXPIRED: { label: 'Expired', color: '#6B7280' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280' },
  REFUNDED: { label: 'Refunded', color: '#6B7280' },
};
/** Moves staff may make (from -> allowed next statuses). */
export const STAFF_MOVES = {
  AWAITING_WHATSAPP: ['CONFIRMED', 'PAID', 'CANCELLED'],
  CONFIRMED: ['PAID', 'AWAITING_WHATSAPP', 'CANCELLED'],
  PAID: ['ACCEPTED', 'PREPARING', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'PAID', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'ACCEPTED', 'PAID', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'PREPARING', 'CANCELLED'],
  DELIVERED: ['OUT_FOR_DELIVERY'],
  CANCELLED: ['REFUNDED', 'PAID'],
  REFUNDED: [],
};
const STAMP = { CONFIRMED: 'confirmed_at', PREPARING: 'preparing_at', OUT_FOR_DELIVERY: 'out_at', DELIVERED: 'delivered_at', CANCELLED: 'cancelled_at', REFUNDED: 'refunded_at' };

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
  ]) if (!cols.has(name)) await db.prepare(`ALTER TABLE food_orders ADD COLUMN ${name} ${type}`).run();
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_ref ON food_orders(ref) WHERE ref IS NOT NULL`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_status ON food_orders(order_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_food_kitchen ON food_orders(order_status, kitchen_ack_at)`),
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
export const WA_TEMPLATES = {
  msgConfirmed: 'Hi {name}, your Lobi Stars FC food order {ref} is confirmed. Total {total}. Please pay to {bank} and send your receipt here. Thank you!',
  msgPaid: "Hi {name}, we've received your payment for order {ref}. We're preparing your food now!",
  msgReady: 'Hi {name}, your order {ref} is ready! {where}',
  msgCancelled: "Hi {name}, sorry, your Lobi Stars FC food order {ref} has been cancelled. Please message us if you have any questions.",
};
export const FOOD_DEFAULTS = {
  paymentExpiryMinutes: 15, orderingMode: 'open', autoOpenMinutes: 90, stands: [], minOrderKobo: 0,
  // Order on WhatsApp. The number is the club WhatsApp shown on the site.
  whatsappEnabled: true, whatsappNumber: '2349030399416', whatsappExpiryHours: 3, pickupPoints: [], bankDetails: '',
  ...WA_TEMPLATES,
};
export async function foodSettings(db) {
  await ensureFoodSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM food_settings`).all();
  const s = { ...FOOD_DEFAULTS, stands: [], pickupPoints: [] };
  for (const r of results) {
    if (r.key === 'whatsappEnabled') s.whatsappEnabled = r.value === '1';
    if (r.key === 'whatsappNumber' && /^234\d{10}$/.test(r.value || '')) s.whatsappNumber = r.value;
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
  // Lobi Stars Rewards: Star Points / voucher used are taken, and food points are earned (on the part paid in naira).
  try { const { confirmCheckout } = await import('./rewardsCheckout.js'); await confirmCheckout(env, order.paystack_reference); const { earnFood } = await import('./rewardsEarn.js'); await earnFood(env, paid); } catch (err) { console.error('[food] rewards', err); }
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
  if (!res.meta?.changes) return 'Someone else has just changed this order. Refresh and try again.';
  // The kitchen has seen it (accepted, or went straight to preparing): stop repeat alerts.
  if (['ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(to) && !order.kitchen_ack_at) {
    await db.prepare(`UPDATE food_orders SET kitchen_ack_at = ?, kitchen_ack_by = ? WHERE id = ? AND kitchen_ack_at IS NULL`).bind(nowIso(), staffName, order.id).run();
  }
  // WhatsApp orders: staff confirm the payment arrived (bank transfer / cash), so it counts as paid in reports.
  if (to === 'PAID' && order.channel === 'whatsapp' && order.payment_status !== 'paid') {
    await db.prepare(`UPDATE food_orders SET payment_status = 'paid', paid_at = datetime('now'), paid_iso = ?, paid_reference = ? WHERE id = ?`)
      .bind(nowIso(), `WhatsApp: confirmed by ${staffName}`, order.id).run();
    try {
      const stmts = JSON.parse(order.items_json).map(i => db.prepare(
        `UPDATE food_items SET stock = MAX(0, stock - ?), sold_out = CASE WHEN stock - ? <= 0 THEN 1 ELSE sold_out END WHERE id = ? AND stock IS NOT NULL`
      ).bind(i.qty, i.qty, i.id));
      if (stmts.length) await db.batch(stmts);
    } catch { /* menu table not created yet */ }
  }
  return null;
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
  };
}


/**
 * Checks a cart against the menu in the database: availability, sold out,
 * limits and stock. Prices always come from the database, never the browser.
 * Returns { orderItems, totalKobo, adult } or { error, status }.
 */
export async function priceCart(db, items) {
  const { results: menu } = await db.prepare(`SELECT * FROM food_items WHERE archived = 0`).all();
  const orderItems = [];
  let totalKobo = 0, adult = false;
  const seen = new Set();
  for (const item of items) {
    const m = menu.find(x => x.id === String(item?.id || ''));
    const qty = Number.parseInt(item?.qty ?? item?.quantity, 10);
    if (!m || !m.available || !Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'One of the items is no longer on the menu. Please refresh the page.', status: 400 };
    if (seen.has(m.id)) return { error: 'The same item appears twice. Please refresh the page.', status: 400 };
    seen.add(m.id);
    if (m.sold_out || m.stock === 0) return { error: `Sorry, ${m.name} has just sold out. Please remove it and try again.`, status: 409 };
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
export function whatsappOrderMessage(o, items) {
  const lines = ['Hello Lobi Stars FC! 👋', "I'd like to place a food order.", '', `Order: ${o.ref}`, `Name: ${o.customer_name}`, `Phone: ${localPhone(o.phone)}`, ''];
  for (const i of items) lines.push(`${i.qty} × ${i.name}: ${formatNaira(i.priceKobo * i.qty)}`);
  lines.push('-----------------------', `Total: ${formatNaira(o.total_kobo)}`, '', whereText(o));
  if (o.notes) lines.push(`Note: ${o.notes}`);
  lines.push('', 'Please confirm my order. Thank you!');
  return lines.join('\n');
}
export const whatsappUrl = (number, message) => `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

/** Staff reply for an order status (templates in Ordering settings). */
export function staffMessage(settings, o, kind) {
  const t = settings[{ CONFIRMED: 'msgConfirmed', PAID: 'msgPaid', READY: 'msgReady', CANCELLED: 'msgCancelled' }[kind]] || '';
  const where = o.fulfilment === 'pickup' ? `Collect it at ${o.pickup_point || 'the pickup point'}.` : `It's on its way to seat ${o.seat}${o.stand ? `, ${o.stand}` : ''}.`;
  return t.replace(/\{(name|ref|total|bank|pickup|seat|where)\}/g, (_, k) => ({
    name: (o.customer_name || '').split(' ')[0] || 'there', ref: o.ref, total: formatNaira(o.total_kobo),
    bank: settings.bankDetails || '[bank details: add them in Ordering settings]', pickup: o.pickup_point || '', seat: o.seat || '', where,
  }[k]));
}
