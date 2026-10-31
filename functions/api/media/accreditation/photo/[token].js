import { verifyView } from '../../../_lib/mediaAccreditation.js';
import { fileRow, fileBytes } from '../../../_lib/mediaFiles.js';

// GET /api/media/accreditation/photo/<verify token> -- the journalist's photo on the
// public verification page (only through the card's QR token).
export async function onRequestGet({ env, params }) {
  const v = await verifyView(env.DB, params.token);
  const row = v?.photoId ? await fileRow(env.DB, v.photoId) : null;
  const bytes = row ? await fileBytes(env, row) : null;
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } });
}
