import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureFoodSchema, expireStale } from '../_lib/foodOrders.js';
import { ensureMenuSchema, photoUrl } from '../_lib/foodMenuDb.js';
import { buildXlsx } from '../_lib/xlsx.js';

// GET /api/admin/food-analytics?range=7d|30d|season|all|custom&from=&to=&event=<match id>
//   [&format=report|customers]  (Excel; needs "can export fan data")
// Only PAID orders count (paid, preparing, out for delivery, delivered):
// never unpaid, expired, failed, cancelled or refunded ones.
const COUNTED = ['PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const json = s => { try { return JSON.parse(s); } catch { return []; } };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const wat = iso => (iso ? new Date(new Date(iso).getTime() + 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
const DAY = 86400e3;

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureFoodSchema(db);
  await ensureMenuSchema(db);
  await expireStale(db);
  const p = new URL(request.url).searchParams;

  // Date range (Nigerian time).
  const watMidnight = ymd => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - 3600e3;
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const tomorrow = watMidnight(today) + DAY;
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', request.url))).json(); } catch {}
  const range = ['7d', '30d', 'season', 'all', 'custom'].includes(p.get('range')) ? p.get('range') : 'all';
  let start = 0, end = tomorrow;
  if (range === '7d') start = tomorrow - 7 * DAY;
  else if (range === '30d') start = tomorrow - 30 * DAY;
  else if (range === 'season' && /^\d{4}-\d{2}-\d{2}$/.test(site.seasonStart || '')) start = watMidnight(site.seasonStart);
  else if (range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') && /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '')) { start = watMidnight(p.get('from')); end = watMidnight(p.get('to')) + DAY; }
  const eventId = p.get('event') || '';
  const where = [`created_iso >= ?`, `created_iso < ?`], binds = [new Date(start).toISOString(), new Date(end).toISOString()];
  if (eventId) { where.push(`event_id = ?`); binds.push(eventId); }
  const { results: all } = await db.prepare(`SELECT * FROM food_orders WHERE ${where.join(' AND ')} ORDER BY created_iso`).bind(...binds).all();
  const paid = all.filter(o => o.payment_status === 'paid' && COUNTED.includes(o.order_status));

  // Menu details (photo, category) for each item id.
  const { results: menu } = await db.prepare(`SELECT i.id, i.photo_id, i.emoji, c.name AS category FROM food_items i LEFT JOIN food_categories c ON c.id = i.category_id`).all();
  const info = new Map(menu.map(m => [m.id, m]));

  // Items: quantity and revenue (from each order's own copy of the price).
  const items = new Map();
  for (const o of paid) for (const i of json(o.items_json)) {
    const r = items.get(i.id) || { id: i.id, name: i.name, qty: 0, revenueKobo: 0 };
    r.qty += i.qty; r.revenueKobo += i.qty * i.priceKobo; r.name = i.name;
    items.set(i.id, r);
  }
  const totalQty = [...items.values()].reduce((s, r) => s + r.qty, 0);
  const totalRev = paid.reduce((s, o) => s + o.total_kobo, 0);
  const itemRows = [...items.values()].sort((a, b) => b.qty - a.qty || b.revenueKobo - a.revenueKobo).map(r => ({
    ...r, photo: photoUrl(info.get(r.id)?.photo_id), emoji: info.get(r.id)?.emoji || '', category: info.get(r.id)?.category || 'Other',
    qtyPct: pct(r.qty, totalQty), revenuePct: pct(r.revenueKobo, totalRev),
  }));
  // Make the item percentages add up to exactly 100 (largest-remainder rounding).
  if (itemRows.length && totalQty) {
    const raw = itemRows.map(r => (r.qty / totalQty) * 1000);
    const floors = raw.map(Math.floor);
    let left = 1000 - floors.reduce((s, x) => s + x, 0);
    raw.map((x, i) => [x - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floors[i]++; left--; } });
    itemRows.forEach((r, i) => { r.qtyPct = floors[i] / 10; });
  }
  const cats = new Map();
  for (const r of itemRows) { const c = cats.get(r.category) || { name: r.category, qty: 0, revenueKobo: 0 }; c.qty += r.qty; c.revenueKobo += r.revenueKobo; cats.set(r.category, c); }
  const categories = [...cats.values()].sort((a, b) => b.qty - a.qty).map(c => ({ ...c, qtyPct: pct(c.qty, totalQty) }));

  // Customers (by phone, else email).
  const custKey = o => o.phone || o.email;
  const customers = new Map();
  for (const o of paid) {
    const c = customers.get(custKey(o)) || { name: o.customer_name || '', phone: o.phone, email: o.email, orders: 0, spentKobo: 0, last: o.created_iso, stands: new Set() };
    c.orders++; c.spentKobo += o.total_kobo; c.last = o.created_iso; if (o.customer_name) c.name = o.customer_name; if (o.stand) c.stands.add(o.stand);
    customers.set(custKey(o), c);
  }
  const repeat = [...customers.values()].filter(c => c.orders > 1).length;
  const delivered = paid.filter(o => o.delivered_at && o.paid_iso);
  const avgDelivery = delivered.length ? Math.round(delivered.reduce((s, o) => s + (Date.parse(o.delivered_at) - Date.parse(o.paid_iso)), 0) / delivered.length / 60000) : null;

  // Orders by time: 15-minute steps relative to kick-off for one match, else clock time of day.
  let timeline = [], timelineMode = 'clock';
  const ev = eventId ? await db.prepare(`SELECT id, home_team, away_team, event_date FROM events WHERE id = ?`).bind(eventId).first() : null;
  if (ev) {
    timelineMode = 'kickoff';
    const ko = Date.parse(ev.event_date);
    const b = new Map();
    for (const o of paid) { const m = Math.floor((Date.parse(o.paid_iso || o.created_iso) - ko) / 900000) * 15; b.set(m, (b.get(m) || 0) + 1); }
    const keys = [...b.keys()];
    const lo = Math.min(-90, ...keys), hi = Math.max(120, ...keys);
    for (let m = lo; m <= hi; m += 15) timeline.push({ label: m === 0 ? 'KO' : m > 0 ? `+${m}'` : `${m}'`, orders: b.get(m) || 0 });
  } else {
    const b = new Array(96).fill(0);
    for (const o of paid) { const d = new Date(Date.parse(o.paid_iso || o.created_iso) + 3600e3); b[d.getUTCHours() * 4 + Math.floor(d.getUTCMinutes() / 15)]++; }
    const first = b.findIndex(x => x), last = 95 - [...b].reverse().findIndex(x => x);
    if (first >= 0) for (let i = Math.max(0, first - 2); i <= Math.min(95, last + 2); i++) timeline.push({ label: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`, orders: b[i] });
  }
  const stands = new Map();
  for (const o of paid) { const k = o.stand || 'Not given'; const s = stands.get(k) || { stand: k, orders: 0, revenueKobo: 0 }; s.orders++; s.revenueKobo += o.total_kobo; stands.set(k, s); }

  // Excel exports (personal data: export permission needed).
  const format = p.get('format');
  if (format === 'report' || format === 'customers') {
    if (!admin.canExport) return Response.json({ error: 'You do not have permission to export customer data.' }, { status: 403 });
    const custRows = [...customers.values()].sort((a, b) => b.spentKobo - a.spentKobo).map(c => [c.name, c.phone, c.email, c.orders, c.spentKobo / 100, [...c.stands].join(', '), wat(c.last)]);
    const custSheet = { name: 'Customers', columns: ['Name', 'Phone', 'Email', 'Paid orders', 'Spent (₦)', 'Stands', 'Last order'], rows: custRows };
    const sheets = format === 'customers' ? [custSheet] : [
      { name: 'Orders', columns: ['Reference', 'Status', 'Paid', 'Delivered', 'Name', 'Phone', 'Email', 'Seat', 'Stand', 'Items', 'Total (₦)'],
        rows: paid.map(o => [o.ref, o.order_status, wat(o.paid_iso), wat(o.delivered_at), o.customer_name || '', o.phone, o.email, o.seat, o.stand || '', json(o.items_json).map(i => `${i.qty}× ${i.name}`).join(', '), o.total_kobo / 100]) },
      { name: 'Items', columns: ['Item', 'Category', 'Quantity sold', '% of items sold', 'Revenue (₦)', '% of food revenue'],
        rows: itemRows.map(r => [r.name, r.category, r.qty, `${r.qtyPct}%`, r.revenueKobo / 100, `${r.revenuePct}%`]).concat([[], ['Total', '', totalQty, '100%', totalRev / 100, '100%']]) },
      custSheet,
    ];
    await logAdminAction(db, admin, format === 'customers' ? 'export_food_customers' : 'export_food_report', `${paid.length} paid orders, ${customers.size} customers`);
    const name = format === 'customers' ? 'food-customers' : 'food-report';
    return new Response(buildXlsx(sheets), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="lobi-stars-${name}-${today}.xlsx"`, 'Cache-Control': 'no-store' } });
  }

  const { results: matches } = await db.prepare(`SELECT DISTINCT f.event_id AS id, e.home_team, e.away_team, e.event_date FROM food_orders f JOIN events e ON e.id = f.event_id ORDER BY e.event_date DESC LIMIT 50`).all();
  return Response.json({
    range, from: new Date(start).toISOString(), to: new Date(end).toISOString(), match: ev ? `${ev.home_team} vs ${ev.away_team}` : null, canExport: admin.canExport,
    kpis: {
      paidOrders: paid.length, revenueKobo: totalRev, avgOrderKobo: paid.length ? Math.round(totalRev / paid.length) : 0,
      customers: customers.size, repeatPct: pct(repeat, customers.size), conversionPct: pct(paid.length, all.length), ordersCreated: all.length,
      unpaidOrExpired: all.filter(o => ['AWAITING_PAYMENT', 'EXPIRED', 'PAYMENT_FAILED'].includes(o.order_status)).length,
      avgDeliveryMinutes: avgDelivery, itemsSold: totalQty,
    },
    items: itemRows, favourite: itemRows[0] || null, categories, timeline, timelineMode,
    stands: [...stands.values()].sort((a, b) => b.orders - a.orders),
    matches: matches.map(m => ({ id: m.id, label: `${m.home_team} vs ${m.away_team} (${new Date(m.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })})` })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
