import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { unsubscribeUrl } from '../../_lib/contacts.js';
import { ensureNewsletterSchema, parseIssue, renderNewsletter, renderText, loadSponsors, nextMatch, recipients, slugFor, SITE, newsletterSettings } from '../../_lib/newsletter.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Resend takes up to 100 emails per call; a few calls per request keeps well
// inside Cloudflare's limits. The admin page keeps calling until all are sent.
const BATCH = 100, PER_REQUEST = 8;

async function resendBatch(env, emails) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(emails),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
const fromAddress = env => env.NEWSLETTER_FROM || env.RESEND_FROM || 'Lobi Stars FC <info@lobistarsfc.com>';

// POST /api/admin/newsletter/send
//   { id, test: "you@example.com, other@example.com" }  a test copy (subject starts [TEST])
//   { id, confirm: true }    send to all subscribers (call again while "remaining" > 0)
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureNewsletterSchema(db);
  const b = await request.json().catch(() => ({}));
  const issue = parseIssue(await db.prepare(`SELECT * FROM newsletter_issues WHERE id = ?`).bind(String(b.id || '')).first());
  if (!issue) return json({ error: 'Newsletter not found. Save it first.' }, 404);
  const live = !!env.RESEND_API_KEY;
  const testMode = !live && String(env.FANS_DEV_LINKS) === '1';
  if (!live && !testMode) return json({ error: 'The email service (Resend) is not set up yet, so newsletters cannot be sent. See the staff guide, section 24.' }, 503);
  const sponsors = await loadSponsors(db);
  const match = issue.include_match ? await nextMatch(db) : null;
  const settings = await newsletterSettings(db);

  if (b.test) {
    const to = String(b.test).split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!to.length || to.length > 5 || !to.every(e => EMAIL.test(e))) return json({ error: 'Type up to 5 valid email addresses for the test.' }, 400);
    const recipient = { firstName: (admin.name || '').split(' ')[0] || '', unsubscribeUrl: `${SITE}/newsletter/`, optionsUrl: `${SITE}/newsletter/` };
    const html = renderNewsletter({ issue, sponsors, match, recipient, settings });
    if (live) await resendBatch(env, to.map(e => ({ from: fromAddress(env), to: e, subject: `[TEST] ${issue.subject}`, html, text: renderText({ issue, sponsors, match, recipient }) })));
    await logAdminAction(db, admin, 'newsletter_test', `${issue.subject} to ${to.join(', ')}`);
    return json({ ok: true, sentTo: to, testMode });
  }

  if (!b.confirm) return json({ error: 'Please confirm sending to all subscribers.' }, 400);
  if (issue.status === 'sent') return json({ error: 'This newsletter has already been sent.' }, 409);
  if (issue.status === 'draft') {
    // First call: freeze the issue, give it its web address and save the web version.
    let slug = slugFor(issue.subject);
    if (await db.prepare(`SELECT 1 FROM newsletter_issues WHERE slug = ?`).bind(slug).first()) slug = `${slug}-${issue.id.slice(-4).toLowerCase()}`;
    const sentAt = new Date().toISOString();
    const frozen = { ...issue, slug, status: 'sent', sent_at: sentAt };
    const web = renderNewsletter({ issue: frozen, sponsors, match, web: true, settings });
    await db.prepare(`UPDATE newsletter_issues SET status = 'sending', slug = ?, sent_at = ?, sent_by = ?, html_snapshot = ? WHERE id = ? AND status = 'draft'`).bind(slug, sentAt, admin.name, web, issue.id).run();
    Object.assign(issue, { slug, sent_at: sentAt, status: 'sending' });
    await logAdminAction(db, admin, 'newsletter_send_start', issue.subject);
  }
  const final = { ...issue, status: 'sent' }; // links in the emails point to the sent version
  const list = await recipients(db, issue.id, BATCH * PER_REQUEST);
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const emails = chunk.map(r => {
      const unsub = r.unsub_token ? unsubscribeUrl(r) : `${SITE}/newsletter/`;
      const recipient = { firstName: r.first_name || '', unsubscribeUrl: unsub, optionsUrl: r.unsub_token ? `${SITE}/newsletter/?t=${r.unsub_token}` : `${SITE}/newsletter/` };
      return { from: fromAddress(env), to: r.email, subject: issue.subject, html: renderNewsletter({ issue: final, sponsors, match, recipient, settings }), text: renderText({ issue: final, sponsors, match, recipient }), headers: { 'List-Unsubscribe': `<${unsub}>` } };
    });
    let status = testMode ? 'dev' : 'sent';
    if (live) { try { await resendBatch(env, emails); } catch (err) { console.log('[newsletter]', err.message); status = 'failed'; } }
    const at = new Date().toISOString();
    await db.batch(chunk.map(r => db.prepare(`INSERT OR IGNORE INTO newsletter_deliveries (issue_id, email, status, at) VALUES (?, ?, ?, ?)`).bind(issue.id, r.email, status, at)));
    if (status === 'failed') failed += chunk.length; else sent += chunk.length;
  }
  const remaining = (await recipients(db, issue.id)).length;
  const totals = await db.prepare(`SELECT SUM(status != 'failed') AS ok, SUM(status = 'failed') AS bad FROM newsletter_deliveries WHERE issue_id = ?`).bind(issue.id).first();
  await db.prepare(`UPDATE newsletter_issues SET sent_count = ?, failed_count = ?, status = CASE WHEN ? = 0 THEN 'sent' ELSE status END WHERE id = ?`)
    .bind(totals.ok || 0, totals.bad || 0, remaining, issue.id).run();
  if (!remaining) await logAdminAction(db, admin, 'newsletter_sent', `${issue.subject}: ${totals.ok || 0} sent${totals.bad ? `, ${totals.bad} failed` : ''}`);
  return json({ ok: true, sent, failed, remaining, total: totals.ok || 0, testMode, webUrl: `${SITE}/newsletter/${issue.slug}/` });
}
