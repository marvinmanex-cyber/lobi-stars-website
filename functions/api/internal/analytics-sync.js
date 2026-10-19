import { analyticsTick } from '../_lib/analyticsSync.js';

// POST /api/internal/analytics-sync -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Copies Search Console and GA4 figures into the database: the daily sync from
// 05:00 Nigeria time, one page of Google results per call. Answers { more: true }
// while there is more to fetch (the Worker calls again straight away). Does
// nothing until the Google settings are in place (handover A27).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    return Response.json({ ok: true, ...(await analyticsTick(env)) });
  } catch (err) {
    console.error('[analytics-sync] tick', err);
    return Response.json({ ok: false, more: false });
  }
}
