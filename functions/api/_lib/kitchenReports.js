// MatchDay Kitchen reports, for one day and one venue (or every venue, for a Super Admin):
// the match-day report, staff performance and customer ratings. Figures only: no customer
// phone numbers or emails. The sums are plain functions, so they can be tested on their own.
import { formatNaira, REJECT_REASONS, ensureFoodSchema } from './foodOrders.js';

const CANCELLED = ['CANCELLED', 'REFUNDED', 'REJECTED'];
const mins = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? (y - x) / 60000 : null; };
const avg = list => { const v = list.filter(n => n !== null); return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null; };
const items = o => { try { return JSON.parse(o.items_json || '[]'); } catch { return []; } };

/** The match-day figures for these orders. */
export function matchFigures(orders) {
  const paid = orders.filter(o => o.payment_status === 'paid' && !CANCELLED.includes(o.order_status));
  const revenue = paid.reduce((s, o) => s + (o.total_kobo || 0), 0);
  const sellers = new Map();
  for (const o of paid) for (const i of items(o)) { const x = sellers.get(i.name) || { name: i.name, qty: 0, kobo: 0 }; x.qty += Number(i.qty) || 0; x.kobo += (Number(i.qty) || 0) * (Number(i.priceKobo) || 0); sellers.set(i.name, x); }
  const stopped = orders.filter(o => ['REJECTED', 'CANCELLED', 'REFUNDED'].includes(o.order_status) || o.reject_reason);
  const reasons = new Map();
  for (const o of stopped) { const k = o.reject_reason ? `Rejected: ${REJECT_REASONS[o.reject_reason] || o.reject_reason}` : `Cancelled: ${o.cancel_reason || 'no reason given'}`; reasons.set(k, (reasons.get(k) || 0) + 1); }
  return {
    orders: paid.length, revenue: formatNaira(revenue), revenueKobo: revenue, average: formatNaira(paid.length ? Math.round(revenue / paid.length) : 0),
    stages: {
      confirm: avg(paid.map(o => mins(o.paid_iso, o.accepted_iso))),
      startCooking: avg(paid.map(o => mins(o.accepted_iso, o.preparing_at))),
      cook: avg(paid.map(o => mins(o.preparing_at, o.ready_at))),
      waitForRunner: avg(paid.map(o => mins(o.ready_at, o.out_at))),
      deliver: avg(paid.map(o => mins(o.out_at, o.delivered_at))),
      total: avg(paid.map(o => mins(o.paid_iso, o.delivered_at))),
    },
    stopped: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    bestSellers: [...sellers.values()].sort((a, b) => b.qty - a.qty).slice(0, 10).map(x => ({ name: x.name, qty: x.qty, sales: formatNaira(x.kobo) })),
  };
}

/** Per person, from the order history: orders handled, and average cooking and delivery time. */
export function staffFigures(events) {
  const people = new Map();
  const byOrder = new Map();
  for (const e of events) { if (!byOrder.has(e.order_id)) byOrder.set(e.order_id, []); byOrder.get(e.order_id).push(e); }
  const person = e => { if (!people.has(e.by_id)) people.set(e.by_id, { id: e.by_id, name: String(e.by_name || '').replace(/ – MatchDay Kitchen$/, ''), role: e.by_role || '', orders: new Set(), cook: [], deliver: [] }); return people.get(e.by_id); };
  for (const [orderId, list] of byOrder) {
    const at = st => list.find(e => e.to_status === st)?.at;
    for (const e of list) {
      if (!e.by_id || e.kind !== 'status' || e.by_role === 'system') continue;
      const p = person(e);
      p.orders.add(orderId);
      if (e.to_status === 'READY') p.cook.push(mins(at('PREPARING'), e.at));
      if (e.to_status === 'DELIVERED') p.deliver.push(mins(at('OUT_FOR_DELIVERY'), e.at));
    }
  }
  return [...people.values()].map(p => ({ name: p.name, role: p.role, orders: p.orders.size, avgCookMinutes: avg(p.cook), avgDeliverMinutes: avg(p.deliver) })).sort((a, b) => b.orders - a.orders);
}

/** Average scores, overall and by match. */
export function ratingFigures(rows) {
  const sum = list => ({ count: list.length, food: avg(list.map(r => r.food)), speed: avg(list.map(r => r.speed)), service: avg(list.map(r => r.service)) });
  const byMatch = new Map();
  for (const r of rows) { const k = r.match || 'No match'; if (!byMatch.has(k)) byMatch.set(k, []); byMatch.get(k).push(r); }
  return { ...sum(rows), byMatch: [...byMatch.entries()].map(([match, list]) => ({ match, ...sum(list) })), comments: rows.filter(r => r.comment).slice(0, 50).map(r => ({ ref: r.ref, comment: r.comment, food: r.food, speed: r.speed, service: r.service })) };
}

/** Everything for one day. scope: venue ids, or null for every venue. */
export async function kitchenReport(db, { start, end, scope = null }) {
  await ensureFoodSchema(db);
  const vs = scope ? ` AND COALESCE(venue_id, 'venue-main') IN (${scope.map(() => '?').join(',')})` : '';
  const b = [start, end, ...(scope || [])];
  const orders = (await db.prepare(`SELECT * FROM food_orders WHERE COALESCE(paid_iso, created_iso) >= ? AND COALESCE(paid_iso, created_iso) < ?${vs} LIMIT 5000`).bind(...b).all()).results;
  const ids = new Set(orders.map(o => o.id));
  const events = (await db.prepare(`SELECT order_id, kind, to_status, by_id, by_name, by_role, at FROM order_events WHERE at >= ? AND at < ? ORDER BY id LIMIT 20000`).bind(start, new Date(Date.parse(end) + 12 * 3600e3).toISOString()).all()).results.filter(e => ids.has(e.order_id));
  const rated = (await db.prepare(`SELECT r.food, r.speed, r.service, r.comment, o.ref, e.home_team || ' vs ' || e.away_team AS match, o.venue_id FROM food_ratings r JOIN food_orders o ON o.id = r.order_id LEFT JOIN events e ON e.id = o.event_id WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.created_at DESC LIMIT 5000`).bind(start, new Date(Date.parse(end) + 24 * 3600e3).toISOString()).all()).results.filter(r => !scope || scope.includes(r.venue_id || 'venue-main'));
  return { match: matchFigures(orders), staff: staffFigures(events), ratings: ratingFigures(rated) };
}

/** A report as rows for a CSV file. */
export function csvRows(kind, r) {
  if (kind === 'staff') return [['Name', 'Role', 'Orders handled', 'Average cooking (min)', 'Average delivery (min)'], ...r.staff.map(p => [p.name, p.role, p.orders, p.avgCookMinutes ?? '', p.avgDeliverMinutes ?? ''])];
  if (kind === 'ratings') return [['Match', 'Ratings', 'Food', 'Speed', 'Service'], ...r.ratings.byMatch.map(m => [m.match, m.count, m.food ?? '', m.speed ?? '', m.service ?? '']), [], ['Order', 'Food', 'Speed', 'Service', 'Comment'], ...r.ratings.comments.map(c => [c.ref, c.food, c.speed, c.service, c.comment])];
  const m = r.match;
  return [['Orders', m.orders], ['Sales', m.revenue], ['Average order', m.average], [],
    ['Average minutes per step'], ['Paid to confirmed', m.stages.confirm ?? ''], ['Confirmed to cooking', m.stages.startCooking ?? ''], ['Cooking', m.stages.cook ?? ''], ['Waiting for delivery', m.stages.waitForRunner ?? ''], ['Delivering', m.stages.deliver ?? ''], ['Paid to delivered', m.stages.total ?? ''], [],
    ['Rejected or cancelled', 'Orders'], ...m.stopped.map(s => [s.reason, s.count]), [],
    ['Best sellers', 'Quantity', 'Sales'], ...m.bestSellers.map(b => [b.name, b.qty, b.sales])];
}
