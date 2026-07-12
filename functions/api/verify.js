import { verifyTransaction } from './_lib/paystack.js';
import { fulfillOrder } from './_lib/fulfillOrder.js';

// GET /api/verify?reference=xxx -- called by /tickets/success right after
// Paystack redirects the buyer back. Independently confirms payment with
// Paystack's API (rather than trusting the redirect alone) and fulfills the
// order if the webhook hasn't landed yet. Safe to call repeatedly.
export async function onRequestGet({ request, env }) {
  const reference = new URL(request.url).searchParams.get('reference');
  if (!reference) {
    return Response.json({ error: 'Missing reference' }, { status: 400 });
  }

  const order = await env.DB.prepare(
    `SELECT * FROM orders WHERE paystack_reference = ?`
  ).bind(reference).first();

  if (!order) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  let tickets = [];

  if (order.payment_status === 'paid') {
    const { results } = await env.DB.prepare(`SELECT * FROM tickets WHERE order_id = ?`).bind(order.id).all();
    tickets = results;
  } else {
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

    tickets = await fulfillOrder(env, order);
  }

  const eventRow = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(order.event_id).first();

  return Response.json({
    status: 'success',
    order: {
      id: order.id,
      buyerName: order.buyer_name,
      tier: order.tier,
      quantity: order.quantity,
      totalKobo: order.total_kobo,
    },
    event: eventRow,
    tickets: tickets.map(t => t.id),
  });
}
