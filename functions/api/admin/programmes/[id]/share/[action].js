import { requireAdminUser } from '../../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../../_lib/adminSession.js';
import { ensureShareSchema, platforms, cleanCaption, configured, AUTO_CAPABLE, programmeState } from '../../../../_lib/share.js';
import { postProgramme } from '../../../../_lib/shareRun.js';

// PUT  /api/admin/programmes/:id/share/captions  { platformKey, caption }  -- save an edited caption ("" = back to the default)
// POST /api/admin/programmes/:id/share/mark      { platformKey }           -- "Mark as posted" (posted by hand)
// POST /api/admin/programmes/:id/share/post      { platforms: [...] }      -- auto-post now (Telegram / Facebook, when set up)
// PUT  /api/admin/programmes/:id/share/schedule  { at, platforms }          -- auto-post later (at = null clears it)
async function load(env, id) {
  await ensureShareSchema(env.DB);
  return env.DB.prepare(`SELECT * FROM programmes WHERE id = ?`).bind(Number(id) || 0).first();
}
const who = admin => admin.email || admin.name;

export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const p = await load(env, params.id);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    const keys = (await platforms(db, false)).map(x => x.key);

    if (params.action === 'captions') {
      if (!keys.includes(b.platformKey)) return Response.json({ error: 'Unknown platform.' }, { status: 400 });
      const caption = cleanCaption(b.caption).trim();
      if (!caption) await db.prepare(`DELETE FROM programme_captions WHERE programme_id = ? AND platform_key = ?`).bind(p.id, b.platformKey).run();
      else await db.prepare(`INSERT INTO programme_captions (programme_id, platform_key, caption, updated_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (programme_id, platform_key) DO UPDATE SET caption = excluded.caption, updated_at = excluded.updated_at`).bind(p.id, b.platformKey, caption).run();
      await logAdminAction(db, admin, 'share_caption', `${p.title}: ${b.platformKey} caption ${caption ? 'edited' : 'reset to default'}`);
      return Response.json({ ok: true });
    }

    if (params.action === 'schedule') {
      if (b.at === null || b.at === '') {
        await db.prepare(`UPDATE programmes SET social_autopost_at = NULL, social_autopost_platforms = NULL, social_autopost_done = 0 WHERE id = ?`).bind(p.id).run();
        await logAdminAction(db, admin, 'share_schedule', `${p.title}: scheduled auto-post cleared`);
        return Response.json({ ok: true, schedule: null });
      }
      const at = Date.parse(String(b.at));
      if (Number.isNaN(at)) return Response.json({ error: 'Please choose a valid date and time.' }, { status: 400 });
      const list = [...new Set(Array.isArray(b.platforms) ? b.platforms : [])].filter(k => AUTO_CAPABLE.includes(k));
      if (!list.length) return Response.json({ error: 'Choose at least one platform (Telegram or Facebook).' }, { status: 400 });
      if (programmeState(p) === 'unavailable') return Response.json({ error: 'Publish or schedule the programme first.' }, { status: 409 });
      const iso = new Date(at).toISOString();
      await db.prepare(`UPDATE programmes SET social_autopost_at = ?, social_autopost_platforms = ?, social_autopost_done = 0 WHERE id = ?`).bind(iso, JSON.stringify(list), p.id).run();
      await logAdminAction(db, admin, 'share_schedule', `${p.title}: auto-post to ${list.join(', ')} at ${iso}`);
      return Response.json({ ok: true, schedule: { at: iso, platforms: list, done: false } });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    console.error('[share] put', err);
    return Response.json({ error: 'Could not save.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const p = await load(env, params.id);
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    const keys = (await platforms(db, false)).map(x => x.key);

    if (params.action === 'mark') {
      if (!keys.includes(b.platformKey)) return Response.json({ error: 'Unknown platform.' }, { status: 400 });
      await db.prepare(`INSERT INTO social_posts (programme_id, platform_key, mode, status, staff_email) VALUES (?, ?, 'manual', 'marked', ?)`).bind(p.id, b.platformKey, who(admin)).run();
      await logAdminAction(db, admin, 'share_mark', `${p.title}: marked as posted on ${b.platformKey}`);
      return Response.json({ ok: true });
    }

    if (params.action === 'post') {
      const list = [...new Set(Array.isArray(b.platforms) ? b.platforms : [])];
      if (!list.length) return Response.json({ error: 'Choose at least one platform.' }, { status: 400 });
      const notReady = list.filter(k => !AUTO_CAPABLE.includes(k) || !configured(env, k));
      if (notReady.length) return Response.json({ error: `Auto-posting is not set up for: ${notReady.join(', ')}.` }, { status: 400 });
      if (programmeState(p) === 'unavailable') return Response.json({ error: 'Publish or schedule the programme first.' }, { status: 409 });
      for (const k of list) {
        const n = await db.prepare(`SELECT COUNT(*) AS n FROM social_posts WHERE programme_id = ? AND platform_key = ? AND mode = 'auto' AND created_at > datetime('now', '-1 hour')`).bind(p.id, k).first();
        if (n.n >= 3) return Response.json({ error: `Already auto-posted to ${k} 3 times in the last hour. Please wait.` }, { status: 429 });
      }
      const results = await postProgramme(env, p, list, who(admin));
      await logAdminAction(db, admin, 'share_post', `${p.title}: ${results.map(r => `${r.platform} ${r.ok ? 'posted' : `failed (${r.error})`}`).join('; ')}`);
      return Response.json({ ok: true, results });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    console.error('[share] post', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
