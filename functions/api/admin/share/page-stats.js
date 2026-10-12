import { requireAdminUser } from '../../_lib/adminEvents.js';
import { configured } from '../../_lib/share.js';
import { ensurePageShareSchema, shareHashtags } from '../../_lib/pageShare.js';

// GET /api/admin/share/page-stats?range=7|30|90 -- what visitors share most
// (anonymous Share button clicks), shares per platform, and the club's own
// recent posts of pages. Also says which platforms can post automatically.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensurePageShareSchema(db);
    const range = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get('range'))) ? Number(new URL(request.url).searchParams.get('range')) : 30;
    const since = `-${range} days`;
    const [top, byPlatform, posts, total] = await Promise.all([
      db.prepare(`SELECT path, COUNT(*) shares FROM page_share_events WHERE created_at >= datetime('now', ?) GROUP BY path ORDER BY shares DESC, path LIMIT 20`).bind(since).all(),
      db.prepare(`SELECT platform, COUNT(*) shares FROM page_share_events WHERE created_at >= datetime('now', ?) GROUP BY platform ORDER BY shares DESC`).bind(since).all(),
      db.prepare(`SELECT id, url, path, title, platform_key, mode, status, external_url, error, staff_email, created_at FROM page_share_posts ORDER BY id DESC LIMIT 50`).all(),
      db.prepare(`SELECT COUNT(*) n FROM page_share_events WHERE created_at >= datetime('now', ?)`).bind(since).first(),
    ]);
    return Response.json({
      range, total: total?.n || 0, topPages: top.results, byPlatform: byPlatform.results, posts: posts.results,
      auto: { telegram: configured(env, 'telegram'), facebook: configured(env, 'facebook') },
      hashtags: await shareHashtags(db),
    });
  } catch (err) {
    console.error('[share] page-stats', err);
    return Response.json({ error: 'Could not load the share stats.' }, { status: 500 });
  }
}
