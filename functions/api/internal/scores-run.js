import { scoresTick } from '../_lib/scores/consensus.js';

// POST /api/internal/scores-run -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Score verification: settles matches around now (so a disagreement becomes a
// conflict after the grace window), and sends missing-result reminders.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Local testing only: ?now=<ISO time>.
  const u = new URL(request.url);
  const now = String(env.FANS_DEV_LINKS) === '1' && u.searchParams.get('now') ? Date.parse(u.searchParams.get('now')) : Date.now();
  try {
    return Response.json({ ok: true, ...(await scoresTick(env, { now })) });
  } catch (err) {
    console.error('[scores] run', err);
    return Response.json({ error: 'Score run failed' }, { status: 500 });
  }
}
