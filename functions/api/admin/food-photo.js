import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureMenuSchema, photoUrl } from '../_lib/foodMenuDb.js';
import { randomId } from '../_lib/crypto.js';

const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX = 400 * 1024; // the admin page shrinks photos to WebP under 200KB before uploading

// POST /api/admin/food-photo (body: the image file) -- stores a menu photo.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return Response.json({ error: 'Photos must be JPG, PNG or WebP.' }, { status: 400 });
  const data = await request.arrayBuffer();
  if (!data.byteLength) return Response.json({ error: 'The photo is empty.' }, { status: 400 });
  if (data.byteLength > MAX) return Response.json({ error: 'The photo is too large after compression. Try a smaller picture.' }, { status: 413 });
  // Check the file really is the image type it claims (magic bytes).
  const b = new Uint8Array(data.slice(0, 12));
  const ok = (type === 'image/png' && b[0] === 0x89 && b[1] === 0x50) || (type === 'image/jpeg' && b[0] === 0xFF && b[1] === 0xD8)
    || (type === 'image/webp' && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45);
  if (!ok) return Response.json({ error: 'That file is not a valid image.' }, { status: 400 });
  await ensureMenuSchema(env.DB);
  const id = randomId('fp', 12);
  await env.DB.prepare(`INSERT INTO food_photos (id, mime, data, bytes, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, type, data, data.byteLength, new Date().toISOString()).run();
  return Response.json({ ok: true, id, url: photoUrl(id) }, { headers: { 'Cache-Control': 'no-store' } });
}
