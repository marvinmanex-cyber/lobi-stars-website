import { runFanPush } from '../_lib/matchAlerts.js';

// POST /api/internal/fan-push-run -- sends the next batch of a match alert.
// Called by the site itself (to continue straight away) and the cron Worker,
// with "Authorization: Bearer <CRON_SECRET>".
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const r = await runFanPush(env, { origin: new URL(request.url).origin });
  return Response.json({ ok: true, ...r });
}
