import { syncChecklists, getSettings, saveSetting, ensureChecklistSchema } from '../_lib/matchChecklist.js';
import { runReminders } from '../_lib/checklistReminders.js';

// POST /api/internal/checklist-run -- Match Checklist jobs, with "Authorization: Bearer <CRON_SECRET>".
// Called every minute by the timer Worker (workers/kitchen-cron):
//   (default)        keeps checklists in step with the fixtures (every 15 minutes) and,
//                    from the reminder time (Lagos), sends the daily digest once a day.
// By hand (scripts/checklist.mjs):
//   ?action=generate                 generate / update checklists now
//   ?action=remind&dryRun=1          who would get what, nothing sent
//   ?action=remind&force=1           send now (still at most once per person per day)
const SYNC_EVERY_MS = 15 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const u = new URL(request.url);
  const action = u.searchParams.get('action') || 'tick';
  const flag = k => ['1', 'true', 'yes'].includes(String(u.searchParams.get(k) || '').toLowerCase());
  try {
    await ensureChecklistSchema(env.DB);
    if (action === 'generate') return Response.json({ ok: true, generate: await syncChecklists(env) });
    if (action === 'remind') return Response.json({ ok: true, remind: await runReminders(env, { dryRun: flag('dryRun'), force: flag('force') }) });
    // The every-minute tick.
    const out = { ok: true };
    const last = Number((await env.DB.prepare(`SELECT value FROM checklist_settings WHERE key = 'last_sync_at'`).first())?.value || 0);
    if (Date.now() - last >= SYNC_EVERY_MS) {
      out.generate = await syncChecklists(env);
      await saveSetting(env.DB, 'last_sync_at', String(Date.now()), 'Automatic');
    }
    const s = await getSettings(env.DB);
    if (s.remindersEnabled) out.remind = await runReminders(env, {});
    return Response.json(out);
  } catch (err) {
    console.error('[checklist-run]', err);
    return Response.json({ ok: false, error: 'Checklist job failed (see the logs).' }, { status: 500 });
  }
}
