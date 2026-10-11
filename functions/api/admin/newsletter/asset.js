import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureNewsletterSchema, newId } from '../../_lib/newsletter.js';

const TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/gif'];
const MAX = 900 * 1024; // the admin page shrinks pictures before uploading

// POST /api/admin/newsletter/asset (body: the image) -- a sponsor logo or a
// newsletter photo. Returns its public address for emails.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return Response.json({ error: 'Pictures must be JPG, PNG, WebP or GIF.' }, { status: 400 });
  const data = await request.arrayBuffer();
  if (!data.byteLength) return Response.json({ error: 'The picture is empty.' }, { status: 400 });
  if (data.byteLength > MAX) return Response.json({ error: 'The picture is too large. Try a smaller one.' }, { status: 413 });
  const b = new Uint8Array(data.slice(0, 12));
  const ok = (type === 'image/png' && b[0] === 0x89 && b[1] === 0x50) || (type === 'image/jpeg' && b[0] === 0xFF && b[1] === 0xD8)
    || (type === 'image/webp' && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) || (type === 'image/gif' && b[0] === 0x47 && b[1] === 0x49);
  if (!ok) return Response.json({ error: 'That file is not a valid picture.' }, { status: 400 });
  await ensureNewsletterSchema(env.DB);
  const id = newId('NA');
  await env.DB.prepare(`INSERT INTO newsletter_assets (id, mime, data, bytes, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, type, data, data.byteLength, new Date().toISOString()).run();
  return Response.json({ ok: true, id, url: `/api/newsletter/asset/${id}` }, { headers: { 'Cache-Control': 'no-store' } });
}
