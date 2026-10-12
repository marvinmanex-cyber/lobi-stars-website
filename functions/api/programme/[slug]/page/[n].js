import { liveBySlug, streamObject, PAGE_COUNT } from '../../../_lib/programme.js';
import { requireFan } from '../../../_lib/fanCode.js';

// GET /api/programme/:slug/page/:n.jpg?v=<version> -- a page image, registered fans only.
// The address changes with every upload (?v=), so it can be cached for good.
export async function onRequestGet({ request, env, params }) {
  const n = Number(String(params.n).replace(/\.jpg$/, ''));
  if (!Number.isInteger(n) || n < 1 || n > PAGE_COUNT) return new Response('Not found', { status: 404 });
  const { denied } = await requireFan(request, env);
  if (denied) return denied;
  const p = await liveBySlug(env.DB, params.slug).catch(() => null);
  if (!p) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare(`SELECT image_key FROM programme_pages WHERE programme_id = ? AND page_number = ?`).bind(p.id, n).first();
  return streamObject(env, row?.image_key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' });
}
