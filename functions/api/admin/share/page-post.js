import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { configured, cleanCaption, AUTO_CAPABLE } from '../../_lib/share.js';
import { postLink } from '../../_lib/shareAdapters.js';
import { ensurePageShareSchema, ownPageUrl, withUtm } from '../../_lib/pageShare.js';

// POST /api/admin/share/page-post { url, caption | captions: { key: text }, platforms: [...], title? }
// Posts a page of the site to the club's Telegram channel and/or Facebook
// Page (only platforms whose secrets are set). One failure doesn't stop the
// others. At most 3 posts per platform per page per hour.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensurePageShareSchema(db);
    const b = await request.json().catch(() => ({}));
    const page = ownPageUrl(b.url, request);
    if (!page) return Response.json({ error: 'Only pages of lobistarsfc.com can be posted.' }, { status: 400 });
    const keys = [...new Set(Array.isArray(b.platforms) ? b.platforms.map(String) : [])];
    if (!keys.length) return Response.json({ error: 'Choose at least one platform.' }, { status: 400 });
    const title = cleanCaption(b.title || '').slice(0, 200) || null;
    const base = page.toString();

    const results = await Promise.allSettled(keys.map(async key => {
      if (!AUTO_CAPABLE.includes(key)) return { key, ok: false, notConfigured: true, error: 'This platform cannot post automatically: use Copy caption or Open post window.' };
      if (!configured(env, key)) return { key, ok: false, notConfigured: true, error: 'Auto-posting is not set up for this platform yet (see DEPLOYMENT.md, Share Hub).' };
      const recent = await db.prepare(`SELECT COUNT(*) n FROM page_share_posts WHERE path = ? AND platform_key = ? AND mode = 'auto' AND created_at >= datetime('now', '-1 hour')`).bind(page.pathname, key).first();
      if ((recent?.n || 0) >= 3) return { key, ok: false, limited: true, error: 'This page was already posted 3 times on this platform in the last hour.' };
      const url = withUtm(base, key, 'club_post');
      const caption = cleanCaption((b.captions && b.captions[key]) || b.caption || '').trim();
      if (!caption) return { key, ok: false, error: 'The caption is empty.' };
      const text = caption.includes(base) ? caption.split(base).join(url) : caption;
      try {
        const r = await postLink(env, key, { caption: text, url });
        await db.prepare(`INSERT INTO page_share_posts (url, path, title, platform_key, mode, status, external_id, external_url, staff_email) VALUES (?, ?, ?, ?, 'auto', 'posted', ?, ?, ?)`)
          .bind(base, page.pathname, title, key, r.externalId || null, r.externalUrl || null, admin.email || admin.name).run();
        await logAdminAction(db, admin, 'Shared a page', `${key}: ${page.pathname}`);
        return { key, ok: true, externalUrl: r.externalUrl || null };
      } catch (err) {
        const msg = String(err.message || 'Posting failed.').slice(0, 300);
        await db.prepare(`INSERT INTO page_share_posts (url, path, title, platform_key, mode, status, error, staff_email) VALUES (?, ?, ?, ?, 'auto', 'failed', ?, ?)`)
          .bind(base, page.pathname, title, key, msg, admin.email || admin.name).run();
        await logAdminAction(db, admin, 'Page share failed', `${key}: ${page.pathname}`);
        return { key, ok: false, error: msg };
      }
    }));
    const out = results.map((r, i) => (r.status === 'fulfilled' ? r.value : { key: keys[i], ok: false, error: 'Posting failed.' }));
    const limited = out.length && out.every(r => r.limited);
    return Response.json({ results: out }, { status: limited ? 429 : 200 });
  } catch (err) {
    console.error('[share] page-post', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
