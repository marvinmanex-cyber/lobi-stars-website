import { ensureFoodSchema } from '../_lib/foodOrders.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// POST /api/food/notify { ref, t, subscription } -- "Tell me when it's on the way":
// keeps the browser's push subscription on this one order (the order's private link
// token proves it is theirs). Used for "cooking now" and "on the way / ready to collect".
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
export async function onRequestPost({ request, env }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureFoodSchema(db);
  if (!(await rateLimit(db, `foodnotify:${clientIp(request)}`, 30, 3600))) return tooMany();
  const b = await request.json().catch(() => ({}));
  const ref = String(b.ref || '').trim(), t = String(b.t || '').trim(), sub = b.subscription || {};
  const o = ref && t ? await db.prepare(`SELECT id, view_token FROM food_orders WHERE ref = ?`).bind(ref).first() : null;
  if (!o || !o.view_token || o.view_token !== t) return json({ error: 'Order not found.' }, 404);
  if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'Your browser could not turn on alerts.' }, 400);
  await db.prepare(`UPDATE food_orders SET push_sub = ? WHERE id = ?`)
    .bind(JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } }), o.id).run();
  return json({ ok: true });
}
