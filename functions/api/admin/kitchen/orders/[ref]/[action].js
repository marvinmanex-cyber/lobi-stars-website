import { requireAdminUser } from '../../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../../_lib/adminSession.js';
import { moveOrder } from '../../../../_lib/foodOrders.js';
import { ensureKitchenSchema, clearTelegramButtons, escHtml } from '../../../../_lib/kitchenNotify.js';

// POST /api/admin/kitchen/orders/:ref/accept     PAID -> ACCEPTED (stops repeat alerts)
// POST /api/admin/kitchen/orders/:ref/preparing  ACCEPTED -> PREPARING
// POST /api/admin/kitchen/orders/:ref/ready      PREPARING -> OUT_FOR_DELIVERY (ready)
// Only these exact moves are allowed from the Kitchen Screen (409 otherwise).
const MOVES = { accept: ['PAID', 'ACCEPTED'], preparing: ['ACCEPTED', 'PREPARING'], ready: ['PREPARING', 'OUT_FOR_DELIVERY'] };

export async function onRequestPost({ request, env, params, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const move = MOVES[params.action];
  if (!move) return Response.json({ error: 'Unknown action' }, { status: 404 });
  try {
    await ensureKitchenSchema(env.DB);
    const order = await env.DB.prepare(`SELECT * FROM food_orders WHERE ref = ?`).bind(String(params.ref || '')).first();
    if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 });
    if (order.order_status !== move[0]) {
      const who = order.kitchen_ack_by ? ` (accepted by ${order.kitchen_ack_by})` : '';
      return Response.json({ error: `This order has already moved on${who}. The board will refresh.`, status: order.order_status }, { status: 409 });
    }
    const err = await moveOrder(env.DB, order, move[1], admin.name);
    if (err) return Response.json({ error: err }, { status: 409 });
    await logAdminAction(env.DB, admin, 'kitchen_order', `${order.ref}: ${move[0]} → ${move[1]}`);
    if (params.action === 'accept') {
      const job = clearTelegramButtons(env, env.DB, order.id, `✅ ${escHtml(order.ref)} accepted by ${escHtml(admin.name)} on the Kitchen Screen`);
      if (waitUntil) waitUntil(job); else await job;
    }
    return Response.json({ ok: true, status: move[1] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[kitchen] move', err);
    return Response.json({ error: 'Could not update the order. Please try again.' }, { status: 500 });
  }
}
