import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureProgrammeSchema, bucket, r2Keys, isJpeg } from '../../../_lib/programme.js';

// POST /api/admin/programmes/:id/share-assets  (multipart: card, square, story; JPEG)
// The share images made in the Share Hub. card <= 400 KB (WhatsApp ignores
// big preview images), square and story <= 2 MB. Stored with the programme's
// current version; older share images are removed afterwards.
const LIMITS = { card: 400 * 1024, square: 2 * 1024 * 1024, story: 2 * 1024 * 1024 };

export async function onRequestPost({ request, env, params, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = bucket(env);
  if (!b) return Response.json({ error: 'File storage (R2) is not connected yet.' }, { status: 503 });
  try {
    const db = env.DB;
    await ensureProgrammeSchema(db);
    const p = await db.prepare(`SELECT * FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    if (!p.version) return Response.json({ error: 'Upload the programme PDF first.' }, { status: 409 });
    let form;
    try { form = await request.formData(); } catch { return Response.json({ error: 'The upload could not be read.' }, { status: 400 }); }
    const files = {};
    for (const kind of Object.keys(LIMITS)) {
      const f = form.get(kind);
      const bytes = f && typeof f === 'object' && 'arrayBuffer' in f ? new Uint8Array(await f.arrayBuffer()) : null;
      if (!bytes || !isJpeg(bytes)) return Response.json({ error: `The ${kind} image is missing or not a JPEG.` }, { status: 400 });
      if (bytes.length > LIMITS[kind]) return Response.json({ error: `The ${kind} image is too large (max ${Math.round(LIMITS[kind] / 1024)} KB).` }, { status: 413 });
      files[kind] = bytes;
    }
    const keys = r2Keys(p.slug, p.version).share;
    const jpeg = { httpMetadata: { contentType: 'image/jpeg' } };
    await Promise.all(Object.entries(files).map(([kind, bytes]) => b.put(keys[kind], bytes, jpeg)));
    await db.prepare(`UPDATE programmes SET share_assets_version = ?, updated_at = datetime('now') WHERE id = ?`).bind(p.version, p.id).run();
    if (p.share_assets_version && p.share_assets_version !== p.version) {
      const old = r2Keys(p.slug, p.share_assets_version).share;
      waitUntil(b.delete([old.card, old.square, old.story]).catch(err => console.error('[share] old assets', err)));
    }
    await logAdminAction(db, admin, 'share_assets', `${p.title}: share images saved (version ${p.version}, card ${Math.round(files.card.length / 1024)} KB)`);
    return Response.json({ ok: true, shareAssetsVersion: p.version });
  } catch (err) {
    console.error('[share] assets', err);
    return Response.json({ error: 'The share images could not be saved.' }, { status: 500 });
  }
}
