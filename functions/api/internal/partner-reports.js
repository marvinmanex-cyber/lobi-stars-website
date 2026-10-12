import { ensurePartnerReportSchema, sendPartnerReports, previousMonth, dayOfMonthWAT, clubContactEmail } from '../_lib/partnerReport.js';

// POST /api/internal/partner-reports -- called every minute by the cron Worker
// ("Authorization: Bearer <CRON_SECRET>"). When automatic sending is on and
// email is set up, from the 2nd of the month it sends last month's report to
// every partner with an address, once (already-sent partners are skipped).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const db = env.DB;
    await ensurePartnerReportSchema(db);
    const auto = (await db.prepare(`SELECT value FROM partner_report_settings WHERE key = 'auto_send'`).first())?.value === 'true';
    if (!auto || !env.RESEND_API_KEY || dayOfMonthWAT() < 2) return Response.json({ ok: true, ran: false });
    const month = previousMonth();
    // Check at most once an hour (the cron calls every minute).
    const now = Date.now();
    const claim = await db.prepare(`INSERT INTO partner_report_settings (key, value) VALUES ('last_auto_check', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value
        WHERE CAST(partner_report_settings.value AS INTEGER) < ?`).bind(String(now), now - 3600e3).run();
    if (!claim.meta?.changes) return Response.json({ ok: true, ran: false });
    const origin = new URL(request.url).origin;
    const r = await sendPartnerReports(env, origin, month, { contactEmail: await clubContactEmail(env, origin) });
    return Response.json({ ok: true, ran: true, ...r });
  } catch (err) {
    console.error('[partner report] auto', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
