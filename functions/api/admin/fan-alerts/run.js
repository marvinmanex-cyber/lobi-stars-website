import { requireAdminUser } from '../../_lib/adminEvents.js';
import { runFanPush } from '../../_lib/matchAlerts.js';

// POST /api/admin/fan-alerts/run -- sends the next batch of any match alert
// still going out. Every open admin page calls this every few seconds while
// alerts are pending, so large lists finish quickly on any Cloudflare plan.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return Response.json(await runFanPush(env, { origin: new URL(request.url).origin }), { headers: { 'Cache-Control': 'no-store' } });
}
