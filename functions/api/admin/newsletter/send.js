import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureNewsletterSchema, parseIssue, renderNewsletter, renderText, loadSponsors, nextMatch, SITE, newsletterSettings, recipients } from '../../_lib/newsletter.js';
import { fromAddress, replyTo, resendBatch, sendMode, sendIssueBatches } from '../../_lib/newsletterSend.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 864e5;

// POST /api/admin/newsletter/send
//   { id, test: "you@example.com, other@example.com" }  a test copy (subject starts [TEST])
//   { id, confirm: true }    send to all subscribers now (call again while "remaining" > 0)
//   { id, schedule: ISO }    send automatically at that date and time (5 minutes to 60 days ahead)
//   { id, unschedule: true } cancel the schedule (back to draft)
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureNewsletterSchema(db);
  const b = await request.json().catch(() => ({}));
  const issue = parseIssue(await db.prepare(`SELECT * FROM newsletter_issues WHERE id = ?`).bind(String(b.id || '')).first());
  if (!issue) return json({ error: 'Newsletter not found. Save it first.' }, 404);

  if (b.unschedule) {
    const r = await db.prepare(`UPDATE newsletter_issues SET status = 'draft', scheduled_at = NULL, scheduled_by = NULL WHERE id = ? AND status = 'scheduled'`).bind(issue.id).run();
    if (!r.meta.changes) return json({ error: 'This newsletter is not scheduled (it may already be sending).' }, 409);
    await logAdminAction(db, admin, 'newsletter_unschedule', issue.subject);
    return json({ ok: true, status: 'draft' });
  }

  const { live, testMode } = sendMode(env);
  if (!live && !testMode) return json({ error: 'The email service (Resend) is not set up yet, so newsletters cannot be sent. See the staff guide, section 24.' }, 503);

  // "Selected people": at least one of them must be able to receive it.
  const noneSelected = async () => Array.isArray(issue.audience) && !(await recipients(db, null, 1, issue.audience)).length;
  if ((b.schedule || (b.confirm && issue.status !== 'sending')) && await noneSelected()) return json({ error: 'None of the selected people can receive the newsletter (pick at least one subscriber, or choose All subscribers).' }, 400);

  if (b.schedule) {
    const at = Date.parse(String(b.schedule));
    if (!Number.isFinite(at)) return json({ error: 'Choose a date and time to send it.' }, 400);
    if (at < Date.now() + 5 * 60000) return json({ error: 'Choose a time at least 5 minutes from now (or use Send now).' }, 400);
    if (at > Date.now() + 60 * DAY) return json({ error: 'Choose a time within the next 60 days.' }, 400);
    if (issue.status !== 'draft' && issue.status !== 'scheduled') return json({ error: 'This newsletter has already been sent.' }, 409);
    const iso = new Date(at).toISOString();
    await db.prepare(`UPDATE newsletter_issues SET status = 'scheduled', scheduled_at = ?, scheduled_by = ? WHERE id = ? AND status IN ('draft', 'scheduled')`).bind(iso, admin.name, issue.id).run();
    const when = new Date(at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    await logAdminAction(db, admin, 'newsletter_schedule', `${issue.subject} for ${when}`);
    return json({ ok: true, status: 'scheduled', scheduledAt: iso });
  }

  if (b.test) {
    const sponsors = await loadSponsors(db);
    const match = issue.include_match ? await nextMatch(db) : null;
    const settings = await newsletterSettings(db);
    const to = String(b.test).split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!to.length || to.length > 5 || !to.every(e => EMAIL.test(e))) return json({ error: 'Type up to 5 valid email addresses for the test.' }, 400);
    const recipient = { firstName: (admin.name || '').split(' ')[0] || '', unsubscribeUrl: `${SITE}/newsletter/`, optionsUrl: `${SITE}/newsletter/` };
    const html = renderNewsletter({ issue, sponsors, match, recipient, settings });
    if (live) await resendBatch(env, to.map(e => ({ from: fromAddress(env), reply_to: replyTo(env), to: e, subject: `[TEST] ${issue.subject}`, html, text: renderText({ issue, sponsors, match, recipient }) })));
    await logAdminAction(db, admin, 'newsletter_test', `${issue.subject} to ${to.join(', ')}`);
    return json({ ok: true, sentTo: to, testMode });
  }

  if (!b.confirm) return json({ error: 'Please confirm sending to all subscribers.' }, 400);
  if (issue.status === 'sent') return json({ error: 'This newsletter has already been sent.' }, 409);
  if (issue.status === 'sending' && issue.scheduled_at) return json({ error: 'The scheduler is sending this newsletter now. Refresh in a minute to see the result.' }, 409);
  if (issue.status === 'scheduled') {
    // "Send now" on a scheduled newsletter: the schedule is cancelled and it goes out now.
    await db.prepare(`UPDATE newsletter_issues SET status = 'draft', scheduled_at = NULL, scheduled_by = NULL WHERE id = ? AND status = 'scheduled'`).bind(issue.id).run();
    Object.assign(issue, { status: 'draft', scheduled_at: null });
  }
  const starting = issue.status === 'draft';
  const r = await sendIssueBatches(env, issue, admin.name);
  if (r.busy) return json({ error: 'This newsletter is already being sent.' }, 409);
  if (starting) await logAdminAction(db, admin, 'newsletter_send_start', issue.subject);
  if (!r.remaining) await logAdminAction(db, admin, 'newsletter_sent', `${issue.subject}: ${r.total} sent${r.failedTotal ? `, ${r.failedTotal} failed` : ''}`);
  return json({ ok: true, sent: r.sent, failed: r.failed, remaining: r.remaining, total: r.total, testMode: r.testMode, webUrl: r.webUrl });
}
