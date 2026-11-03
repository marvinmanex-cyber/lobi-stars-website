// MatchDay Kitchen (/matchday-kitchen): the ONLY place the kitchen staff area
// reads or changes the website's food orders and menu. Everything here works
// on the same tables the website uses (food_orders, food_items,
// food_categories), so a status changed in the kitchen is the order's real
// status on the fan's tracking page, the admin Live Order Board and the
// reports; a dish marked sold out disappears from /kitchen and /food at once.
//
// DATA maps the kitchen's words (New, Preparing, Ready…) to the website's
// order statuses. Change it here, not in the pages.
// Status changes go through foodOrders.moveOrder (the same rules, alerts and
// time stamps as the admin pages); menu changes update only the one field
// (plus updated_at) and write the dish's history.
import { ensureFoodSchema, moveOrder, STATUS, STAFF_MOVES, whereText, formatNaira, expireStale } from './foodOrders.js';
import { ensureMenuSchema, history } from './foodMenuDb.js';
import { receiptEmailHtml, receiptWhatsappText, receiptPdf, receiptPdfName, waNumber, canReceipt, LOGO_JPEG } from './foodReceipt.js';
import { sendEmail } from './email.js';

export const DATA = {
  orders: 'food_orders', items: 'food_items', categories: 'food_categories',
  // The kitchen's statuses and the website statuses they cover.
  stages: {
    new: { label: 'New', statuses: ['PAID', 'ACCEPTED'] },
    preparing: { label: 'Preparing', statuses: ['PREPARING'] },
    ready: { label: 'On the way', statuses: ['OUT_FOR_DELIVERY'] },
  },
  kitchenScreen: ['PAID', 'ACCEPTED', 'PREPARING'],       // tickets to cook (they can be late)
  // The kitchen screen also keeps orders on the way until someone taps "Mark delivered".
  kitchenShows: ['PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'],
  board: ['PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'],
  cancelled: ['CANCELLED', 'REFUNDED'],
  // The next step for each status (the big green button). The order of service:
  // New (paid) -> Accept order -> Received -> Start cooking -> Preparing -> Food on the way
  // -> On the way -> Mark delivered -> Delivered (receipt emailed; WhatsApp receipt one tap).
  next: {
    PAID: { to: 'ACCEPTED', label: 'Accept order' },
    ACCEPTED: { to: 'PREPARING', label: 'Start cooking' },
    PREPARING: { to: 'OUT_FOR_DELIVERY', label: 'Food on the way' },
    OUT_FOR_DELIVERY: { to: 'DELIVERED', label: 'Mark delivered' },
    AWAITING_WHATSAPP: { to: 'CONFIRMED', label: 'Confirm order' },
    CONFIRMED: { to: 'PAID', label: 'Payment received' },
  },
  // Kitchen words for the website statuses (everything else uses the website label).
  // Same words as the fan's tracking page (Received, Preparing, On the way, Delivered).
  labels: { PAID: 'New', ACCEPTED: 'Received', PREPARING: 'Preparing', OUT_FOR_DELIVERY: 'On the way', DELIVERED: 'Delivered' },
  lateMinutes: 15,
  // The kitchen screen and live board show one match day: orders from the last 12 hours
  // (an order left unfinished from an earlier match is still in Food orders, not on the screen).
  serviceHours: 12,
};
const since = () => new Date(Date.now() - DATA.serviceHours * 3600e3).toISOString();

export const statusLabel = s => DATA.labels[s] || STATUS[s]?.label || s;
const stageOf = s => Object.keys(DATA.stages).find(k => DATA.stages[k].statuses.includes(s)) || null;
const placeholders = a => a.map(() => '?').join(',');
const items = o => { try { return JSON.parse(o.items_json || '[]'); } catch { return []; } };
/** When the kitchen's clock starts: when the order was paid (WhatsApp orders: when payment was confirmed), else when it was placed. */
const paidAt = o => o.paid_iso || o.created_iso || (o.created_at ? `${o.created_at.replace(' ', 'T')}Z` : null);
// Orders for kick-off or half-time are counted from the time they are due, not when they were paid.
const startedAt = o => (o.deliver_at && Date.parse(o.deliver_at) > Date.parse(paidAt(o) || 0) ? o.deliver_at : paidAt(o));
const minutesSince = iso => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)) : 0);

// Pickup orders aren't carried to a seat: the same step reads "Ready for pickup".
const pickup = o => o.fulfilment === 'pickup';
function nextFor(o) {
  const n = DATA.next[o.order_status];
  if (n && o.order_status === 'PREPARING' && pickup(o)) return { ...n, label: 'Ready for pickup' };
  return n || null;
}
/** One order as the kitchen pages show it. */
export function ticket(o, lateMinutes = DATA.lateMinutes) {
  const waited = minutesSince(startedAt(o));
  // Late = not delivered within the target (5 minutes by default) of payment, at any step.
  const inKitchen = DATA.kitchenShows.includes(o.order_status);
  return {
    id: o.id, ref: o.ref || o.id, status: o.order_status, statusLabel: o.order_status === 'OUT_FOR_DELIVERY' && pickup(o) ? 'Ready for pickup' : statusLabel(o.order_status), stage: stageOf(o.order_status),
    customer: o.customer_name || '', where: o.seat || o.pickup_point ? whereText(o) : '', note: o.notes || '',
    items: items(o).map(i => ({ name: i.name, qty: i.qty, note: i.note || '' })),
    itemCount: items(o).reduce((n, i) => n + (Number(i.qty) || 0), 0),
    total: formatNaira(o.total_kobo), totalKobo: o.total_kobo, channel: o.channel, phone: o.phone ? String(o.phone).replace(/\d(?=\d{4})/g, '•') : '',
    placedAt: o.created_iso || null, paidAt: o.paid_iso || null, statusAt: o.status_at || null, statusBy: o.status_by || '',
    minutes: waited, late: inKitchen && waited >= lateMinutes && Date.parse(startedAt(o) || 0) <= Date.now(),
    deliverWhen: o.deliver_when || 'now', deliverAt: o.deliver_at || null,
    next: nextFor(o),
  };
}

async function ready(db) { await ensureFoodSchema(db); await ensureMenuSchema(db); }

export async function getOrder(db, id) {
  await ready(db);
  return db.prepare(`SELECT * FROM food_orders WHERE id = ? OR ref = ?`).bind(String(id), String(id)).first();
}

/** Kitchen screen: orders to cook (New, Preparing) and on the way (until delivered), oldest first. */
export async function kitchenTickets(db, lateMinutes) {
  await ready(db);
  const { results } = await db.prepare(`SELECT * FROM food_orders WHERE order_status IN (${placeholders(DATA.kitchenShows)}) AND COALESCE(paid_iso, created_iso) >= ? ORDER BY COALESCE(paid_iso, created_iso) LIMIT 200`).bind(...DATA.kitchenShows, since()).all();
  return results.map(o => ticket(o, lateMinutes));
}

/** Live order board: New / Preparing / Ready columns. */
export async function boardColumns(db, lateMinutes) {
  await ready(db);
  const { results } = await db.prepare(`SELECT * FROM food_orders WHERE order_status IN (${placeholders(DATA.board)}) AND COALESCE(paid_iso, created_iso) >= ? ORDER BY COALESCE(paid_iso, created_iso) LIMIT 300`).bind(...DATA.board, since()).all();
  const cols = Object.fromEntries(Object.entries(DATA.stages).map(([k, v]) => [k, { label: v.label, orders: [] }]));
  for (const o of results) { const t = ticket(o, lateMinutes); if (cols[t.stage]) cols[t.stage].orders.push(t); }
  return cols;
}

/**
 * Not paid (the board's "Awaiting payment" box): orders placed in the last 12 hours that
 * are still waiting for payment, or that failed / ran out of time. Staff can see who
 * ordered and ask them on WhatsApp what went wrong. A paid order leaves this box and
 * appears as New.
 */
export const UNPAID = ['AWAITING_PAYMENT', 'AWAITING_WHATSAPP', 'CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED'];
export async function unpaidOrders(db) {
  await ready(db);
  await expireStale(db).catch(() => {});
  const { results } = await db.prepare(`SELECT * FROM food_orders WHERE order_status IN (${placeholders(UNPAID)}) AND created_iso >= ? ORDER BY created_iso DESC LIMIT 100`).bind(...UNPAID, since()).all();
  return results.map(o => {
    const phone = String(o.phone || '').replace(/\D/g, '').replace(/^0/, '234');
    const first = String(o.customer_name || '').trim().split(/\s+/)[0] || 'there';
    const failed = ['PAYMENT_FAILED', 'EXPIRED'].includes(o.order_status);
    const msg = failed
      ? `Hi ${first}, this is MatchDay Kitchen (Lobi Stars FC). We saw your food order ${o.ref} was not paid. Did something go wrong with the payment? We can help you order again.`
      : `Hi ${first}, this is MatchDay Kitchen (Lobi Stars FC). Your food order ${o.ref} is waiting for payment. Do you need help paying?`;
    return {
      id: o.id, ref: o.ref || o.id, status: o.order_status, statusLabel: STATUS[o.order_status]?.label || o.order_status, failed,
      customer: o.customer_name || '', where: o.seat || o.pickup_point ? whereText(o) : '', channel: o.channel || 'paystack',
      items: items(o).map(i => ({ name: i.name, qty: i.qty })), total: formatNaira(o.total_kobo),
      phone: o.phone ? String(o.phone).replace(/\d(?=\d{4})/g, '•') : '', minutes: minutesSince(o.created_iso),
      chatUrl: phone.length >= 12 ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : null,
    };
  });
}

/** Lagos day (YYYY-MM-DD) -> the UTC start and end of that day. */
export function lagosDay(day) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${d}T00:00:00Z`) - 3600e3).toISOString();
  const end = new Date(Date.parse(`${d}T00:00:00Z`) + 23 * 3600e3).toISOString();
  return { day: d, start, end };
}

export async function alerts(db, lateMinutes) {
  await ready(db);
  const late = (await kitchenTickets(db, lateMinutes)).filter(t => t.late);
  const soldOut = (await db.prepare(`SELECT i.id, i.name, c.name AS category FROM food_items i LEFT JOIN food_categories c ON c.id = i.category_id WHERE i.sold_out = 1 AND i.archived = 0 ORDER BY c.sort, i.sort, i.name`).all()).results;
  const { start, end } = lagosDay();
  const cancelled = (await db.prepare(`SELECT * FROM food_orders WHERE order_status IN (${placeholders(DATA.cancelled)}) AND COALESCE(cancelled_at, status_at, created_iso) >= ? AND COALESCE(cancelled_at, status_at, created_iso) < ? ORDER BY COALESCE(cancelled_at, status_at) DESC LIMIT 100`)
    .bind(...DATA.cancelled, start, end).all()).results.map(o => ticket(o, lateMinutes));
  return { late, soldOut, cancelled };
}

/** Food orders: search by order number or name, filter by status and day; 30 a page. */
export async function searchOrders(db, { q = '', status = '', day = '', page = 1 } = {}, lateMinutes) {
  await ready(db);
  await expireStale(db).catch(() => {});
  const { day: d, start, end } = lagosDay(day);
  const w = ['created_iso >= ?', 'created_iso < ?'], b = [start, end];
  const text = String(q || '').trim().slice(0, 60);
  if (text) { w.push('(ref LIKE ? OR customer_name LIKE ? OR id = ?)'); b.push(`%${text}%`, `%${text}%`, text); }
  if (status && DATA.stages[status]) { w.push(`order_status IN (${placeholders(DATA.stages[status].statuses)})`); b.push(...DATA.stages[status].statuses); }
  else if (status === 'cancelled') { w.push(`order_status IN (${placeholders(DATA.cancelled)})`); b.push(...DATA.cancelled); }
  else if (status && STATUS[status]) { w.push('order_status = ?'); b.push(status); }
  const p = Math.max(1, Math.min(1000, Number(page) || 1));
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE ${w.join(' AND ')}`).bind(...b).first()).n;
  const rows = (await db.prepare(`SELECT * FROM food_orders WHERE ${w.join(' AND ')} ORDER BY created_iso DESC LIMIT 30 OFFSET ?`).bind(...b, (p - 1) * 30).all()).results;
  return { day: d, page: p, pages: Math.max(1, Math.ceil(total / 30)), total, orders: rows.map(o => ticket(o, lateMinutes)) };
}

/** The status changes allowed from this order's status (the website's own rules), next step first. */
export function movesFor(o) {
  const next = DATA.next[o.order_status]?.to;
  const all = STAFF_MOVES[o.order_status] || [];
  return [...all].sort((a, b) => (a === next ? -1 : b === next ? 1 : 0)).map(to => ({ to, label: statusLabel(to), next: to === next, cancel: DATA.cancelled.includes(to) }));
}

/** Changes an order's status (through the website's moveOrder). Returns { ok, from, to } or { error }. */
export async function setStatus(db, id, to, staffName, env = null) {
  const o = await getOrder(db, id);
  if (!o) return { error: 'That order no longer exists.' };
  const problem = await moveOrder(db, o, String(to), staffName, env);
  if (problem) return { error: problem };
  return { ok: true, ref: o.ref || o.id, from: o.order_status, to: String(to) };
}

/** Menu and prices, grouped by category (archived dishes left out). */
export async function menu(db) {
  await ready(db);
  const cats = (await db.prepare(`SELECT id, name FROM food_categories ORDER BY sort, name`).all()).results;
  const dishes = (await db.prepare(`SELECT id, name, price_kobo, category_id, available, sold_out, emoji FROM food_items WHERE archived = 0 ORDER BY sort, name`).all()).results;
  const groups = cats.map(c => ({ id: c.id, name: c.name, dishes: [] }));
  const other = { id: '', name: 'Other', dishes: [] };
  for (const d of dishes) (groups.find(g => g.id === d.category_id) || other).dishes.push({ id: d.id, name: d.name, emoji: d.emoji || '', price: d.price_kobo / 100, priceText: formatNaira(d.price_kobo), soldOut: !!d.sold_out, available: !!d.available });
  return [...groups, other].filter(g => g.dishes.length);
}

export async function setSoldOut(db, id, soldOut, by) {
  await ready(db);
  const d = await db.prepare(`SELECT id, name, sold_out FROM food_items WHERE id = ? AND archived = 0`).bind(String(id)).first();
  if (!d) return { error: 'That dish is no longer on the menu.' };
  const on = soldOut ? 1 : 0;
  // Back on also clears a stock count of 0 (as the admin menu does).
  await db.prepare(`UPDATE food_items SET sold_out = ?, stock = CASE WHEN ? = 0 AND stock = 0 THEN NULL ELSE stock END, updated_at = ? WHERE id = ?`).bind(on, on, new Date().toISOString(), d.id).run();
  await history(db, d.id, by, on ? 'Marked sold out (MatchDay Kitchen)' : 'Back on (MatchDay Kitchen)');
  return { ok: true, name: d.name, changed: !!d.sold_out !== !!on };
}

/** Price in naira (whole or with kobo). */
export async function setPrice(db, id, price, by) {
  await ready(db);
  const n = Number(String(price ?? '').replace(/[₦,\s]/g, ''));
  if (String(price ?? '').trim() === '' || !Number.isFinite(n) || n < 0) return { error: 'Enter the price as a number, e.g. 2500.' };
  if (n > 1_000_000) return { error: 'That price looks too high. Enter the price in naira, e.g. 2500.' };
  const kobo = Math.round(n * 100);
  const d = await db.prepare(`SELECT id, name, price_kobo FROM food_items WHERE id = ? AND archived = 0`).bind(String(id)).first();
  if (!d) return { error: 'That dish is no longer on the menu.' };
  if (kobo === d.price_kobo) return { ok: true, name: d.name, unchanged: true, old: formatNaira(d.price_kobo), new: formatNaira(kobo) };
  await db.prepare(`UPDATE food_items SET price_kobo = ?, updated_at = ? WHERE id = ?`).bind(kobo, new Date().toISOString(), d.id).run();
  await history(db, d.id, by, `Price changed from ${formatNaira(d.price_kobo)} to ${formatNaira(kobo)} (MatchDay Kitchen)`);
  return { ok: true, name: d.name, old: formatNaira(d.price_kobo), new: formatNaira(kobo) };
}

/** Food analytics for one Lagos day: paid orders only; cancelled orders left out of sales and dish counts. */
export async function analytics(db, day) {
  await ready(db);
  const { day: d, start, end } = lagosDay(day);
  const rows = (await db.prepare(`SELECT order_status, total_kobo, items_json, COALESCE(paid_iso, created_iso) AS at FROM food_orders WHERE payment_status = 'paid' AND COALESCE(paid_iso, created_iso) >= ? AND COALESCE(paid_iso, created_iso) < ?`).bind(start, end).all()).results;
  const cancelled = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status IN (${placeholders(DATA.cancelled)}) AND COALESCE(cancelled_at, status_at, created_iso) >= ? AND COALESCE(cancelled_at, status_at, created_iso) < ?`).bind(...DATA.cancelled, start, end).first()).n;
  const live = rows.filter(r => !DATA.cancelled.includes(r.order_status));
  const sales = live.reduce((s, r) => s + (r.total_kobo || 0), 0);
  const dishes = new Map(), hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  for (const r of live) {
    for (const i of items(r)) dishes.set(i.name, (dishes.get(i.name) || 0) + (Number(i.qty) || 0));
    const h = new Date(Date.parse(r.at) + 3600e3).getUTCHours(); hours[h].orders++;
  }
  return {
    day: d, orders: live.length, salesKobo: sales, sales: formatNaira(sales), average: formatNaira(live.length ? Math.round(sales / live.length) : 0), cancelled,
    topDishes: [...dishes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty })),
    byHour: hours.filter(h => h.orders || (h.hour >= 10 && h.hour <= 22)),
  };
}

/** The data check (the brief's check_kitchen_data): each step OK or PROBLEM with the reason. */
export async function checkData(db) {
  const out = [];
  const step = async (name, f) => { try { const r = await f(); out.push({ name, ok: true, detail: r }); } catch (e) { out.push({ name, ok: false, detail: String(e?.message || e) }); } };
  await step('Reading orders', async () => `${(await db.prepare(`SELECT COUNT(*) AS n FROM food_orders`).first()).n} orders in the website's table`);
  await step('Kitchen screen', async () => `${(await kitchenTickets(db)).length} order(s) to cook now`);
  await step('Search', async () => `${(await searchOrders(db, {})).total} order(s) today`);
  await step('Menu', async () => { const m = await menu(db); return `${m.reduce((n, g) => n + g.dishes.length, 0)} dishes in ${m.length} categories`; });
  await step('Analytics', async () => { const a = await analytics(db); return `${a.orders} paid order(s) today, ${a.sales}`; });
  return out;
}

/**
 * The alarm check every open kitchen app makes every 10 seconds: orders not accepted yet
 * (they beep until someone taps Accept order) and orders not delivered within the target.
 * Only a few columns of today's open orders (indexed by status), so it stays cheap.
 */
export async function pulse(db, lateMinutes) {
  await ready(db);
  const { results } = await db.prepare(`SELECT id, ref, order_status, paid_iso, created_iso, created_at, seat, stand, fulfilment, pickup_point, deliver_at FROM food_orders WHERE order_status IN (${placeholders(DATA.kitchenShows)}) AND COALESCE(paid_iso, created_iso) >= ? ORDER BY COALESCE(paid_iso, created_iso) LIMIT 200`).bind(...DATA.kitchenShows, since()).all();
  const one = o => ({ id: o.id, ref: o.ref || o.id, no: String(o.ref || o.id).split('-').pop(), status: statusLabel(o.order_status), minutes: minutesSince(startedAt(o)), where: o.seat || o.pickup_point ? whereText(o) : '' });
  return {
    newOrders: results.filter(o => o.order_status === 'PAID').map(one),
    late: results.filter(o => Date.parse(startedAt(o) || 0) <= Date.now() && minutesSince(startedAt(o)) >= lateMinutes).map(one),
    lateMinutes,
  };
}

const SITE = 'https://lobistarsfc.com';
/**
 * After "Mark delivered": the receipt (PDF attached) is emailed to the buyer when they gave
 * an email and email is set up; the WhatsApp receipt is one tap for staff (WhatsApp does not
 * let a website send messages by itself). Returns what happened, for the kitchen app.
 */
export async function receiptAfterDelivery(env, id, by) {
  const o = await getOrder(env.DB, id);
  if (!o || !canReceipt(o)) return { emailed: false, whatsappUrl: null };
  const out = { emailed: false, email: o.email || '', whatsappUrl: null };
  const phone = waNumber(o.phone || '');
  if (phone) out.whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(receiptWhatsappText(env, o))}`;
  if (o.email && !o.receipt_email_at && env.RESEND_API_KEY) {
    try {
      let logo = null;
      try { const r = await env.ASSETS.fetch(new URL(LOGO_JPEG, SITE)); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch { /* without the logo */ }
      const pdf = receiptPdf(o, logo);
      let bin = ''; for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
      await sendEmail(env, { to: o.email, subject: `Your MatchDay Kitchen receipt – ${o.ref}`, html: receiptEmailHtml(env, o), attachments: [{ filename: receiptPdfName(o), content: btoa(bin) }] });
      await env.DB.prepare(`UPDATE food_orders SET receipt_email_at = ?, receipt_email_to = ?, receipt_by = ? WHERE id = ?`).bind(new Date().toISOString(), o.email, by, o.id).run();
      out.emailed = true;
    } catch (err) { console.error('[kitchen] receipt email', err); }
  } else if (o.receipt_email_at) out.emailed = true;
  return out;
}
/** What the kitchen app needs to draw the receipt picture (and the fan's WhatsApp chat link). */
export async function receiptData(env, id) {
  const o = await getOrder(env.DB, id);
  if (!o) return null;
  if (!canReceipt(o)) return { error: 'There is no receipt for this order: it has not been paid.' };
  const phone = waNumber(o.phone || '');
  const first = String(o.customer_name || '').trim().split(/\s+/)[0] || 'there';
  return {
    ref: o.ref || o.id, name: o.customer_name || '', where: o.seat || o.pickup_point ? whereText(o) : '',
    items: items(o).map(i => ({ name: i.name, qty: Number(i.qty) || 0, priceKobo: Number(i.priceKobo) || 0 })), totalKobo: o.total_kobo,
    pointsKobo: o.points_kobo || 0, voucherKobo: o.voucher_kobo || 0,
    paidAt: o.paid_iso || o.created_iso, deliveredAt: o.delivered_at || null, channel: o.channel || 'paystack',
    chatUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`Hi ${first}, thank you for ordering from MatchDay Kitchen. Your receipt for order ${o.ref} is below 👇`)}` : null,
    pdfUrl: `${SITE}/api/food/receipt?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`,
  };
}
/** The WhatsApp receipt was opened from the kitchen app: recorded on the order. */
export async function markWhatsappReceipt(db, id, by) {
  await db.prepare(`UPDATE food_orders SET receipt_wa_at = ?, receipt_by = COALESCE(receipt_by, ?) WHERE id = ? OR ref = ?`).bind(new Date().toISOString(), by, String(id), String(id)).run();
}
