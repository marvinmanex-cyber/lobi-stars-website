// Matchday Live game sponsors (Super Admins only). ?game=motm | predict
//   GET  -> { sponsor }
//   POST JSON { name, line, show, removePhoto }  or  multipart with "photo" (JPG, PNG or WebP, at most 5 MB)
// Every change goes in the activity log with the admin's name and time.
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { storeFile } from '../_lib/mediaFiles.js';
import { GAMES, getGameSponsor, saveGameSponsor } from '../_lib/gameSponsors.js';

const isSuper = a => a.role === 'super_admin' || a.role === 'owner';
export const no = () => Response.json({ error: 'Only a Super Admin can change a sponsor.' }, { status: 403 });

export async function sponsorGet({ request, env }, game) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  return Response.json({ game, label: GAMES[game].label, sponsor: await getGameSponsor(env.DB, game) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function sponsorPost({ request, env }, game) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return no();
  const label = GAMES[game].label;
  let patch, what;
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await request.formData();
    const r = await storeFile(env, { blob: form.get('photo'), kind: 'image', name: `${label} sponsor`, width: form.get('width'), height: form.get('height'), by: admin.id, byName: admin.name, isPublic: true });
    if (r.error) return Response.json({ error: r.error }, { status: 400 });
    patch = { photoUrl: r.file.url }; what = 'photo or logo uploaded';
  } else {
    const b = await request.json().catch(() => ({}));
    patch = {};
    for (const k of ['name', 'line', 'show']) if (b[k] !== undefined) patch[k] = b[k];
    if (b.removePhoto) patch.photoUrl = null;
    what = b.removePhoto ? 'photo or logo removed' : Object.keys(patch).join(', ') || 'nothing';
  }
  const { before, after } = await saveGameSponsor(env.DB, game, patch, admin.name);
  await logAdminAction(env.DB, admin, `${game}_sponsor`, `${label} sponsor: ${what}. ${after.show ? 'Shown' : 'Hidden'}; "${after.name}"; "${after.line}"${after.photoUrl ? '; with picture' : '; name only'} (was ${before.show ? 'shown' : 'hidden'}, "${before.name}")`);
  return Response.json({ ok: true, game, label, sponsor: await getGameSponsor(env.DB, game) });
}

const gameOf = request => (new URL(request.url).searchParams.get('game') || '').toLowerCase();
export async function onRequestGet(ctx) {
  const g = gameOf(ctx.request);
  if (!GAMES[g]) return Response.json({ error: 'Choose motm or predict.' }, { status: 400 });
  return sponsorGet(ctx, g);
}
export async function onRequestPost(ctx) {
  const g = gameOf(ctx.request);
  if (!GAMES[g]) return Response.json({ error: 'Choose motm or predict.' }, { status: 400 });
  return sponsorPost(ctx, g);
}
