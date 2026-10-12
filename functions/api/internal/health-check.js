import { runChecks } from '../_lib/uptime.js';

// POST /api/internal/health-check -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>". Runs the
// website health checks at most every 5 minutes.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const r = await runChecks(env, new URL(request.url).origin);
    return Response.json({ ok: true, ran: !!r, opened: r?.opened || [], closed: r?.closed || [] });
  } catch (err) {
    console.error('[uptime] run', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
