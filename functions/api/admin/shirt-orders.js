import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureShirtSchema, PERSONALISATION } from '../_lib/shirtOrders.js';

const noStore = { 'Cache-Control': 'no-store' };
const STATUSES = ['new', 'ready', 'collected', 'cancelled'];

// GET /api/admin/shirt-orders -- paid personalised-shirt orders, newest first.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureShirtSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT * FROM shirt_orders WHERE payment_status = 'paid' ORDER BY paid_at DESC LIMIT 500`).all();
  return Response.json({
    enabled: PERSONALISATION.enabled, howYouGetIt: PERSONALISATION.howYouGetIt,
    orders: results.map(o => ({
      id: o.id, product: o.product_name, size: o.size, name: o.print_name, number: o.print_number, totalKobo: o.total_kobo,
      buyer: o.buyer_name, email: o.buyer_email, phone: o.buyer_phone, paidAt: o.paid_at, emailed: !!o.emailed,
      status: o.status, statusBy: o.status_by, statusAt: o.status_at,
    })),
  }, { headers: noStore });
}

// POST /api/admin/shirt-orders { id, status } -- new / ready / collected / cancelled.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  if (!STATUSES.includes(b.status)) return Response.json({ error: 'Unknown status' }, { status: 400 });
  await ensureShirtSchema(env.DB);
  const res = await env.DB.prepare(`UPDATE shirt_orders SET status = ?, status_by = ?, status_at = ? WHERE id = ? AND payment_status = 'paid'`)
    .bind(b.status, admin.name, new Date().toISOString(), String(b.id || '')).run();
  if (!res.meta?.changes) return Response.json({ error: 'Order not found' }, { status: 404 });
  await logAdminAction(env.DB, admin, 'shirt_order_status', `${b.id} → ${b.status}`);
  return Response.json({ ok: true }, { headers: noStore });
}
