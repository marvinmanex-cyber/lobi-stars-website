// Man of the Match Sponsor (Super Admins only): GET the settings record "motm_sponsor";
// POST JSON { name, line, show, removePhoto } to change them; POST multipart (field "photo") to
// upload or replace the sponsor photo (JPG, PNG or WebP, at most 5 MB; stored with the website's
// file helper). Every change goes in the activity log with the admin's name and time.
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { storeFile } from '../_lib/mediaFiles.js';
import { getSponsor, saveSponsor } from '../_lib/motmService.js';

const isSuper = a => a.role === 'super_admin' || a.role === 'owner';
const no = () => Response.json({ error: 'Only a Super Admin can change the Man of the Match sponsor.' }, { status: 403 });

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  return Response.json({ sponsor: await getSponsor(env.DB) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  const type = request.headers.get('content-type') || '';
  let patch, what;
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const r = await storeFile(env, { blob: form.get('photo'), kind: 'image', name: 'Man of the Match sponsor', width: form.get('width'), height: form.get('height'), by: admin.id, byName: admin.name, isPublic: true });
    if (r.error) return Response.json({ error: r.error }, { status: 400 });
    patch = { photoUrl: r.file.url }; what = 'photo uploaded';
  } else {
    const b = await request.json().catch(() => ({}));
    patch = {};
    for (const k of ['name', 'line', 'show']) if (b[k] !== undefined) patch[k] = b[k];
    if (b.removePhoto) patch.photoUrl = null;
    what = Object.keys(patch).join(', ') || 'nothing';
  }
  const { before, after } = await saveSponsor(env.DB, patch, admin.name);
  await logAdminAction(env.DB, admin, 'motm_sponsor', `Man of the Match sponsor: ${what}. ${after.show ? 'Shown' : 'Hidden'}; "${after.name}"; "${after.line}"${after.photoUrl ? '; with photo' : '; no photo'} (was ${before.show ? 'shown' : 'hidden'}, "${before.name}")`);
  return Response.json({ ok: true, sponsor: await getSponsor(env.DB) });
}
