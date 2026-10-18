import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { can } from '../../_lib/adminRoles.js';
import { pushReady } from '../../_lib/foodAlerts.js';
import { ensureKitchenSchema, kitchenSettings, saveKitchenSettings, telegramReady } from '../../_lib/kitchenNotify.js';

// Admin › Commerce › Kitchen Alerts.
// GET  /api/admin/kitchen/settings -- settings, kitchen devices, the last 50 alert log rows, what is set up
// POST /api/admin/kitchen/settings
//   { settings: { enabled, telegram, repeatMinutes, maxRepeats } }   (Commerce staff)
//   { removeDevice: endpoint }
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureKitchenSchema(db);
  const { results: devices } = await db.prepare(`SELECT endpoint, device, staff_name, created_at, last_ok_at, is_active FROM push_subs WHERE kitchen = 1 ORDER BY is_active DESC, created_at DESC`).all();
  const { results: log } = await db.prepare(`SELECT ref, channel, attempt, success, error, created_at FROM food_notification_log ORDER BY id DESC LIMIT 50`).all();
  return Response.json({
    settings: await kitchenSettings(db), devices, log,
    ready: { push: pushReady(env), telegram: telegramReady(env), webhook: !!env.TELEGRAM_WEBHOOK_SECRET, cron: !!env.CRON_SECRET },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!can(admin, 'commerce.kitchen.manage')) return Response.json({ error: 'Only staff who manage food orders can change kitchen alert settings.' }, { status: 403 });
  const db = env.DB;
  await ensureKitchenSchema(db);
  const b = await request.json().catch(() => ({}));
  if (b.settings) {
    const v = b.settings;
    const rm = Number(v.repeatMinutes), mx = Number(v.maxRepeats);
    if (!(rm >= 1 && rm <= 30)) return Response.json({ error: 'Repeat every 1 to 30 minutes.' }, { status: 400 });
    if (!(Number.isInteger(mx) && mx >= 0 && mx <= 20)) return Response.json({ error: 'Maximum repeats must be 0 to 20.' }, { status: 400 });
    const s = await saveKitchenSettings(db, v, admin.name);
    await logAdminAction(db, admin, 'kitchen_settings', `alerts ${s.enabled ? 'on' : 'off'}, Telegram ${s.telegram ? 'on' : 'off'}, every ${s.repeatMinutes} min, max ${s.maxRepeats}`);
    return Response.json({ ok: true, settings: s });
  }
  if (b.removeDevice) {
    const r = await db.prepare(`DELETE FROM push_subs WHERE endpoint = ? AND kitchen = 1`).bind(String(b.removeDevice)).run();
    await logAdminAction(db, admin, 'kitchen_device', 'removed a device');
    return Response.json({ ok: true, removed: r.meta?.changes || 0 });
  }
  return Response.json({ error: 'Nothing to do' }, { status: 400 });
}
