import { getProfile, readFile, parseJson } from '../../_lib/squadProfiles.js';

// GET /api/squad/photo/:id/:kind/:variant -- the public photo of a VERIFIED
// profile (profile or action photo) for the Squad pages. Anything else (drafts,
// submitted, left the club, recordings) is "not found".
export async function onRequestGet({ env, params }) {
  const [id, kind, variant] = [].concat(params.path || []);
  if (!['profile', 'action'].includes(kind) || !['w400.webp', 'w1200.webp', 'w1200.jpg'].includes(variant)) return new Response('Not found', { status: 404 });
  const p = await getProfile(env.DB, id);
  if (!p || p.status !== 'VERIFIED' || !parseJson(p.photos_json, {})[kind]) return new Response('Not found', { status: 404 });
  const o = await readFile(env, p.id, kind, variant);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'image/webp', 'Cache-Control': 'public, max-age=86400' } });
}
