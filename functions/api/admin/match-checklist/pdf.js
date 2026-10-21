import { guard, json } from '../../_lib/checklistApi.js';
import { loadChecklist } from '../../_lib/matchChecklist.js';
import { checklistPdf, pdfFilename, siteBase } from '../../_lib/checklistOutput.js';

// GET /api/admin/match-checklist/pdf?id=<id>&mode=report|print
// The checklist as a PDF made on the server (club badge, headline, progress,
// the three sections). mode=print: empty tick boxes for matchday, with each
// task's link as a short address.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  const c = await loadChecklist(env.DB, Number(u.searchParams.get('id')), Date.now(), { env, base: siteBase(env) });
  if (!c) return json({ error: 'Checklist not found' }, 404);
  const pdf = checklistPdf(c, { mode: u.searchParams.get('mode') === 'print' ? 'print' : 'report', generatedBy: admin.name, base: siteBase(env), logo: await logoJpeg(env, request) });
  return new Response(pdf, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${u.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${pdfFilename(c).replace(/\.pdf$/, u.searchParams.get('mode') === 'print' ? '-print.pdf' : '.pdf')}"`,
    'Cache-Control': 'private, no-store',
  } });
}

/** The club badge (JPEG) from the site's own files; the PDF is made without it if unavailable. */
export async function logoJpeg(env, request) {
  try {
    const r = await env.ASSETS.fetch(new URL('/images/lobi-stars-badge-print.jpg', request.url));
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { return null; }
}
