import { verify } from '../_lib/paystackClient.js';
import { ensureSeasonSchema, fulfilSeasonOrder, TIER_LABELS } from '../_lib/seasonTickets.js';

// GET /api/season-tickets/order?reference=… -- the page buyers return to after
// paying. Confirms with Paystack if the webhook hasn't arrived yet, then shows
// the passes (codes for the QR images). Only someone with the payment
// reference (from Paystack's redirect) can see them.
export async function onRequestGet({ request, env, waitUntil }) {
  const reference = new URL(request.url).searchParams.get('reference') || '';
  if (!/^LSSZN-[A-Z0-9]{6,20}$/.test(reference)) return Response.json({ error: 'Missing reference' }, { status: 400 });
  try {
    await ensureSeasonSchema(env.DB);
    let order = await env.DB.prepare(`SELECT * FROM season_orders WHERE paystack_reference = ?`).bind(reference).first();
    if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
    if (order.payment_status !== 'paid') {
      try {
        const t = await verify(env, reference);
        if (t.status === 'success' && t.amount === order.total_kobo && (t.currency || 'NGN') === 'NGN') {
          await fulfilSeasonOrder(env, order, waitUntil);
          order = await env.DB.prepare(`SELECT * FROM season_orders WHERE id = ?`).bind(order.id).first();
        }
      } catch (err) { console.error('[season] verify', err); }
    }
    if (order.payment_status !== 'paid') return Response.json({ paid: false }, { headers: { 'Cache-Control': 'no-store' } });
    const { results } = await env.DB.prepare(`SELECT id FROM season_passes WHERE order_id = ? ORDER BY id`).bind(order.id).all();
    return Response.json({
      paid: true, season: order.season, stand: TIER_LABELS[order.tier] || order.tier, quantity: order.quantity,
      name: order.buyer_name, email: order.buyer_email, passes: results.map(r => r.id),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[season] order', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
