import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureAlertsSchema, sendPushes, pushReady } from '../../_lib/foodAlerts.js';

// POST /api/admin/food-alerts/test -- a test alert for the bell and every phone with notifications on.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureAlertsSchema(env.DB);
  await env.DB.prepare(`INSERT INTO food_alerts (kind, order_id, ref, title, body, created_at) VALUES ('test', ?, 'TEST', ?, ?, ?)`)
    .bind(`test-${Date.now()}`, '🔔 Test alert', `Sent by ${admin.name}. If you can see and hear this, food alerts are working.`, new Date().toISOString()).run();
  const sent = pushReady(env) ? await sendPushes(env, 'paid') : 0;
  return Response.json({ ok: true, pushSent: sent, pushReady: pushReady(env) });
}
