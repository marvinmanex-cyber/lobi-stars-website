import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import {
  ensurePartnerReportSchema, buildReport, previousMonth, monthRange, cleanEmails, sendPartnerReports, clubContactEmail,
} from '../../_lib/partnerReport.js';

// GET  /api/admin/partner-reports?month=YYYY-MM -- each partner's numbers for the
//      month, their report email addresses, what was sent, and the auto-send switch
// POST /api/admin/partner-reports
//      { contacts: { slug, emails, enabled } }     -- who receives a partner's report
//      { send: { month, slugs?, force? } }         -- send now (needs email set up)
//      { settings: { autoSend } }                  -- send last month's reports on the 2nd automatically
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensurePartnerReportSchema(db);
    const url = new URL(request.url);
    const month = monthRange(url.searchParams.get('month')) ? url.searchParams.get('month') : previousMonth();
    const report = await buildReport(env, url.origin, month);
    const [contacts, sends, settings] = await db.batch([
      db.prepare(`SELECT * FROM partner_report_contacts`),
      db.prepare(`SELECT partner_slug, month, status, recipients, error, sent_by, sent_at FROM partner_report_sends ORDER BY id DESC LIMIT 100`),
      db.prepare(`SELECT key, value FROM partner_report_settings`),
    ]);
    const s = Object.fromEntries(settings.results.map(r => [r.key, r.value]));
    return Response.json({
      report, contacts: contacts.results, sends: sends.results,
      autoSend: s.auto_send === 'true', emailReady: !!env.RESEND_API_KEY, cron: !!env.CRON_SECRET,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[partner report]', err);
    return Response.json({ error: err.message?.startsWith('Choose') ? err.message : 'Could not build the reports.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensurePartnerReportSchema(db);
    const b = await request.json().catch(() => ({}));
    const origin = new URL(request.url).origin;

    if (b.contacts) {
      const slug = String(b.contacts.slug || '');
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ error: 'Unknown partner.' }, { status: 400 });
      const raw = String(b.contacts.emails || '');
      const emails = cleanEmails(raw);
      const typed = raw.split(/[,;\s]+/).filter(Boolean).length;
      if (typed && emails.length < typed) return Response.json({ error: 'One of the email addresses is not valid.' }, { status: 400 });
      await db.prepare(`INSERT INTO partner_report_contacts (partner_slug, emails, enabled, updated_at, updated_by) VALUES (?, ?, ?, datetime('now'), ?)
          ON CONFLICT (partner_slug) DO UPDATE SET emails = excluded.emails, enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(slug, emails.join(', '), b.contacts.enabled === false ? 0 : 1, admin.name).run();
      await logAdminAction(db, admin, 'partner_report_contacts', `${slug}: ${emails.length} address${emails.length === 1 ? '' : 'es'}`);
      return Response.json({ ok: true, emails });
    }

    if (b.send) {
      const month = String(b.send.month || '');
      if (!monthRange(month)) return Response.json({ error: 'Choose a month.' }, { status: 400 });
      const slugs = Array.isArray(b.send.slugs) && b.send.slugs.length ? b.send.slugs.map(String) : null;
      try {
        const r = await sendPartnerReports(env, origin, month, { slugs, force: b.send.force === true, by: admin.name, contactEmail: await clubContactEmail(env, origin) });
        await logAdminAction(db, admin, 'partner_report_send', `${r.label}: ${r.results.map(x => `${x.slug} ${x.ok ? (x.skipped ? 'already sent' : 'sent') : 'failed'}`).join(', ') || 'nobody to send to'}`);
        return Response.json({ ok: true, ...r });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 409 });
      }
    }

    if (b.settings) {
      const v = b.settings.autoSend === true ? 'true' : 'false';
      await db.prepare(`INSERT INTO partner_report_settings (key, value, updated_at, updated_by) VALUES ('auto_send', ?, datetime('now'), ?)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(v, admin.name).run();
      await logAdminAction(db, admin, 'partner_report_settings', `automatic monthly send ${v === 'true' ? 'on' : 'off'}`);
      return Response.json({ ok: true, autoSend: v === 'true' });
    }
    return Response.json({ error: 'Nothing to do.' }, { status: 400 });
  } catch (err) {
    console.error('[partner report] post', err);
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
