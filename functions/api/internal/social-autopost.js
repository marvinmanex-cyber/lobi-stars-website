import { ensureShareSchema, programmeState } from '../_lib/share.js';
import { postProgramme } from '../_lib/shareRun.js';

// POST /api/internal/social-autopost -- called by the cron Worker
// (workers/kitchen-cron, every minute) with "Authorization: Bearer <CRON_SECRET>".
// Posts programmes whose scheduled auto-post time has come. Each programme is
// claimed with a conditional UPDATE first, so it can never post twice.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const db = env.DB;
    await ensureShareSchema(db);
    const now = new Date().toISOString();
    const { results } = await db.prepare(`SELECT * FROM programmes WHERE social_autopost_at IS NOT NULL AND social_autopost_at <= ? AND social_autopost_done = 0 LIMIT 5`).bind(now).all();
    const done = [];
    for (const p of results) {
      if (programmeState(p) === 'unavailable') continue; // waits until it is published or scheduled again
      const claim = await db.prepare(`UPDATE programmes SET social_autopost_done = 1 WHERE id = ? AND social_autopost_done = 0`).bind(p.id).run();
      if (!claim.meta?.changes) continue;
      let list = [];
      try { list = JSON.parse(p.social_autopost_platforms || '[]'); } catch {}
      const r = await postProgramme(env, p, list, null);
      done.push({ programme: p.slug, results: r });
    }
    return Response.json({ ok: true, posted: done });
  } catch (err) {
    console.error('[share] autopost', err);
    return Response.json({ ok: false, error: 'Auto-post failed' }, { status: 500 });
  }
}
