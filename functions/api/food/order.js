import { ensureFoodSchema, expireStale, confirmFoodPayment, publicOrder } from '../_lib/foodOrders.js';

const noStore = { 'Cache-Control': 'no-store' };

// GET /api/food/order?ref=FD-...&t=<token> -- the fan's order status page.
// While the order is awaiting payment the server asks Paystack directly
// (at most every 8 seconds); a payment is never accepted from the browser.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const ref = (url.searchParams.get('ref') || '').trim();
  const token = (url.searchParams.get('t') || '').trim();
  if (!ref || !token) return Response.json({ error: 'Missing order reference.' }, { status: 400, headers: noStore });
  await ensureFoodSchema(env.DB);
  await expireStale(env.DB);
  let order = await env.DB.prepare(`SELECT * FROM food_orders WHERE ref = ?`).bind(ref).first();
  if (!order || !order.view_token || order.view_token !== token) return Response.json({ error: 'Order not found.' }, { status: 404, headers: noStore });

  const recently = order.last_verify_at && Date.now() - Date.parse(order.last_verify_at) < 8000;
  if (order.payment_status !== 'paid' && ['AWAITING_PAYMENT', 'EXPIRED'].includes(order.order_status) && !recently) {
    try {
      const r = await confirmFoodPayment(env, order, { waitUntil, origin: url.origin });
      order = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(order.id).first();
      if (!r.changed && r.reason === 'payment does not match the order') return Response.json({ order: publicOrder(order), problem: 'mismatch' }, { headers: noStore });
    } catch (err) { console.error('[food] status verify', err); }
  }
  return Response.json({ order: publicOrder(order) }, { headers: noStore });
}
