import { getPortalSession } from '../../_lib/squadPortal.js';
import { getAdmin } from '../../_lib/adminSession.js';
import { can, loadRoles } from '../../_lib/adminRoles.js';
import { getProfile, readFile, validFile, photoName, parseJson } from '../../_lib/squadProfiles.js';

// GET /api/squad-portal/file/:id/:kind/:variant[?download=1] -- a profile photo (profile,
// action, hero), for the portal (signed in) or the club review (squad.review). Old name
// recordings are kept in storage but no longer served (22 Oct 2026).
// Private: only the browser may keep a short copy. Downloads get the profile's file
// name (e.g. 09-musa-adeyemi.jpg, staff-headcoach-terver-iorliam.webp).
export async function onRequestGet({ request, env, params }) {
  const [id, kind, variant] = [].concat(params.path || []);
  if (!id || kind === 'audio' || !validFile(kind, variant)) return new Response('Not found', { status: 404 });
  let ok = !!(await getPortalSession(request, env, { touch: false }));
  if (!ok) {
    const admin = await getAdmin(request, env);
    if (admin) { await loadRoles(env.DB); ok = can(admin, 'squad.review'); }
  }
  if (!ok) return new Response('Sign in first', { status: 401 });
  const p = await getProfile(env.DB, id);
  if (!p) return new Response('Not found', { status: 404 });
  const o = await readFile(env, p.id, kind, variant);
  if (!o) return new Response('Not found', { status: 404 });
  const data = parseJson(p.data_json, {});
  const type = o.httpMetadata?.contentType || 'application/octet-stream';
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : variant.endsWith('.jpg') || type === 'image/jpeg' ? 'jpg' : 'webp';
  const name = photoName(p, kind, ext, data);
  return new Response(o.body, { headers: {
    'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Disposition': `${new URL(request.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"`,
  } });
}
