import { randomId } from '../_lib/crypto.js';
import { ensureMenuSchema, orderingState } from '../_lib/foodMenuDb.js';
import { ensureFoodSchema, nextRef, foodSettings, priceCart, whatsappOrderMessage, whatsappUrl, formatNaira, trackUrl } from '../_lib/foodOrders.js';
import { normalizeNigerianPhone, rateLimit, tooMany, clientIp, ensureFanSchema, checkTurnstile } from '../_lib/fans.js';
import { listMatches, isMatchDay, toSummary } from '../_lib/matchCentre.js';
import { raiseFoodAlert } from '../_lib/foodAlerts.js';
import { captureContact, splitName } from '../_lib/contacts.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (v, n) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');

// POST /api/food/whatsapp-order -- "Order on WhatsApp".
// Body: { name, phone, fulfilment: 'seat'|'pickup', seat, stand, pickupPoint, email?, notes,
//         adultConfirmed, items: [{ id, qty }], turnstileToken, website }
// Saves the order (status AWAITING_WHATSAPP, a reference such as FD-20261011-0042)
// with prices from the menu in the database (never from the browser), alerts
// the staff, and returns the WhatsApp link with the order message for the
// club number. Staff then confirm it, take payment and mark it paid.
// "website" is a hidden trap field: robots fill it in, people never see it.
export async function onRequestPost({ request, env, waitUntil }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  b = b || {};
  try {
    if (typeof b.website === 'string' && b.website.trim()) return json({ ok: true, ref: 'FD-00000000-0000', whatsappUrl: 'https://wa.me/', message: '' }); // robot: pretend
    const name = clean(b.name, 60), seat = clean(b.seat, 20), stand = clean(b.stand, 60), notes = clean(b.notes, 300), pickupPoint = clean(b.pickupPoint, 60);
    const email = clean(b.email, 200).toLowerCase();
    const phone = normalizeNigerianPhone(b.phone);
    const pickup = b.fulfilment === 'pickup';
    const items = Array.isArray(b.items) ? b.items : [];
    if (name.length < 2) return json({ error: 'Please enter your name.' }, 400);
    if (!phone) return json({ error: 'Please enter a valid Nigerian mobile number (e.g. 0803 123 4567).' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'Please check your email address (or leave it empty).' }, 400);
    if (!items.length || items.length > 20) return json({ error: 'Please choose between 1 and 20 different items.' }, 400);
    if (!pickup && !seat) return json({ error: 'Please enter your seat number.' }, 400);

    await ensureFanSchema(env.DB); // rate limit table
    if (!(await rateLimit(env.DB, `food-wa:${clientIp(request)}`, 20, 600))) return tooMany();
    if (!(await rateLimit(env.DB, `food-wa-phone:${phone}`, 5, 1800))) return json({ error: 'You have placed several orders in the last 30 minutes. Please message us on WhatsApp if you need to change an order.' }, 429);
    if (!(await checkTurnstile(env, b.turnstileToken, clientIp(request)))) return json({ error: 'Please complete the human check and try again.' }, 400);

    await ensureFoodSchema(env.DB);
    await ensureMenuSchema(env.DB);
    const settings = await foodSettings(env.DB);
    if (!settings.whatsappEnabled) return json({ error: 'Ordering on WhatsApp is not available right now. Please use Place Order & Pay.' }, 503);
    if (!(await orderingState(env, settings)).open) return json({ error: 'In-seat ordering is closed at the moment. It opens on matchday.', code: 'closed' }, 503);
    if (pickup && !settings.pickupPoints.includes(pickupPoint)) return json({ error: 'Please choose where you will collect your order.' }, 400);
    if (!pickup && settings.stands.length && !settings.stands.includes(stand)) return json({ error: 'Please choose your stand from the list.' }, 400);

    const priced = await priceCart(env.DB, items);
    if (priced.error) return json({ error: priced.error, code: priced.status === 409 ? 'stock' : undefined }, priced.status);
    const { orderItems, totalKobo, adult } = priced;
    if (adult && b.adultConfirmed !== true) return json({ error: 'Please confirm you are 18 or older to order alcoholic drinks.', code: 'adult' }, 400);
    if (settings.minOrderKobo && totalKobo < settings.minOrderKobo) return json({ error: `The minimum order is ${formatNaira(settings.minOrderKobo)}.` }, 400);

    let eventId = null;
    try {
      const now = Date.now();
      const m = (await listMatches(env.DB)).map(r => toSummary(r, r)).find(x => x.is_home && isMatchDay(x, now));
      eventId = m?.id || null;
    } catch { /* no match today */ }

    const id = randomId('LS-FOOD');
    const ref = await nextRef(env.DB);
    const token = randomId('t', 20);
    const created = new Date();
    const expires = new Date(created.getTime() + settings.whatsappExpiryHours * 3600e3);
    const order = {
      id, ref, seat: pickup ? '' : seat, stand: pickup ? null : stand || null, phone, email, customer_name: name, notes: notes || null, event_id: eventId,
      items_json: JSON.stringify(orderItems), total_kobo: totalKobo, fulfilment: pickup ? 'pickup' : 'seat', pickup_point: pickup ? pickupPoint : null,
    };
    await env.DB.prepare(
      `INSERT INTO food_orders (id, ref, seat, stand, phone, email, customer_name, notes, event_id, items_json, total_kobo, paystack_reference,
         payment_status, order_status, view_token, created_iso, expires_at, channel, fulfilment, pickup_point)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'AWAITING_WHATSAPP', ?, ?, ?, 'whatsapp', ?, ?)`
    ).bind(id, ref, order.seat, order.stand, phone, email, name, order.notes, eventId, order.items_json, totalKobo, ref,
      token, created.toISOString(), expires.toISOString(), order.fulfilment, order.pickup_point).run();

    const origin = new URL(request.url).origin;
    const later = Promise.all([
      raiseFoodAlert(env, 'whatsapp', order, { waitUntil, origin }).catch(err => console.error('[food] whatsapp alert', err)),
      (async () => { const n = splitName(name); await captureContact(env, { source: 'food_order', refTable: 'food_orders', refId: id, email: email || null, phone, firstName: n.firstName, surname: n.surname, label: ref }); })()
        .catch(err => console.error('[food] contact', err)),
    ]);
    if (waitUntil) waitUntil(later); else await later;

    const message = whatsappOrderMessage(order, orderItems);
    return json({
      ok: true, ref, totalKobo, total: formatNaira(totalKobo), message,
      whatsappUrl: whatsappUrl(settings.whatsappNumber, message), whatsappNumber: settings.whatsappNumber,
      trackUrl: trackUrl(origin, { ref, view_token: token }),
    });
  } catch (err) {
    console.error('[food] whatsapp order', err);
    return json({ error: 'Your order could not be saved just now. Please try again in a moment.' }, 500);
  }
}
