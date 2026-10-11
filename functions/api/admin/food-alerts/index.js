import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureFoodSchema } from '../../_lib/foodOrders.js';
import { ensureAlertsSchema, alertSettings, pushReady } from '../../_lib/foodAlerts.js';

// GET /api/admin/food-alerts?after=<id>   -- alerts newer than <id> (the admin bell, pop-ups and sounds)
// GET /api/admin/food-alerts?latest=1     -- the newest alert (used by the phone notification)
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureFoodSchema(env.DB);
  await ensureAlertsSchema(env.DB);
  const url = new URL(request.url);
  if (url.searchParams.get('latest')) {
    const a = await env.DB.prepare(`SELECT * FROM food_alerts ORDER BY id DESC LIMIT 1`).first();
    return Response.json({ alert: a || null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const after = Number(url.searchParams.get('after')) || 0;
  const { results } = await env.DB.prepare(`SELECT id, kind, ref, title, body, created_at FROM food_alerts WHERE id > ? ORDER BY id DESC LIMIT 30`).bind(after).all();
  const last = (await env.DB.prepare(`SELECT MAX(id) AS m FROM food_alerts`).first()).m || 0;
  const devices = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subs`).first()).n || 0;
  return Response.json({
    alerts: results, lastId: last,
    push: { ready: pushReady(env), publicKey: env.VAPID_PUBLIC_KEY || null, devices },
    settings: await alertSettings(env.DB), emailReady: !!env.RESEND_API_KEY, smsReady: !!env.TERMII_API_KEY,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
