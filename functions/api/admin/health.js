import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { healthSummary, runChecks } from '../_lib/uptime.js';

// GET  /api/admin/health  -- Website Health: latest result per check, uptime
//                            (24 hours / 7 days), average response time, incidents
// POST /api/admin/health  -- "Check now"
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    return Response.json({ ...(await healthSummary(env.DB)), cron: !!env.CRON_SECRET });
  } catch (err) {
    console.error('[uptime] summary', err);
    return Response.json({ error: 'Could not load website health.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const r = await runChecks(env, new URL(request.url).origin, { force: true });
    await logAdminAction(env.DB, admin, 'health_check', `Checked now: ${Object.entries(r.results).map(([k, v]) => `${k} ${v.ok ? 'ok' : 'DOWN'}`).join(', ')}`);
    return Response.json({ ok: true, ...(await healthSummary(env.DB)) });
  } catch (err) {
    console.error('[uptime] check now', err);
    return Response.json({ error: 'The check could not run.' }, { status: 500 });
  }
}
