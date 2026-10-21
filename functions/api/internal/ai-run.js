import { runBatchPoll, weeklyScan, verifyApplied, recheckResults, dryRun, lagosDate } from '../_lib/aiFix.js';
import { aiReady, getAiSettings, saveAiSetting } from '../_lib/claude.js';

// POST /api/internal/ai-run -- called every minute by the timer Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// Does nothing without ANTHROPIC_API_KEY (or CLAUDE_MOCK). Every 5 minutes:
// collects finished Message Batches (and emails when fixes are ready). Once a
// day: checks applied fixes (verified / failed) and measures Fix results at 14
// and 30 days. Once a week (AI Settings: day and time, Lagos): the check-up.
// ?action=dry_run  -- what the check-up would do and cost; no AI, nothing changes.
const POLL_EVERY_MS = 5 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const action = new URL(request.url).searchParams.get('action');
  try {
    if (action === 'dry_run') return Response.json({ ok: true, ...(await dryRun(env)) });
    if (!aiReady(env)) return Response.json({ ok: true, idle: 'no key' });
    const s = await getAiSettings(env.DB), out = { ok: true };
    if (Date.now() - (Number(s.last_poll_at) || 0) >= POLL_EVERY_MS) {
      await saveAiSetting(env.DB, 'last_poll_at', Date.now());
      out.batches = await runBatchPoll(env);
    }
    const today = lagosDate();
    if (s.last_daily_check !== today) {
      await saveAiSetting(env.DB, 'last_daily_check', today);
      out.verify = await verifyApplied(env);
      out.results = await recheckResults(env);
    }
    const scan = await weeklyScan(env);
    if (scan) out.scan = scan;
    return Response.json(out);
  } catch (err) {
    console.error('[ai-run]', err);
    return Response.json({ ok: false, error: 'AI job failed (see the logs).' }, { status: 500 });
  }
}
