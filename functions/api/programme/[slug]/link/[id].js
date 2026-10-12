import { liveBySlug, logEvent } from '../../../_lib/programme.js';
import { getFan } from '../../../_lib/fanCode.js';

// GET /api/programme/:slug/link/:id -- counts a quick-link click, then goes to
// the stored address (never to an address taken from the request).
export async function onRequestGet({ request, env, params }) {
  const p = await liveBySlug(env.DB, params.slug).catch(() => null);
  const link = p ? await env.DB.prepare(`SELECT id, url FROM programme_links WHERE id = ? AND programme_id = ?`).bind(Number(params.id) || 0, p.id).first() : null;
  if (!link) return new Response(null, { status: 302, headers: { Location: new URL('/programme/', request.url).href } });
  const fan = await getFan(request, env);
  await logEvent(env.DB, { programmeId: p.id, fanId: fan?.id || null, type: 'link_click', linkId: link.id });
  return new Response(null, { status: 302, headers: { Location: new URL(link.url, request.url).href, 'Cache-Control': 'no-store' } });
}
