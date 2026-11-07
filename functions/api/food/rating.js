import { ensureFoodSchema } from '../_lib/foodOrders.js';
import { rateLimit, tooMany, clientIp, ensureFanSchema } from '../_lib/fans.js';

const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const score = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };

// POST /api/food/rating { ref, t, food, speed, service, comment } -- the fan's rating of a delivered
// order, from 1 to 5. Their order address (with its private token) is the only way in, and each
// order can be rated once.
export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const ref = String(b.ref || '').slice(0, 60), t = String(b.t || '').slice(0, 80);
  await ensureFanSchema(env.DB);
  if (!(await rateLimit(env.DB, `food-rate:${clientIp(request)}`, 20, 600))) return tooMany();
  await ensureFoodSchema(env.DB);
  const o = await env.DB.prepare(`SELECT id, order_status, view_token FROM food_orders WHERE ref = ?`).bind(ref).first();
  if (!o || !o.view_token || o.view_token !== t) return json({ error: 'Order not found.' }, 404);
  if (o.order_status !== 'DELIVERED') return json({ error: 'You can rate your order once it has been delivered.' }, 409);
  const food = score(b.food), speed = score(b.speed), service = score(b.service);
  if (!food || !speed || !service) return json({ error: 'Please score the food, the speed and the service, from 1 to 5.' }, 400);
  const comment = String(b.comment || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO food_ratings (order_id, food, speed, service, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(o.id, food, speed, service, comment, new Date().toISOString()).run();
  if (!r.meta?.changes) return json({ error: 'You have already rated this order. Thank you.' }, 409);
  return json({ ok: true });
}
