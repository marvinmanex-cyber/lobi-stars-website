import { checkSignature } from '../../_lib/squadPublish.js';
import { getProfile, readFile, photoName, audioName, parseJson } from '../../_lib/squadProfiles.js';

// GET /api/partner/file/:id/:kind/:variant?exp=&sig= -- a photo or recording
// linked from /api/partner/squad. The link is signed and works for 24 hours;
// only verified profiles.
export async function onRequestGet({ request, env, params }) {
  const [id, kind, variant] = [].concat(params.path || []);
  const u = new URL(request.url);
  if (!(await checkSignature(env, id, kind, variant, u.searchParams.get('exp'), u.searchParams.get('sig')))) return new Response('This link has expired or is not valid.', { status: 403 });
  const p = await getProfile(env.DB, id);
  if (!p || p.status !== 'VERIFIED') return new Response('Not found', { status: 404 });
  const o = await readFile(env, p.id, kind, variant);
  if (!o) return new Response('Not found', { status: 404 });
  const type = o.httpMetadata?.contentType || 'application/octet-stream', data = parseJson(p.data_json, {});
  const ext = variant === 'mp3' ? 'mp3' : variant === 'original' ? (type.includes('mp4') ? 'm4a' : 'webm') : type === 'image/jpeg' ? 'jpg' : 'webp';
  const name = kind === 'audio' ? audioName(p, ext, data) : photoName(p, kind, ext, data);
  return new Response(o.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${name}"`, 'X-Robots-Tag': 'noindex' } });
}
