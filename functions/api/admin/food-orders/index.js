import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureFoodSchema, expireStale, moveOrder, STATUS, foodSettings, saveFoodSetting, staffMessage, whereText } from '../../_lib/foodOrders.js';
import { buildXlsx } from '../../_lib/xlsx.js';
import { kitchenStatus } from '../../_lib/kitchenNotify.js';

const noStore = { 'Cache-Control': 'no-store' };
const json = s => { try { return JSON.parse(s); } catch { return []; } };
const ACTIVE = ['PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY'];
const wat = iso => (iso ? new Date(new Date(iso).getTime() + 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');

// For WhatsApp replies: the customer's number for wa.me and ready-made messages per step.
const waReplies = (o, settings) => settings ? {
  phone: String(o.phone || '').replace(/\D/g, ''),
  messages: { CONFIRMED: staffMessage(settings, o, 'CONFIRMED'), PAID: staffMessage(settings, o, 'PAID'), READY: staffMessage(settings, o, 'READY'), CANCELLED: staffMessage(settings, o, 'CANCELLED') },
} : null;
const view = (o, settings) => ({
  id: o.id, ref: o.ref, name: o.customer_name || '', seat: o.seat, stand: o.stand || '', phone: o.phone, email: o.email,
  notes: o.notes || '', items: json(o.items_json), totalKobo: o.total_kobo, status: o.order_status, payment: o.payment_status,
  eventId: o.event_id, match: o.home_team ? `${o.home_team} vs ${o.away_team}` : '',
  createdAt: o.created_iso, expiresAt: o.expires_at, paidAt: o.paid_iso, paidLate: !!o.paid_late, paystackRef: o.paid_reference || o.paystack_reference,
  preparingAt: o.preparing_at, outAt: o.out_at, deliveredAt: o.delivered_at, cancelledAt: o.cancelled_at, statusBy: o.status_by, statusAt: o.status_at,
  channel: o.channel || 'paystack', fulfilment: o.fulfilment || 'seat', pickupPoint: o.pickup_point || '', where: whereText(o), confirmedAt: o.confirmed_at,
  wa: waReplies(o, settings),
  kitchen: kitchenStatus(o),
});

// GET /api/admin/food-orders
//   ?show=open      paid orders still to prepare or deliver (oldest first)
//   ?show=awaiting  orders waiting for payment (not to be prepared)
//   ?show=board     everything the live board needs
//   ?show=list&q=&status=&event=&from=&to=&stand=&pay=&page=   the searchable orders list
//   ?show=list&format=xlsx  the same list as an Excel file (needs "can export fan data")
//   ?show=today | all
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureFoodSchema(db);
  await expireStale(db);
  const p = new URL(request.url).searchParams;
  const show = p.get('show') || 'open';
  const base = `SELECT f.*, e.home_team, e.away_team FROM food_orders f LEFT JOIN events e ON e.id = f.event_id`;
  const settings = await foodSettings(db);
  const watNow = new Date(Date.now() + 3600e3);
  const todayStart = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate()) - 3600e3).toISOString();

  if (show === 'list') {
    const where = [], binds = [];
    const q = (p.get('q') || '').trim().toLowerCase();
    if (q) { where.push(`(lower(f.ref) LIKE ? OR lower(COALESCE(f.customer_name,'')) LIKE ? OR lower(f.email) LIKE ? OR f.phone LIKE ? OR lower(f.seat) LIKE ?)`); const l = `%${q.replace(/[%_]/g, '')}%`; binds.push(l, l, l, `%${q.replace(/\D/g, '').slice(-9) || '~'}%`, l); }
    if (STATUS[p.get('status')]) { where.push(`f.order_status = ?`); binds.push(p.get('status')); }
    if (p.get('pay') === 'paid') where.push(`f.payment_status = 'paid'`);
    if (p.get('pay') === 'unpaid') where.push(`f.payment_status != 'paid'`);
    if (p.get('event')) { where.push(`f.event_id = ?`); binds.push(p.get('event')); }
    if (p.get('stand')) { where.push(`f.stand = ?`); binds.push(p.get('stand')); }
    if (p.get('channel') === 'whatsapp') where.push(`f.channel = 'whatsapp'`);
    if (p.get('channel') === 'paystack') where.push(`COALESCE(f.channel, 'paystack') = 'paystack'`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '')) { where.push(`f.created_iso >= ?`); binds.push(new Date(Date.parse(p.get('from') + 'T00:00:00Z') - 3600e3).toISOString()); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '')) { where.push(`f.created_iso < ?`); binds.push(new Date(Date.parse(p.get('to') + 'T00:00:00Z') + 86400e3 - 3600e3).toISOString()); }
    const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    if (p.get('format') === 'xlsx') {
      if (!admin.canExport) return Response.json({ error: 'You do not have permission to export customer data.' }, { status: 403 });
      const { results } = await db.prepare(`${base}${w} ORDER BY f.created_iso DESC LIMIT 20000`).bind(...binds).all();
      const rows = results.map(o => view(o, null));
      const file = buildXlsx([{
        name: 'Food orders',
        columns: ['Reference', 'Ordered by', 'Status', 'Payment', 'Created', 'Paid', 'Delivered', 'Name', 'Phone', 'Email', 'Seat / pickup', 'Stand', 'Match', 'Items', 'Total (₦)', 'Note', 'Payment reference', 'Last change by'],
        rows: rows.map(o => [o.ref, o.channel === 'whatsapp' ? 'WhatsApp' : 'Website (Paystack)', STATUS[o.status]?.label || o.status, o.payment, wat(o.createdAt), wat(o.paidAt), wat(o.deliveredAt), o.name, o.phone, o.email, o.fulfilment === 'pickup' ? `Pickup: ${o.pickupPoint}` : o.seat, o.stand, o.match,
          o.items.map(i => `${i.qty}× ${i.name}`).join(', '), o.totalKobo / 100, o.notes, o.paystackRef, o.statusBy || '']),
      }]);
      await logAdminAction(db, admin, 'export_food_orders', `${rows.length} orders`);
      return new Response(file, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="lobi-stars-food-orders-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store' } });
    }
    const page = Math.max(1, Number(p.get('page')) || 1), size = 50;
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders f${w}`).bind(...binds).first()).n;
    const { results } = await db.prepare(`${base}${w} ORDER BY f.created_iso DESC LIMIT ? OFFSET ?`).bind(...binds, size, (page - 1) * size).all();
    const { results: matches } = await db.prepare(`SELECT DISTINCT f.event_id AS id, e.home_team, e.away_team, e.event_date FROM food_orders f JOIN events e ON e.id = f.event_id ORDER BY e.event_date DESC LIMIT 50`).all();
    const { results: stands } = await db.prepare(`SELECT DISTINCT stand FROM food_orders WHERE stand IS NOT NULL AND stand != '' ORDER BY stand LIMIT 60`).all();
    return Response.json({
      statuses: STATUS, orders: results.map(o => view(o, settings)), total, page, pages: Math.max(1, Math.ceil(total / size)), canExport: admin.canExport,
      matches: matches.map(m => ({ id: m.id, label: `${m.home_team} vs ${m.away_team} (${new Date(m.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })})` })),
      stands: stands.map(s => s.stand),
    }, { headers: noStore });
  }

  let sql = base, binds = [];
  if (show === 'open') sql += ` WHERE f.order_status IN ('PAID','ACCEPTED','PREPARING','OUT_FOR_DELIVERY') ORDER BY f.paid_iso ASC`;
  else if (show === 'awaiting') sql += ` WHERE f.order_status = 'AWAITING_PAYMENT' ORDER BY f.created_iso DESC`;
  else if (show === 'board') { sql += ` WHERE f.order_status IN ('AWAITING_PAYMENT','AWAITING_WHATSAPP','CONFIRMED','PAID','ACCEPTED','PREPARING','OUT_FOR_DELIVERY') OR (f.order_status = 'DELIVERED' AND f.delivered_at >= ?) ORDER BY f.paid_iso ASC, f.created_iso ASC`; binds = [new Date(Date.now() - 30 * 60_000).toISOString()]; }
  else if (show === 'today') { sql += ` WHERE f.created_iso >= ? ORDER BY f.created_iso DESC`; binds = [todayStart]; }
  else sql += ` ORDER BY f.created_iso DESC`;
  const { results } = await db.prepare(`${sql} LIMIT 500`).bind(...binds).all();

  const { results: today } = await db.prepare(`SELECT items_json, total_kobo, order_status, payment_status FROM food_orders WHERE created_iso >= ?`).bind(todayStart).all();
  const paidToday = today.filter(o => o.payment_status === 'paid' && !['CANCELLED', 'REFUNDED'].includes(o.order_status));
  const items = {};
  for (const o of paidToday) for (const i of json(o.items_json)) items[i.name] = (items[i.name] || 0) + (i.qty || 0);
  const awaiting = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status = 'AWAITING_PAYMENT'`).first()).n || 0;
  const whatsapp = (await db.prepare(`SELECT COUNT(*) AS n FROM food_orders WHERE order_status IN ('AWAITING_WHATSAPP', 'CONFIRMED')`).first()).n || 0;

  return Response.json({
    statuses: STATUS,
    settings,
    orders: results.map(o => view(o, settings)),
    serverTime: new Date().toISOString(),
    today: {
      orders: paidToday.length, revenueKobo: paidToday.reduce((s, o) => s + o.total_kobo, 0),
      open: today.filter(o => ACTIVE.includes(o.order_status)).length, awaiting, whatsapp,
      topItems: Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    },
  }, { headers: noStore });
}

// POST /api/admin/food-orders { id, status }  -- move an order (Start preparing, Out for delivery, Delivered, Cancel, Refunded)
// POST /api/admin/food-orders { settings: { paymentExpiryMinutes } }
export async function onRequestPost({ request, env, waitUntil }) {
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
  if (b.action === 'resend_kitchen') {
    const o = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(String(b.id || '')).first();
    if (!o) return Response.json({ error: 'Order not found' }, { status: 404 });
    if (o.order_status !== 'PAID') return Response.json({ error: 'Only paid orders the kitchen has not accepted can be re-sent.' }, { status: 409 });
    const { notifyKitchen } = await import('../../_lib/kitchenNotify.js');
    const r = await notifyKitchen(env, o.id, o.kitchen_alerted_at ? 'repeat' : 'initial');
    await logAdminAction(env.DB, admin, 'kitchen_resend', o.ref);
    return Response.json({ ok: true, result: r }, { headers: noStore });
  }
  if (!STATUS[b.status]) return Response.json({ error: 'Unknown status' }, { status: 400 });
  const order = await env.DB.prepare(`SELECT * FROM food_orders WHERE id = ?`).bind(String(b.id || '')).first();
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  const err = await moveOrder(env.DB, order, b.status, admin.name);
  if (err) return Response.json({ error: err }, { status: 409 });
  await logAdminAction(env.DB, admin, 'food_order_status', `${order.ref}: ${order.order_status} → ${b.status}`);
  // Kitchen alerts (in the background, so staff get an instant reply).
  const later = (async () => {
    const k = await import('../../_lib/kitchenNotify.js');
    if (b.status === 'PAID' && order.order_status !== 'PAID') await k.kitchenOnPaid(env, order.id);
    if (b.status === 'CANCELLED' && order.kitchen_alerted_at && ['PAID', 'ACCEPTED', 'PREPARING'].includes(order.order_status)) await k.notifyKitchen(env, order.id, 'cancel');
    if (['ACCEPTED', 'PREPARING'].includes(b.status) && order.order_status === 'PAID') await k.clearTelegramButtons(env, env.DB, order.id, `✅ ${k.escHtml(order.ref)} accepted by ${k.escHtml(admin.name)}`);
  })().catch(err => console.error('[food] kitchen', err));
  if (waitUntil) waitUntil(later); else await later;
  return Response.json({ ok: true }, { headers: noStore });
}
