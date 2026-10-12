import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { cleanCaption } from '../../_lib/share.js';
import { ensurePageShareSchema, ownPageUrl, CLUB_PLATFORMS } from '../../_lib/pageShare.js';

// POST /api/admin/share/page-mark { url, platformKey, title?, externalUrl? }
// Staff posted a page by hand (copied the caption, used the post window or
// their phone): record it in the club post history.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensurePageShareSchema(db);
    const b = await request.json().catch(() => ({}));
    const page = ownPageUrl(b.url, request);
    if (!page) return Response.json({ error: 'Only pages of lobistarsfc.com can be recorded.' }, { status: 400 });
    if (!CLUB_PLATFORMS.includes(b.platformKey)) return Response.json({ error: 'Unknown platform.' }, { status: 400 });
    let ext = null;
    if (b.externalUrl) { try { const u = new URL(String(b.externalUrl)); if (u.protocol === 'https:') ext = u.toString().slice(0, 300); } catch {} }
    await db.prepare(`INSERT INTO page_share_posts (url, path, title, platform_key, mode, status, external_url, staff_email) VALUES (?, ?, ?, ?, 'manual', 'marked', ?, ?)`)
      .bind(page.toString(), page.pathname, cleanCaption(b.title || '').slice(0, 200) || null, b.platformKey, ext, admin.email || admin.name).run();
    await logAdminAction(db, admin, 'Marked a page as shared', `${b.platformKey}: ${page.pathname}`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[share] page-mark', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
