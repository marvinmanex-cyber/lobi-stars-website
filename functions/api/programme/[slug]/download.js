import { liveBySlug, streamObject, friendlyPdfName, logEvent } from '../../_lib/programme.js';
import { requireFan } from '../../_lib/fanCode.js';
import { rateLimit } from '../../_lib/fans.js';
import { validSrc, logCampaignEvent } from '../../_lib/qr.js';

// GET /api/programme/:slug/download?src=<campaign> -- the PDF, registered fans only (20 an hour each).
// A plain link works (the scan page navigates here), so it also works in in-app browsers.
export async function onRequestGet({ request, env, params, waitUntil }) {
  const url = new URL(request.url);
  const src = validSrc(url.searchParams.get('src'));
  // Opened as a page (scan page, email): problems go back to the scan page with a message, not raw JSON.
  const page = /text\/html/.test(request.headers.get('Accept') || '');
  const back = why => new Response(null, { status: 302, headers: { Location: new URL(`/programme/scan/?${src ? `c=${src}&` : ''}e=${why}`, url).href, 'Cache-Control': 'no-store' } });
  const { fan, denied } = await requireFan(request, env);
  if (denied) return page ? back('signin') : denied;
  const p = await liveBySlug(env.DB, params.slug).catch(() => null);
  if (!p) return page ? back('gone') : Response.json({ error: 'Programme not found' }, { status: 404 });
  if (!(await rateLimit(env.DB, `progdl:${fan.id}`, 20, 3600))) {
    return page ? back('limit') : Response.json({ error: 'You have downloaded this a lot in the last hour. Please try again later.' }, { status: 429 });
  }
  await logEvent(env.DB, { programmeId: p.id, fanId: fan.id, type: 'download', src });
  if (src) logCampaignEvent(env, src, 'download', { request, fanId: fan.id, programmeId: p.id }, waitUntil);
  return streamObject(env, p.pdf_key, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${friendlyPdfName(p)}"`,
    'Cache-Control': 'private, no-store',
  });
}
