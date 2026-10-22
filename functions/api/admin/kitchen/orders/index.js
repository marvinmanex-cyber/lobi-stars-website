import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { expireStale, whereText } from '../../../_lib/foodOrders.js';
import { ensureKitchenSchema, kitchenSettings, runKitchenRepeats } from '../../../_lib/kitchenNotify.js';

// GET /api/admin/kitchen/orders -- the Kitchen Screen board: orders paid in
// the last 12 hours that are NEW (paid), COOKING (accepted / preparing) or
// READY (shown for 15 minutes), oldest payment first. Only what the kitchen
// needs: no phone numbers, totals or payment details.
// Each request also re-alerts unaccepted orders that are due (a back-up for
// the cron Worker, so repeats happen while the screen is open).
export async function onRequestGet({ request, env, waitUntil }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  try {
    await ensureKitchenSchema(db);
    await expireStale(db);
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const readySince = new Date(Date.now() - 15 * 60e3).toISOString();
    const { results } = await db.prepare(
      `SELECT * FROM (SELECT * FROM food_orders WHERE paid_iso >= ? AND (order_status IN ('PAID', 'ACCEPTED', 'PREPARING') OR (order_status = 'OUT_FOR_DELIVERY' AND out_at >= ?)) ORDER BY paid_iso DESC LIMIT 200) ORDER BY paid_iso ASC`
    ).bind(since, readySince).all();
    const now = Date.now();
    const orders = results.map(o => {
      let items = [];
      try { items = JSON.parse(o.items_json).map(i => ({ name: i.name, qty: i.qty })); } catch {}
      return {
        ref: o.ref, status: o.order_status, items, notes: o.notes || '', firstName: String(o.customer_name || '').trim().split(/\s+/)[0] || '',
        where: whereText(o), fulfilment: o.fulfilment || 'seat', channel: o.channel || 'paystack',
        paidAt: o.paid_iso, minutesSincePaid: Math.max(0, Math.floor((now - Date.parse(o.paid_iso)) / 60000)),
        acceptedAt: o.kitchen_ack_at, acceptedBy: o.kitchen_ack_by, readyAt: o.out_at, repeats: o.repeat_count || 0,
      };
    });
    // Orders on their way in but NOT paid yet (WhatsApp orders waiting for payment, card payments in progress):
    // shown greyed out on the Kitchen Screen so the kitchen sees them coming. Don't cook them yet.
    const coming = (await db.prepare(`SELECT ref, order_status, items_json, fulfilment, seat, stand, pickup_point, channel, created_iso FROM food_orders
      WHERE order_status IN ('AWAITING_WHATSAPP', 'CONFIRMED', 'AWAITING_PAYMENT') AND created_iso >= ? ORDER BY created_iso LIMIT 30`).bind(new Date(Date.now() - 3 * 3600e3).toISOString()).all()).results
      .map(o => { let items = []; try { items = JSON.parse(o.items_json).map(i => ({ name: i.name, qty: i.qty })); } catch {}
        return { ref: o.ref, items, where: whereText(o), how: o.channel === 'whatsapp' ? (o.order_status === 'CONFIRMED' ? 'WhatsApp: confirmed, waiting for payment' : 'WhatsApp: new, not confirmed yet') : 'Paying online now', at: o.created_iso }; });
    const job = runKitchenRepeats(env);
    if (waitUntil) waitUntil(job); else await job;
    const s = await kitchenSettings(db);
    return Response.json({ orders, coming, serverTime: new Date().toISOString(), alertsEnabled: s.enabled }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[kitchen] orders', err);
    return Response.json({ error: 'The orders could not be loaded. Retrying…' }, { status: 500 });
  }
}
