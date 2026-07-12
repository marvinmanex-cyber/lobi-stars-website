import { verifyTransaction } from './_lib/paystack.js';
import { fulfillFoodOrder } from './_lib/fulfillFoodOrder.js';

// GET /api/food-verify?reference=xxx -- called by /food/success right after
// Paystack redirects the buyer back. Independently confirms payment with
// Paystack's API and fulfills the order if the webhook hasn't landed yet.
export async function onRequestGet({ request, env }) {
  const reference = new URL(request.url).searchParams.get('reference');
  if (!reference) {
    return Response.json({ error: 'Missing reference' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT * FROM food_orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  let finalOrder = order;

  if (order.payment_status !== 'paid') {
    let paystackData;
    try {
      paystackData = await verifyTransaction(env.PAYSTACK_SECRET_KEY, reference);
    } catch (err) {
      return Response.json({ error: `Could not verify payment: ${err.message}` }, { status: 502 });
    }

    if (paystackData.status !== 'success') {
      return Response.json({ status: paystackData.status, order: { id: order.id } });
    }
    if (paystackData.amount !== order.total_kobo) {
      return Response.json({ error: 'Amount mismatch' }, { status: 400 });
    }

    finalOrder = await fulfillFoodOrder(env, order);
  }

  return Response.json({
    status: 'success',
    order: {
      id: finalOrder.id,
      seat: finalOrder.seat,
      stand: finalOrder.stand,
      totalKobo: finalOrder.total_kobo,
    },
    items: JSON.parse(finalOrder.items_json),
  });
}
