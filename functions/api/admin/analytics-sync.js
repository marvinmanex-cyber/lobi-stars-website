import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { syncStatus, startSync, stepSync } from '../_lib/analyticsSync.js';

// Google & Search data sync (Admin › Analytics; permission analytics.view_all).
// GET                                 -- what is set up (setting names only, never values), the last sync, row counts
// POST { action: 'sync', full: bool } -- "Sync now": the last 4 days, or 90 days with full
// POST { action: 'step' }             -- the next step of the running sync (the page calls it until done)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return json(await syncStatus(env));
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  if (body.action === 'sync') {
    const r = await startSync(env, { trigger: 'manual', by: admin.name || admin.email || 'Admin', days: body.full ? 90 : null });
    if (r.error) return json(r, 409);
    if (!r.already) await logAdminAction(env.DB, admin, 'analytics_sync_start', `${r.run.start} to ${r.run.end}`);
    return json({ ok: true, already: r.already, run: { ...r.run, tasks: r.run.tasks.length } });
  }
  if (body.action === 'step') {
    const r = await stepSync(env);
    return json({ ok: true, run: r.run ? { ...r.run, tasks: r.run.tasks.length } : null });
  }
  return json({ error: 'Unknown action' }, 400);
}
