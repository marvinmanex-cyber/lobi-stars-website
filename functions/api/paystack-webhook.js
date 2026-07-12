import { verifyWebhookSignature } from './_lib/paystack.js';
import { fulfillOrder } from './_lib/fulfillOrder.js';
import { fulfillFoodOrder } from './_lib/fulfillFoodOrder.js';

// POST /api/paystack-webhook -- Paystack calls this server-to-server after a
// payment attempt. This (not the browser redirect) is the source of truth
// for marking an order paid and issuing tickets/food confirmations, since a
// buyer can close their browser before the redirect completes.
//
// One Paystack account has exactly one webhook URL, so this handles both
// ticket orders and food orders -- whichever table has a matching reference.
export async function onRequestPost({ request, env, waitUntil }) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  const validSig = await verifyWebhookSignature(env.PAYSTACK_SECRET_KEY, rawBody, signature);
  if (!validSig) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event !== 'charge.success') {
    return new Response('Ignored', { status: 200 });
  }

  const { reference, amount } = event.data;

  const order = await env.DB.prepare(
    `SELECT * FROM orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (order) {
    if (amount !== order.total_kobo) {
      return new Response('Amount mismatch', { status: 400 });
    }
    await fulfillOrder(env, order, waitUntil);
    return new Response('OK', { status: 200 });
  }

  const foodOrder = await env.DB.prepare(
    `SELECT * FROM food_orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (foodOrder) {
    if (amount !== foodOrder.total_kobo) {
      return new Response('Amount mismatch', { status: 400 });
    }
    await fulfillFoodOrder(env, foodOrder, waitUntil);
    return new Response('OK', { status: 200 });
  }

  return new Response('Order not found', { status: 404 });
}
