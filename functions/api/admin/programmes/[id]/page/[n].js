import { requireAdminUser } from '../../../../_lib/adminEvents.js';
import { ensureProgrammeSchema, streamObject, PAGE_COUNT } from '../../../../_lib/programme.js';

// GET /api/admin/programmes/:id/page/:n.jpg (n = 1..4, or "cover") -- staff
// preview of any programme (draft too). No fan login, no reading stats.
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureProgrammeSchema(env.DB);
  const id = Number(params.id) || 0;
  const which = String(params.n).replace(/\.jpg$/, '');
  let key = null;
  if (which === 'cover') key = (await env.DB.prepare(`SELECT cover_key FROM programmes WHERE id = ?`).bind(id).first())?.cover_key;
  else {
    const n = Number(which);
    if (!Number.isInteger(n) || n < 1 || n > PAGE_COUNT) return new Response('Not found', { status: 404 });
    key = (await env.DB.prepare(`SELECT image_key FROM programme_pages WHERE programme_id = ? AND page_number = ?`).bind(id, n).first())?.image_key;
  }
  return streamObject(env, key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
}
