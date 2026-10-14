import { verifyWebhookSignature } from './_lib/paystack.js';
import { fulfillOrder } from './_lib/fulfillOrder.js';
import { ensureFoodSchema, confirmFoodPayment } from './_lib/foodOrders.js';
import { findPayment, fulfilPayment } from './_lib/extraPayments.js';
import { ensureTicketShopSchema, fulfilBasket } from './_lib/ticketShop.js';
import { ensureDiscountSchema, lockedTotalOk } from './_lib/ticketDiscounts.js';
import { reversePoints } from './_lib/rewardsEarn.js';

// POST /api/paystack-webhook -- Paystack calls this server-to-server after a
// payment attempt. This (not the browser redirect) is the source of truth
// for marking an order paid and issuing tickets/food confirmations, since a
// buyer can close their browser before the redirect completes.
//
// One Paystack account has exactly one webhook URL, so this handles both
// ticket orders, food orders, online membership and personalised shirts --
// whichever table has a matching reference.
export async function onRequestPost({ request, env, waitUntil }) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  const validSig = await verifyWebhookSignature(env.PAYSTACK_SECRET_KEY, rawBody, signature);
  if (!validSig) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  // Lobi Stars Rewards: a refund or a chargeback/dispute on any payment takes
  // back the Pride Points earned on it (the balance may go below zero).
  if (/^(refund\.processed|charge\.dispute\.create)$/.test(event.event || '')) {
    const ref = event.data?.transaction?.reference || event.data?.transaction_reference || event.data?.reference;
    if (ref) await reversePoints(env, { payRef: String(ref) }, event.event === 'refund.processed' ? 'payment refunded' : 'payment disputed');
    return new Response('OK', { status: 200 });
  }
  if (event.event !== 'charge.success') {
    return new Response('Ignored', { status: 200 });
  }

  const { reference, amount } = event.data;

  // Tickets for several matches in one payment (Tickets page).
  if (/^LSBAS-/.test(reference || '')) {
    await ensureTicketShopSchema(env.DB);
    await ensureDiscountSchema(env.DB);
    const basket = await env.DB.prepare(`SELECT * FROM league_ticket_orders WHERE reference = ?`).bind(reference).first();
    if (!basket) return new Response('Order not found', { status: 404 });
    if (amount !== basket.total_kobo || (event.data.currency || 'NGN') !== 'NGN') return new Response('Amount mismatch', { status: 400 });
    // Re-check the locked price: the discount snapshot priced again by the same
    // function (computeOrderPricing) must give the amount charged.
    if (!(await lockedTotalOk(env.DB, basket))) { console.error('[tickets] locked total mismatch', basket.reference); return new Response('Amount mismatch', { status: 400 }); }
    // Safe to repeat: a second delivery issues nothing new and sends no second email.
    await fulfilBasket(env, basket, waitUntil);
    return new Response('OK', { status: 200 });
  }

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

  await ensureFoodSchema(env.DB);
  const foodOrder = await env.DB.prepare(
    `SELECT * FROM food_orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (foodOrder) {
    if (amount !== foodOrder.total_kobo) {
      return new Response('Amount mismatch', { status: 400 });
    }
    // Food orders are only marked paid after the server checks the payment
    // with Paystack's Verify Transaction API (amount, NGN and reference).
    // Repeated webhooks are ignored (the order is already paid).
    try {
      await confirmFoodPayment(env, foodOrder, { waitUntil, origin: new URL(request.url).origin });
    } catch (err) {
      console.error('[food] verify failed', err);
      return new Response('Could not verify the payment yet', { status: 500 }); // Paystack retries later
    }
    return new Response('OK', { status: 200 });
  }

  const other = await findPayment(env.DB, reference);
  if (other) {
    if (amount !== other.amount) return new Response('Amount mismatch', { status: 400 });
    await fulfilPayment(env, other, waitUntil);
    return new Response('OK', { status: 200 });
  }

  return new Response('Order not found', { status: 404 });
}
