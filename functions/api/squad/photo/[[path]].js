import { getProfile, readFile, liveOf } from '../../_lib/squadProfiles.js';
import { PUBLIC_STATUSES } from '../../../../src/lib/squadFields.js';

// GET /api/squad/photo/:id/:kind/:variant -- the public photo of a LIVE (or on loan)
// profile's live version (profile, action or hero photo) for the Squad pages. Anything
// else (drafts, waiting for approval, former, hidden, recordings) is "not found"; a new
// photo waiting for approval is never shown.
export async function onRequestGet({ env, params }) {
  const [id, kind, variant] = [].concat(params.path || []);
  if (!['profile', 'action', 'hero'].includes(kind) || !['w400.webp', 'w1200.webp', 'w1200.jpg', ...(kind === 'hero' ? ['w2000.webp'] : [])].includes(variant)) return new Response('Not found', { status: 404 });
  const p = await getProfile(env.DB, id);
  const live = liveOf(p);
  if (!p || !PUBLIC_STATUSES.includes(p.status) || !live?.photos?.[kind] || live.data?.hideFromWebsite) return new Response('Not found', { status: 404 });
  const o = await readFile(env, p.id, kind, variant, live.photos[kind].rev || null);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'image/webp', 'Cache-Control': 'public, max-age=86400' } });
}
