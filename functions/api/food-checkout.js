import { randomId } from './_lib/crypto.js';
import { initialize } from './_lib/paystackClient.js';
import { FOOD_MENU } from './_lib/foodMenu.js';
import { ensureFoodSchema, nextRef, foodSettings } from './_lib/foodOrders.js';
import { normalizeNigerianPhone, rateLimit, tooMany, clientIp, ensureFanSchema } from './_lib/fans.js';
import { listMatches, isMatchDay, toSummary } from './_lib/matchCentre.js';

// POST /api/food-checkout { name, seat, stand, phone, email, notes, items: [{ id, qty }] }
// Saves the order straight away as AWAITING_PAYMENT with a reference such as
// FD-20261011-0042, then returns the Paystack checkout address. Prices come
// from the server's menu only (never from the browser). The order becomes
// PAID only when the server has confirmed the payment with Paystack.
export async function onRequestPost({ request, env }) {
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

  const orderItems = [];
  let totalKobo = 0;
  for (const item of items) {
    const menuItem = FOOD_MENU[item?.id];
    const qty = Number.parseInt(item?.qty, 10);
    if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      return Response.json({ error: `Invalid item or quantity: ${item?.id}` }, { status: 400 });
    }
    // A copy of the name and price at the time of ordering (later menu changes never alter this order).
    orderItems.push({ id: item.id, name: menuItem.name, priceKobo: menuItem.priceKobo, qty });
    totalKobo += menuItem.priceKobo * qty;
  }

  await ensureFoodSchema(env.DB);
  const { paymentExpiryMinutes } = await foodSettings(env.DB);
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
