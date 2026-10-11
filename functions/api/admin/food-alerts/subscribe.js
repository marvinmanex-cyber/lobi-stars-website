import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureAlertsSchema } from '../../_lib/foodAlerts.js';

// POST   /api/admin/food-alerts/subscribe { subscription, wantUnpaid, wantPaid, device } -- this phone/computer gets push alerts
// DELETE /api/admin/food-alerts/subscribe { endpoint } -- stop them
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const sub = b.subscription || {};
  if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return Response.json({ error: 'Invalid subscription' }, { status: 400 });
  await ensureAlertsSchema(env.DB);
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, staff_id, staff_name, keys_json, want_unpaid, want_paid, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET staff_id = excluded.staff_id, staff_name = excluded.staff_name, want_unpaid = excluded.want_unpaid, want_paid = excluded.want_paid, device = excluded.device`)
    .bind(sub.endpoint, admin.id, admin.name, JSON.stringify(sub.keys || {}), b.wantUnpaid ? 1 : 0, b.wantPaid === false ? 0 : 1, String(b.device || '').slice(0, 80), new Date().toISOString()).run();
  return Response.json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  await ensureAlertsSchema(env.DB);
  await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(String(b.endpoint || '')).run();
  return Response.json({ ok: true });
}
