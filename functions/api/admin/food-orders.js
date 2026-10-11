import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureFoodAdminSchema, FOOD_STATUSES } from '../_lib/foodOrders.js';

const noStore = { 'Cache-Control': 'no-store' };
const json = s => { try { return JSON.parse(s); } catch { return []; } };

// GET /api/admin/food-orders?show=open|today|all -- paid in-seat food orders,
// with today's totals (Nigerian time). "open" = new or being prepared.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureFoodAdminSchema(env.DB);
  const show = new URL(request.url).searchParams.get('show') || 'open';
  // paid_at is stored as "YYYY-MM-DD HH:MM:SS" (UTC). Today = since WAT midnight.
  const watNow = new Date(Date.now() + 3600e3);
  const todayStart = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate()) - 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const where = show === 'all' ? '' : show === 'today' ? `AND paid_at >= '${todayStart}'` : `AND status IN ('new', 'preparing')`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM food_orders WHERE payment_status = 'paid' ${where} ORDER BY ${show === 'open' ? 'paid_at ASC' : 'paid_at DESC'} LIMIT 500`
  ).all();
  const { results: today } = await env.DB.prepare(`SELECT items_json, total_kobo, status FROM food_orders WHERE payment_status = 'paid' AND paid_at >= ?`).bind(todayStart).all();
  const items = {};
  for (const o of today) for (const i of json(o.items_json)) items[i.name] = (items[i.name] || 0) + (i.qty || 0);
  return Response.json({
    orders: results.map(o => ({
      id: o.id, seat: o.seat, stand: o.stand || '', phone: o.phone, items: json(o.items_json), totalKobo: o.total_kobo,
      paidAt: o.paid_at, status: o.status || 'new', statusBy: o.status_by, statusAt: o.status_at,
    })),
    today: {
      orders: today.length, revenueKobo: today.reduce((s, o) => s + o.total_kobo, 0),
      open: today.filter(o => o.status === 'new' || o.status === 'preparing').length,
      topItems: Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    },
  }, { headers: noStore });
}

// POST /api/admin/food-orders { id, status } -- new / preparing / delivered / cancelled.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  if (!FOOD_STATUSES.includes(b.status)) return Response.json({ error: 'Unknown status' }, { status: 400 });
  await ensureFoodAdminSchema(env.DB);
  const res = await env.DB.prepare(`UPDATE food_orders SET status = ?, status_by = ?, status_at = ? WHERE id = ? AND payment_status = 'paid'`)
    .bind(b.status, admin.name, new Date().toISOString(), String(b.id || '')).run();
  if (!res.meta?.changes) return Response.json({ error: 'Order not found' }, { status: 404 });
  await logAdminAction(env.DB, admin, 'food_order_status', `${b.id} → ${b.status}`);
  return Response.json({ ok: true }, { headers: noStore });
}
