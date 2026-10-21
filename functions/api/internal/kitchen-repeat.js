import { runKitchenRepeats } from '../_lib/kitchenNotify.js';
import { runFanPush, checkRadioOnAir } from '../_lib/matchAlerts.js';
import { scoresTickIfDue } from '../_lib/scores/consensus.js';

// POST /api/internal/kitchen-repeat -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Re-alerts paid orders the kitchen has not accepted yet (Kitchen Alerts settings),
// sends fans the "radio show is live" alert when commentary goes on air, and
// continues any match alert still going out to fans, and (as a fallback) the
// score verification run.
export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Local testing only: ?olderThanSeconds= so tests don't have to wait minutes.
  const u = new URL(request.url);
  const dev = String(env.FANS_DEV_LINKS) === '1' && u.searchParams.has('olderThanSeconds');
  const sent = await runKitchenRepeats(env, dev ? { olderThanMs: Number(u.searchParams.get('olderThanSeconds')) * 1000 } : {});
  const origin = u.origin;
  await checkRadioOnAir(env, { origin });
  const fans = await runFanPush(env, { origin });
  // Score verification runs here too until the cron Worker calls /api/internal/scores-run itself (it skips if that ran in the last 90 seconds).
  waitUntil(scoresTickIfDue(env).catch(err => console.error('[scores] tick fallback', err)));
  return Response.json({ ok: true, sent, fanAlerts: fans });
}
