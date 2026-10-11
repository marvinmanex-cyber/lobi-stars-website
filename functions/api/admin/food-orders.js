import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureFoodSchema, expireStale, moveOrder, STATUS, foodSettings, saveFoodSetting } from '../_lib/foodOrders.js';

const noStore = { 'Cache-Control': 'no-store' };
const json = s => { try { return JSON.parse(s); } catch { return []; } };
const ACTIVE = ['PAID', 'PREPARING', 'OUT_FOR_DELIVERY'];

// GET /api/admin/food-orders?show=open|awaiting|today|all
//   open     = paid orders still to prepare or deliver (oldest first)
//   awaiting = orders waiting for payment (not to be prepared)
// Also returns today's totals (paid orders only) and the settings.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureFoodSchema(db);
  await expireStale(db);
  const show = new URL(request.url).searchParams.get('show') || 'open';
  const watNow = new Date(Date.now() + 3600e3);
  const todayStart = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate()) - 3600e3).toISOString();
  let sql = `SELECT * FROM food_orders`, binds = [];
  if (show === 'open') { sql += ` WHERE order_status IN ('PAID','PREPARING','OUT_FOR_DELIVERY') ORDER BY paid_iso ASC`; }
  else if (show === 'awaiting') { sql += ` WHERE order_status = 'AWAITING_PAYMENT' ORDER BY created_iso DESC`; }
  else if (show === 'today') { sql += ` WHERE created_iso >= ? ORDER BY created_iso DESC`; binds = [todayStart]; }
  else { sql += ` ORDER BY created_iso DESC`; }
  const { results } = await db.prepare(`${sql} LIMIT 500`).bind(...binds).all();

  const { results: today } = await db.prepare(`SELECT items_json, total_kobo, order_status, payment_status FROM food_orders WHERE created_iso >= ?`).bind(todayStart).all();
  const paidToday = today.filter(o => o.payment_status === 'paid' && !['CANCELLED', 'REFUNDED'].includes(o.order_status));
  const items = {};
  for (const o of paidToday) for (const i of json(o.items_json)) items[i.name] = (items[i.name] || 0) + (i.qty || 0);
  const awaiting = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status = 'AWAITING_PAYMENT'`).first()).n || 0;

  return Response.json({
    statuses: STATUS,
    settings: await foodSettings(db),
    orders: results.map(o => ({
      id: o.id, ref: o.ref, name: o.customer_name || '', seat: o.seat, stand: o.stand || '', phone: o.phone, email: o.email,
      notes: o.notes || '', items: json(o.items_json), totalKobo: o.total_kobo, status: o.order_status,
      createdAt: o.created_iso, expiresAt: o.expires_at, paidAt: o.paid_iso, paidLate: !!o.paid_late, paystackRef: o.paid_reference || o.paystack_reference,
      preparingAt: o.preparing_at, outAt: o.out_at, deliveredAt: o.delivered_at, statusBy: o.status_by, statusAt: o.status_at,
    })),
    today: {
      orders: paidToday.length, revenueKobo: paidToday.reduce((s, o) => s + o.total_kobo, 0),
      open: today.filter(o => ACTIVE.includes(o.order_status)).length, awaiting,
      topItems: Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    },
  }, { headers: noStore });
}

// POST /api/admin/food-orders { id, status }        -- move an order (Start preparing, Out for delivery, Delivered, Cancel, Refunded)
// POST /api/admin/food-orders { settings: { paymentExpiryMinutes } }
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  await ensureFoodSchema(env.DB);
  if (b.settings) {
    const m = Math.round(Number(b.settings.paymentExpiryMinutes));
    if (!(m >= 1 && m <= 120)) return Response.json({ error: 'The payment time limit must be between 1 and 120 minutes.' }, { status: 400 });
    await saveFoodSetting(env.DB, 'paymentExpiryMinutes', m, admin.name);
    await logAdminAction(env.DB, admin, 'food_settings', `payment time limit ${m} min`);
    return Response.json({ ok: true, settings: await foodSettings(env.DB) }, { headers: noStore });
  }
  if (!STATUS[b.status]) return Response.json({ error: 'Unknown status' }, { status: 400 });
  const order = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(String(b.id || '')).first();
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  const err = await moveOrder(env.DB, order, b.status, admin.name);
  if (err) return Response.json({ error: err }, { status: 409 });
  await logAdminAction(env.DB, admin, 'food_order_status', `${order.ref}: ${order.order_status} → ${b.status}`);
  return Response.json({ ok: true }, { headers: noStore });
}
