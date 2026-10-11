import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureFoodSchema, expireStale } from '../../_lib/foodOrders.js';
import { ensureAlertsSchema } from '../../_lib/foodAlerts.js';

// GET /api/admin/food-orders/stream -- live updates for the order board
// (Server-Sent Events). Sends "change" whenever an order is placed, paid or
// moved. Each connection lasts about a minute; the browser reconnects by itself.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureFoodSchema(env.DB);
  await ensureAlertsSchema(env.DB);
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const sig = async () => {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n, MAX(COALESCE(status_at, '')) AS a, MAX(COALESCE(paid_iso, '')) AS b, MAX(COALESCE(created_iso, '')) AS c FROM food_orders`
    ).first();
    const al = (await env.DB.prepare(`SELECT MAX(id) AS m FROM food_alerts`).first()).m || 0;
    return `${r.n}|${r.a}|${r.b}|${r.c}|${al}`;
  };
  (async () => {
    let last = '', tick = 0;
    const end = Date.now() + 55_000;
    try {
      await w.write(enc.encode('retry: 3000\n\n'));
      while (Date.now() < end) {
        if (tick++ % 10 === 0) await expireStale(env.DB);
        const s = await sig();
        await w.write(enc.encode(s !== last ? `event: change\ndata: ${s}\n\n` : ': ping\n\n'));
        last = s;
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch { /* the board was closed */ }
    try { await w.close(); } catch { /* already closed */ }
  })();
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
}
