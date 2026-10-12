import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { programmeSettings } from '../../_lib/programme.js';

// POST /api/admin/programmes/settings { enabled?, homepageBanner?, scanAutoDownload? } -- switches.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await programmeSettings(db);
    const b = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const writes = [];
    for (const [key, field] of [['programme_enabled', 'enabled'], ['programme_homepage_banner', 'homepageBanner'], ['scan_auto_download', 'scanAutoDownload']]) {
      if (typeof b[field] === 'boolean') {
        writes.push(db.prepare(`INSERT INTO programme_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
          .bind(key, String(b[field]), now, admin.name));
      }
    }
    if (writes.length) await db.batch(writes);
    const s = await programmeSettings(db);
    await logAdminAction(db, admin, 'programme_settings', `programme ${s.enabled ? 'on' : 'off'}, homepage banner ${s.homepageBanner ? 'on' : 'off'}, QR auto-download ${s.scanAutoDownload ? 'on' : 'off'}`);
    return Response.json({ ok: true, settings: s });
  } catch (err) {
    console.error('[admin programmes] settings', err);
    return Response.json({ error: 'Could not save the settings.' }, { status: 500 });
  }
}
