import { ensureFoodSchema, confirmFoodPayment, trackUrl } from './_lib/foodOrders.js';

// GET /api/food-verify?reference=xxx -- older return address (/food/success)
// for payments started before the order status page existed. Confirms the
// payment with Paystack on the server, then points to the status page.
export async function onRequestGet({ request, env, waitUntil }) {
  const reference = new URL(request.url).searchParams.get('reference');
  if (!reference) return Response.json({ error: 'Missing reference' }, { status: 400 });
  await ensureFoodSchema(env.DB);
  let order = await env.DB.prepare(`SELECT * FROM food_orders WHERE paystack_reference = ?`).bind(reference).first();
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (!order.view_token) {
    const t = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(`UPDATE food_orders SET view_token = ? WHERE id = ? AND view_token IS NULL`).bind(t, order.id).run();
    order = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(order.id).first();
  }
  try { await confirmFoodPayment(env, order, { waitUntil, origin: new URL(request.url).origin }); } catch (err) { console.error('[food] verify', err); }
  return Response.json({ redirect: trackUrl(new URL(request.url).origin, order).replace(new URL(request.url).origin, '') });
}
