import { randomId } from './_lib/crypto.js';
import { initialize } from './_lib/paystackClient.js';
import { ensureMenuSchema, orderingState } from './_lib/foodMenuDb.js';
import { ensureFoodSchema, nextRef, foodSettings } from './_lib/foodOrders.js';
import { normalizeNigerianPhone, rateLimit, tooMany, clientIp, ensureFanSchema } from './_lib/fans.js';
import { listMatches, isMatchDay, toSummary } from './_lib/matchCentre.js';
import { raiseFoodAlert } from './_lib/foodAlerts.js';

// POST /api/food-checkout { name, seat, stand, phone, email, notes, adultConfirmed, items: [{ id, qty }] }
// Saves the order straight away as AWAITING_PAYMENT with a reference such as
// FD-20261011-0042, then returns the Paystack checkout address. Prices come
// from the server's menu only (never from the browser). The order becomes
// PAID only when the server has confirmed the payment with Paystack.
export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const b = body || {};
  const name = s(b.name, 80), seat = s(b.seat, 20), stand = s(b.stand, 60), email = s(b.email, 200).toLowerCase(), notes = s(b.notes, 200);
  const phone = normalizeNigerianPhone(b.phone);
  const items = Array.isArray(b.items) ? b.items : [];

  if (!name) return Response.json({ error: 'Please enter your name.' }, { status: 400 });
  if (!seat) return Response.json({ error: 'Please enter your seat number.' }, { status: 400 });
  if (!phone) return Response.json({ error: 'Please enter a valid Nigerian mobile number (e.g. 0803 123 4567).' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (!items.length) return Response.json({ error: 'Please choose at least one item.' }, { status: 400 });

  await ensureFanSchema(env.DB); // rate limit table
  if (!(await rateLimit(env.DB, `food:${clientIp(request)}`, 20, 600))) return tooMany();

  await ensureFoodSchema(env.DB);
  await ensureMenuSchema(env.DB);
  const settings = await foodSettings(env.DB);
  const { paymentExpiryMinutes } = settings;
  if (!(await orderingState(env, settings)).open) return Response.json({ error: 'In-seat ordering is closed at the moment. It opens on matchday.', code: 'closed' }, { status: 409 });
  if (settings.stands.length && !settings.stands.includes(stand)) return Response.json({ error: 'Please choose your stand from the list.' }, { status: 400 });

  // Prices, availability and limits come from the menu in the database (Admin -> In-Seat Food -> Menu).
  const { results: menu } = await env.DB.prepare(`SELECT * FROM food_items WHERE archived = 0`).all();
  const orderItems = [];
  let totalKobo = 0, adult = false;
  for (const item of items) {
    const m = menu.find(x => x.id === String(item?.id || ''));
    const qty = Number.parseInt(item?.qty, 10);
    if (!m || !m.available || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      return Response.json({ error: 'One of the items is no longer on the menu. Please refresh the page.' }, { status: 400 });
    }
    if (m.sold_out || m.stock === 0) return Response.json({ error: `Sorry, ${m.name} has just sold out. Please remove it and try again.` }, { status: 409 });
    if (m.max_per_order && qty > m.max_per_order) return Response.json({ error: `You can order at most ${m.max_per_order} × ${m.name}.` }, { status: 400 });
    if (m.stock != null && qty > m.stock) return Response.json({ error: `Only ${m.stock} × ${m.name} left. Please reduce the quantity.` }, { status: 409 });
    if (m.adult) adult = true;
    // A copy of the name and price at the time of ordering (later menu changes never alter this order).
    orderItems.push({ id: m.id, name: m.name, priceKobo: m.price_kobo, qty });
    totalKobo += m.price_kobo * qty;
  }
  if (adult && b.adultConfirmed !== true) return Response.json({ error: 'Please confirm you are 18 or older to order alcoholic drinks.', code: 'adult' }, { status: 400 });
  if (settings.minOrderKobo && totalKobo < settings.minOrderKobo) return Response.json({ error: `The minimum order is ₦${(settings.minOrderKobo / 100).toLocaleString('en-NG')}.` }, { status: 400 });
  // The home match being played today, if any (for reports per match).
  let eventId = null;
  try {
    const now = Date.now();
    const m = (await listMatches(env.DB)).map(r => toSummary(r, r)).find(x => x.is_home && isMatchDay(x, now));
    eventId = m?.id || null;
  } catch { /* no match */ }

  const id = randomId('LS-FOOD');
  const ref = await nextRef(env.DB);
  const token = randomId('t', 20);
  const created = new Date();
  const expires = new Date(created.getTime() + paymentExpiryMinutes * 60_000);
  await env.DB.prepare(
    `INSERT INTO food_orders (id, ref, seat, stand, phone, email, customer_name, notes, event_id, items_json, total_kobo, paystack_reference,
       payment_status, order_status, view_token, created_iso, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'AWAITING_PAYMENT', ?, ?, ?)`
  ).bind(id, ref, seat, stand || null, phone, email, name, notes || null, eventId, JSON.stringify(orderItems), totalKobo, ref,
    token, created.toISOString(), expires.toISOString()).run();

  const origin = new URL(request.url).origin;
  // Staff alert "New order – awaiting payment" (in the admin; push/email only if switched on).
  const alert = raiseFoodAlert(env, 'unpaid', { id, ref, seat, stand, customer_name: name, notes, items_json: JSON.stringify(orderItems), total_kobo: totalKobo }, { waitUntil, origin })
    .catch(err => console.error('[food] unpaid alert', err));
  if (waitUntil) waitUntil(alert); else await alert;
  try {
    const p = await initialize(env, {
      email, amountKobo: totalKobo, reference: ref,
      callbackUrl: `${origin}/food/order/?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`,
      metadata: { kind: 'food', orderId: id, ref, seat, stand },
    });
    return Response.json({ authorizationUrl: p.authorization_url, ref, orderId: id });
  } catch (err) {
    return Response.json({ error: `Payment could not be started: ${err.message}`, ref }, { status: 502 });
  }
}
