import { verifyWebhookSignature } from './_lib/paystack.js';
import { ensureFoodSchema, confirmFoodPayment } from './_lib/foodOrders.js';
import { reversePoints } from './_lib/rewardsEarn.js';

// POST /api/paystack-webhook-kitchen -- the webhook of MatchDay Kitchen's own Paystack account
// (PAYSTACK_KITCHEN_SECRET_KEY). It only ever touches food orders: whoever holds the kitchen's
// key can never issue a ticket or a membership through here. Food orders are still marked paid
// only after the server checks the payment with Paystack (confirmFoodPayment).
// Orders that were started on the main account finish through /api/paystack-webhook as before.
export async function onRequestPost({ request, env, waitUntil }) {
  const key = env.PAYSTACK_KITCHEN_SECRET_KEY;
  const rawBody = await request.text();
  if (!key || !(await verifyWebhookSignature(key, rawBody, request.headers.get('x-paystack-signature')))) {
    return new Response('Invalid signature', { status: 401 });
  }
  const event = JSON.parse(rawBody);
  // Website Health: when the kitchen's Paystack account last sent a (signed) confirmation.
  const seen = env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('paystack_kitchen_last_webhook', ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify({ at: new Date().toISOString(), event: String(event.event || '').slice(0, 40) })).run().catch(() => {});
  try { waitUntil(seen); } catch { /* recorded best-effort */ }

  await ensureFoodSchema(env.DB);
  const findOrder = ref => env.DB.prepare(`SELECT * FROM food_orders WHERE paystack_reference = ?`).bind(String(ref)).first();

  // A refund or a dispute takes back the Star Points earned on that food order.
  if (/^(refund\.processed|charge\.dispute\.create)$/.test(event.event || '')) {
    const ref = event.data?.transaction?.reference || event.data?.transaction_reference || event.data?.reference;
    if (ref && await findOrder(ref)) await reversePoints(env, { payRef: String(ref) }, event.event === 'refund.processed' ? 'payment refunded' : 'payment disputed');
    return new Response('OK', { status: 200 });
  }
  if (event.event !== 'charge.success') return new Response('Ignored', { status: 200 });

  const { reference, amount } = event.data || {};
  const order = reference ? await findOrder(reference) : null;
  // Not one of the website's food orders (a payment taken some other way on this account): nothing to do.
  if (!order) return new Response('Ignored', { status: 200 });
  if (amount !== order.total_kobo) return new Response('Amount mismatch', { status: 400 });
  try {
    await confirmFoodPayment(env, order, { waitUntil, origin: new URL(request.url).origin });
  } catch (err) {
    console.error('[food] kitchen verify failed', err);
    return new Response('Could not verify the payment yet', { status: 500 }); // Paystack retries later
  }
  return new Response('OK', { status: 200 });
}
