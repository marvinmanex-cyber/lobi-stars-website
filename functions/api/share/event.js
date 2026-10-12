import { ensurePageShareSchema, validSharePath, SHARE_PLATFORMS } from '../_lib/pageShare.js';

// POST /api/share/event { path, platform } -- the Share button counts a click
// (sent with navigator.sendBeacon). Anonymous: only the page and platform are
// stored, never an IP address, browser or anything else about the visitor.
// Always answers 204 or 400 and never blocks sharing.
export async function onRequestPost({ request, env }) {
  const bad = () => new Response(null, { status: 400 });
  try {
    const origin = request.headers.get('Origin');
    if (origin !== new URL(request.url).origin) return bad();
    const text = await request.text();
    if (text.length > 1000) return bad();
    let b;
    try { b = JSON.parse(text); } catch { return bad(); }
    const path = validSharePath(b?.path);
    const platform = SHARE_PLATFORMS.includes(b?.platform) ? b.platform : null;
    if (!path || !platform) return bad();
    await ensurePageShareSchema(env.DB);
    await env.DB.prepare(`INSERT INTO page_share_events (path, platform) VALUES (?, ?)`).bind(path, platform).run();
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[share] event', err);
    return new Response(null, { status: 204 });
  }
}
