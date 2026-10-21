import { runBatchPoll, weeklyScan } from '../_lib/aiFix.js';
import { aiReady, getAiSettings, saveAiSetting } from '../_lib/claude.js';

// POST /api/internal/ai-run -- called every minute by the timer Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Does nothing without ANTHROPIC_API_KEY. Every 5 minutes: collects finished
// Message Batches. Once a week (AI Settings: day and time, Lagos): the weekly scan.
const POLL_EVERY_MS = 5 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!aiReady(env)) return Response.json({ ok: true, idle: 'no key' });
  try {
    const s = await getAiSettings(env.DB), out = { ok: true };
    if (Date.now() - (Number(s.last_poll_at) || 0) >= POLL_EVERY_MS) {
      await saveAiSetting(env.DB, 'last_poll_at', Date.now());
      out.batches = await runBatchPoll(env);
    }
    const scan = await weeklyScan(env);
    if (scan) out.scan = scan;
    return Response.json(out);
  } catch (err) {
    console.error('[ai-run]', err);
    return Response.json({ ok: false, error: 'AI job failed (see the logs).' }, { status: 500 });
  }
}
