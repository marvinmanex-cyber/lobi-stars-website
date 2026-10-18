import { backupStep, mediaStep, backupReady, weeklyOffsiteEmail } from '../_lib/autoBackup.js';
import { securitySettings, saveSecuritySetting } from '../_lib/adminSecurity.js';
import { logAdminAction } from '../_lib/adminSession.js';

// POST /api/internal/backup-run -- called every minute by the cron Worker
// ("Authorization: Bearer <CRON_SECRET>"). Runs the next step of today's automatic
// backup (from 02:00 Nigeria time), the weekly media copy (Sundays), the weekly emailed
// encrypted copy (Mondays, to keep outside Cloudflare), and alerts
// the Super Admins if no backup has finished for more than 26 hours.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!backupReady(env)) return Response.json({ ok: true, ready: false });
  const out = { db: await backupStep(env) };
  try { out.media = await mediaStep(env); } catch (err) { console.error('[backup] media', err); }
  try { out.offsite = await weeklyOffsiteEmail(env); } catch (err) { console.error('[backup] weekly email', err); }
  try {
    const s = await securitySettings(env.DB);
    let last = null; try { last = s.auto_backup_last ? JSON.parse(s.auto_backup_last) : null; } catch { last = null; }
    const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
    if (last && Date.now() - Date.parse(last.at) > 26 * 3600e3 && s.backup_overdue_alert !== today) {
      await saveSecuritySetting(env.DB, 'backup_overdue_alert', today, 'Automatic backup');
      await logAdminAction(env.DB, { id: 'system', name: 'Automatic backup' }, 'backup_overdue', `last finished backup: ${last.day}`);
    }
  } catch (err) { console.error('[backup] overdue check', err); }
  return Response.json({ ok: true, ...out });
}
