import { rewardsSweep } from '../_lib/rewardsEarn.js';

// POST /api/internal/rewards-run -- the regular Lobi Stars Rewards job, called
// by the cron Worker ("Authorization: Bearer <CRON_SECRET>"): ticket points of
// played matches become available, Predict & Win results and birthday bonuses
// are added. Runs at most once every 10 minutes (the Worker calls every minute).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const db = env.DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`).run();
    const force = new URL(request.url).searchParams.get('force') === '1';
    const claim = await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('rewards_last_run', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE ? = 1 OR settings.updated_at <= datetime('now', '-10 minutes')`).bind(new Date().toISOString(), force ? 1 : 0).run();
    if (!claim.meta.changes) return Response.json({ ok: true, skipped: true });
    return Response.json({ ok: true, ...(await rewardsSweep(env)) });
  } catch (err) {
    console.error('[rewards] run', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
