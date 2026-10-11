import { runKitchenRepeats } from '../_lib/kitchenNotify.js';

// POST /api/internal/kitchen-repeat -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Re-alerts paid orders the kitchen has not accepted yet (Kitchen Alerts settings).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Local testing only: ?olderThanSeconds= so tests don't have to wait minutes.
  const u = new URL(request.url);
  const dev = String(env.FANS_DEV_LINKS) === '1' && u.searchParams.has('olderThanSeconds');
  const sent = await runKitchenRepeats(env, dev ? { olderThanMs: Number(u.searchParams.get('olderThanSeconds')) * 1000 } : {});
  return Response.json({ ok: true, sent });
}
