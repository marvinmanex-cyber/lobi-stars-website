import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureKitchenSchema, testKitchen } from '../../../_lib/kitchenNotify.js';

// Kitchen Screen push notifications:
// GET  /api/admin/kitchen/push/public-key   the VAPID public key for subscribing
// POST /api/admin/kitchen/push/subscribe    { subscription, deviceName } -> this device gets kitchen alerts
// POST /api/admin/kitchen/push/unsubscribe  { endpoint } -> stop
// POST /api/admin/kitchen/push/test         a test push to every kitchen device + Telegram
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (params.action !== 'public-key') return Response.json({ error: 'Not found' }, { status: 404 });
  if (!env.VAPID_PUBLIC_KEY) return Response.json({ error: 'Push notifications are not set up on the server yet (VAPID keys).' }, { status: 503 });
  return Response.json({ key: env.VAPID_PUBLIC_KEY });
}

export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureKitchenSchema(db);
  const b = await request.json().catch(() => ({}));
  if (params.action === 'subscribe') {
    const sub = b.subscription || {};
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return Response.json({ error: 'Invalid subscription' }, { status: 400 });
    const device = String(b.deviceName || '').trim().slice(0, 60) || 'Kitchen device';
    // Kitchen devices get the kitchen alerts only (want_paid / want_unpaid off: those are the admin alerts).
    await db.prepare(`INSERT INTO push_subs (endpoint, staff_id, staff_name, keys_json, want_unpaid, want_paid, device, created_at, kitchen, is_active) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1, 1)
      ON CONFLICT (endpoint) DO UPDATE SET staff_id = excluded.staff_id, staff_name = excluded.staff_name, keys_json = excluded.keys_json, device = excluded.device, kitchen = 1, is_active = 1`)
      .bind(sub.endpoint, admin.id, admin.name, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }), device, new Date().toISOString()).run();
    await logAdminAction(db, admin, 'kitchen_device', `added ${device}`);
    return Response.json({ ok: true });
  }
  if (params.action === 'unsubscribe') {
    await db.prepare(`UPDATE push_subs SET is_active = 0 WHERE endpoint = ? AND kitchen = 1`).bind(String(b.endpoint || '')).run();
    return Response.json({ ok: true });
  }
  if (params.action === 'test') {
    const r = await testKitchen(env);
    await logAdminAction(db, admin, 'kitchen_test', `push ${r.push?.ok ? 'ok' : 'failed'}, telegram ${r.telegram ? (r.telegram.ok ? 'ok' : 'failed') : 'off'}`);
    return Response.json({ ok: true, result: r });
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
}
