import { liveBySlug, streamObject, friendlyPdfName, logEvent } from '../../_lib/programme.js';
import { requireFan } from '../../_lib/fanCode.js';
import { rateLimit } from '../../_lib/fans.js';

// GET /api/programme/:slug/download -- the PDF, registered fans only (20 an hour each).
export async function onRequestGet({ request, env, params }) {
  const { fan, denied } = await requireFan(request, env);
  if (denied) return denied;
  const p = await liveBySlug(env.DB, params.slug).catch(() => null);
  if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
  if (!(await rateLimit(env.DB, `progdl:${fan.id}`, 20, 3600))) {
    return Response.json({ error: 'You have downloaded this a lot in the last hour. Please try again later.' }, { status: 429 });
  }
  await logEvent(env.DB, { programmeId: p.id, fanId: fan.id, type: 'download' });
  return streamObject(env, p.pdf_key, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${friendlyPdfName(p)}"`,
    'Cache-Control': 'private, no-store',
  });
}
