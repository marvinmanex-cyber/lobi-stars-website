import { requireAdminUser } from '../../_lib/adminEvents.js';
import { buildReport, renderPartnerReport, monthRange, previousMonth, clubContactEmail } from '../../_lib/partnerReport.js';

// GET /api/admin/partner-reports/view?slug=&month= -- one partner's report as a
// page (exactly what the email looks like), with "Print or save as PDF".
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const month = monthRange(url.searchParams.get('month')) ? url.searchParams.get('month') : previousMonth();
    const report = await buildReport(env, url.origin, month);
    const p = report.partners.find(x => x.slug === url.searchParams.get('slug'));
    if (!p) return new Response('Partner not found', { status: 404 });
    const { html } = renderPartnerReport(report, p, { contactEmail: await clubContactEmail(env, url.origin), web: true });
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  } catch (err) {
    console.error('[partner report] view', err);
    return new Response('Could not build the report.', { status: 500 });
  }
}
