import { checkSignature } from '../../_lib/squadPublish.js';
import { getProfile, readFile, photoName, parseJson } from '../../_lib/squadProfiles.js';

// GET /api/partner/file/:id/:kind/:variant?exp=&sig= -- a photo linked from
// /api/partner/squad. The link is signed and works for 24 hours; only verified
// profiles. (Name recordings are no longer shared: 22 Oct 2026.)
export async function onRequestGet({ request, env, params }) {
  const [id, kind, variant] = [].concat(params.path || []);
  const u = new URL(request.url);
  if (kind === 'audio') return new Response('Not found', { status: 404 });
  if (!(await checkSignature(env, id, kind, variant, u.searchParams.get('exp'), u.searchParams.get('sig')))) return new Response('This link has expired or is not valid.', { status: 403 });
  const p = await getProfile(env.DB, id);
  if (!p || p.status !== 'VERIFIED') return new Response('Not found', { status: 404 });
  const o = await readFile(env, p.id, kind, variant);
  if (!o) return new Response('Not found', { status: 404 });
  const type = o.httpMetadata?.contentType || 'application/octet-stream', data = parseJson(p.data_json, {});
  const name = photoName(p, kind, type === 'image/jpeg' ? 'jpg' : 'webp', data);
  return new Response(o.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${name}"`, 'X-Robots-Tag': 'noindex' } });
}
