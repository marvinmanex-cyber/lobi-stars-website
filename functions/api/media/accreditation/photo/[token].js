import { ensureAccreditationSchema } from '../../../_lib/mediaAccreditation.js';
import { fileRow, fileBytes } from '../../../_lib/mediaFiles.js';

// GET /api/media/accreditation/photo/<verify token> -- the holder's photo on the
// public verification page (only through the card's QR token; never other data).
export async function onRequestGet({ env, params }) {
  await ensureAccreditationSchema(env.DB);
  const token = String(params.token || '').replace(/[^\w-]/g, '').slice(0, 80);
  const r = token ? await env.DB.prepare(`SELECT photo_id FROM mc_accreditations WHERE verify_token = ?`).bind(token).first() : null;
  const row = r?.photo_id ? await fileRow(env.DB, r.photo_id) : null;
  const bytes = row ? await fileBytes(env, row) : null;
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } });
}
