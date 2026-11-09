// GET /api/food/board[?point=<pickup point>] -- the collection board (a TV near the kiosk): today's
// pickup orders as short numbers only (no names, phones or items), "Preparing" or "Ready to collect".
// An order leaves the board once collected (Delivered) or after 3 hours.
import { ensureFoodSchema, DEFAULT_VENUE } from '../_lib/foodOrders.js';

const PREPARING = ['PAID', 'ACCEPTED', 'PREPARING'];
export const shortNo = ref => `#${String(ref || '').split('-').pop()}`;

export async function onRequestGet({ request, env }) {
  await ensureFoodSchema(env.DB);
  const url = new URL(request.url);
  const point = (url.searchParams.get('point') || '').slice(0, 60);
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT ref, order_status, pickup_point, ready_at, created_iso FROM food_orders
     WHERE fulfilment = 'pickup' AND order_status IN ('PAID', 'ACCEPTED', 'PREPARING', 'READY') AND COALESCE(paid_iso, created_iso) >= ?
       AND COALESCE(venue_id, ?) = ? ORDER BY created_iso`
  ).bind(since, DEFAULT_VENUE, url.searchParams.get('venue') || DEFAULT_VENUE).all().catch(() => ({ results: [] }));
  const rows = results.filter(o => !point || (o.pickup_point || '') === point);
  return Response.json({
    preparing: rows.filter(o => PREPARING.includes(o.order_status)).map(o => ({ no: shortNo(o.ref), point: o.pickup_point || '' })),
    ready: rows.filter(o => o.order_status === 'READY').sort((a, b) => String(b.ready_at || '').localeCompare(String(a.ready_at || ''))).map(o => ({ no: shortNo(o.ref), point: o.pickup_point || '' })),
    serverTime: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
