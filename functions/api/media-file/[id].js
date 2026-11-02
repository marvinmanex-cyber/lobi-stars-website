import { fileRow, fileBytes } from '../_lib/mediaFiles.js';
import { getMediaSession } from '../_lib/mediaCentre.js';
import { getAdmin } from '../_lib/adminSession.js';

// GET /api/media-file/<id> -- a Media Centre file. Public files (press kit,
// press releases) open for everyone; others only for a signed-in Media Centre
// user or a staff member of the admin.
export async function onRequestGet({ request, env, params }) {
  const row = await fileRow(env.DB, params.id);
  if (!row) return new Response('Not found', { status: 404 });
  if (!row.is_public) {
    const ok = (await getMediaSession(request, env, { touch: false })) || (await getAdmin(request, env));
    if (!ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const bytes = await fileBytes(env, row);
  if (!bytes) return new Response('Not found', { status: 404 });
  const ext = row.mime === 'application/pdf' ? 'pdf' : row.mime.split('/')[1];
  return new Response(bytes, { headers: {
    'Content-Type': row.mime,
    'Cache-Control': row.is_public ? 'public, max-age=86400' : 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    // PDFs viewed inside the review page (?frame=1) can't be sandboxed (browsers refuse to show a PDF in a sandbox); still no scripts or other content.
    'Content-Security-Policy': row.mime === 'application/pdf' && !row.is_public && new URL(request.url).searchParams.get('frame') === '1' ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${row.mime === 'application/pdf' && new URL(request.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${(row.name || row.id).replace(/[^\w.-]+/g, '-').replace(/\.[a-z0-9]+$/i, '')}.${ext}"`,
    'X-Robots-Tag': 'noindex',
  } });
}
