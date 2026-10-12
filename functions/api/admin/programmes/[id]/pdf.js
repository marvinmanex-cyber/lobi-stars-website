import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { ensureProgrammeSchema, streamObject, friendlyPdfName } from '../../../_lib/programme.js';

// GET /api/admin/programmes/:id/pdf -- staff preview of the PDF (opens in the browser; not counted).
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureProgrammeSchema(env.DB);
  const p = await env.DB.prepare(`SELECT title, pdf_key FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
  if (!p) return new Response('Not found', { status: 404 });
  return streamObject(env, p.pdf_key, {
    'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${friendlyPdfName(p)}"`, 'Cache-Control': 'private, no-store',
  });
}
