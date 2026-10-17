// Sending a newsletter, shared by "Send now" (the admin page keeps calling
// until everyone has it) and the scheduler (a newsletter set to go out at a
// date and time: sent by the timer Worker every minute, or by site traffic
// until that Worker is deployed). Each address gets one copy: deliveries are
// recorded per issue and address, and only one sender works on an issue at a time.
import { unsubscribeUrl } from './contacts.js';
import { DEFAULT_FROM, withName } from './email.js';
import { logAdminAction } from './adminSession.js';
import { ensureNewsletterSchema, parseIssue, renderNewsletter, renderText, loadSponsors, nextMatch, recipients, slugFor, SITE, newsletterSettings } from './newsletter.js';

// Resend takes up to 100 emails per call; a few calls per request keeps well inside Cloudflare's limits.
export const BATCH = 100, PER_REQUEST = 8;

export const fromAddress = env => withName(env.NEWSLETTER_FROM || env.RESEND_FROM || DEFAULT_FROM);
// Replies to the newsletter reach the club's main inbox.
export const replyTo = env => env.REPLY_TO_EMAIL || 'info@lobistarsfc.com';

export async function resendBatch(env, emails) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(emails),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Can newsletters be sent here? { live, testMode } (test mode: local copy, records who would get it). */
export const sendMode = env => {
  const live = !!env.RESEND_API_KEY;
  return { live, testMode: !live && String(env.FANS_DEV_LINKS) === '1' };
};

/**
 * Sends the next batches of one issue (freezing it on the first call).
 * `by`: staff name (or "Scheduler"). Returns { sent, failed, remaining, total, testMode, webUrl }.
 */
export async function sendIssueBatches(env, issue, by) {
  const db = env.DB;
  const { live, testMode } = sendMode(env);
  const sponsors = await loadSponsors(db);
  const match = issue.include_match ? await nextMatch(db) : null;
  const settings = await newsletterSettings(db);
  if (issue.status === 'draft' || issue.status === 'scheduled') {
    // First call: freeze the issue, give it its web address and save the web version.
    let slug = slugFor(issue.subject);
    if (await db.prepare(`SELECT 1 FROM newsletter_issues WHERE slug = ?`).bind(slug).first()) slug = `${slug}-${issue.id.slice(-4).toLowerCase()}`;
    const sentAt = new Date().toISOString();
    const frozen = { ...issue, slug, status: 'sent', sent_at: sentAt };
    const web = renderNewsletter({ issue: frozen, sponsors, match, web: true, settings });
    const claim = await db.prepare(`UPDATE newsletter_issues SET status = 'sending', slug = ?, sent_at = ?, sent_by = ?, html_snapshot = ? WHERE id = ? AND status = ?`)
      .bind(slug, sentAt, by, web, issue.id, issue.status).run();
    if (!claim.meta.changes) return { sent: 0, failed: 0, remaining: 0, total: issue.sent_count || 0, testMode, busy: true };
    Object.assign(issue, { slug, sent_at: sentAt, status: 'sending' });
  }
  const final = { ...issue, status: 'sent' }; // links in the emails point to the sent version
  const list = await recipients(db, issue.id, BATCH * PER_REQUEST, issue.audience);
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const emails = chunk.map(r => {
      const unsub = r.unsub_token ? unsubscribeUrl(r) : `${SITE}/newsletter/`;
      const recipient = { firstName: r.first_name || '', unsubscribeUrl: unsub, optionsUrl: r.unsub_token ? `${SITE}/newsletter/?t=${r.unsub_token}` : `${SITE}/newsletter/` };
      return { from: fromAddress(env), reply_to: replyTo(env), to: r.email, subject: issue.subject, html: renderNewsletter({ issue: final, sponsors, match, recipient, settings }), text: renderText({ issue: final, sponsors, match, recipient }), headers: { 'List-Unsubscribe': `<${unsub}>` } };
    });
    let status = testMode ? 'dev' : 'sent';
    if (live) { try { await resendBatch(env, emails); } catch (err) { console.log('[newsletter]', err.message); status = 'failed'; } }
    const at = new Date().toISOString();
    await db.batch(chunk.map(r => db.prepare(`INSERT OR IGNORE INTO newsletter_deliveries (issue_id, email, status, at) VALUES (?, ?, ?, ?)`).bind(issue.id, r.email, status, at)));
    if (status === 'failed') failed += chunk.length; else sent += chunk.length;
  }
  const remaining = (await recipients(db, issue.id, 100000, issue.audience)).length;
  const totals = await db.prepare(`SELECT SUM(status != 'failed') AS ok, SUM(status = 'failed') AS bad FROM newsletter_deliveries WHERE issue_id = ?`).bind(issue.id).first();
  await db.prepare(`UPDATE newsletter_issues SET sent_count = ?, failed_count = ?, status = CASE WHEN ? = 0 THEN 'sent' ELSE status END WHERE id = ?`)
    .bind(totals.ok || 0, totals.bad || 0, remaining, issue.id).run();
  return { sent, failed, remaining, total: totals.ok || 0, failedTotal: totals.bad || 0, testMode, webUrl: `${SITE}/newsletter/${issue.slug}/` };
}

/**
 * The scheduler: sends scheduled newsletters whose time has come, and carries on
 * one that the scheduler started. One run at a time (a 2-minute lock). Never throws.
 * Returns { checked, sent } for the logs.
 */
export async function runScheduledNewsletters(env, now = Date.now()) {
  try {
    const db = env.DB;
    await ensureNewsletterSchema(db);
    const { live, testMode } = sendMode(env);
    if (!live && !testMode) return { checked: 0, sent: 0 };
    const nowIso = new Date(now).toISOString();
    const due = await db.prepare(`SELECT * FROM newsletter_issues WHERE scheduled_at IS NOT NULL AND ((status = 'scheduled' AND scheduled_at <= ?) OR status = 'sending') ORDER BY scheduled_at LIMIT 3`).bind(nowIso).all();
    if (!due.results.length) return { checked: 0, sent: 0 };
    // Lock: only one scheduler run works at a time.
    const lock = await db.prepare(`INSERT INTO newsletter_settings (key, value, updated_at) VALUES ('scheduler_lock', ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(newsletter_settings.value AS INTEGER) < ?`)
      .bind(String(now + 120000), nowIso, now).run();
    if (!lock.meta.changes) return { checked: due.results.length, sent: 0, busy: true };
    let sent = 0;
    try {
      for (const row of due.results) {
        const issue = parseIssue(row);
        const r = await sendIssueBatches(env, issue, row.scheduled_by ? `${row.scheduled_by} (scheduled)` : 'Scheduled');
        sent += r.sent;
        if (!r.remaining && !r.busy) {
          await logAdminAction(db, { id: 'scheduler', name: 'Scheduler' }, 'newsletter_sent', `${issue.subject}: ${r.total} sent${r.failedTotal ? `, ${r.failedTotal} failed` : ''} (scheduled by ${row.scheduled_by || 'staff'})`).catch(() => {});
        }
      }
    } finally {
      await db.prepare(`UPDATE newsletter_settings SET value = '0' WHERE key = 'scheduler_lock'`).run();
    }
    return { checked: due.results.length, sent };
  } catch (err) {
    console.error('[newsletter] scheduler', err);
    return { checked: 0, sent: 0, error: true };
  }
}

/** Light check from site traffic (until the timer Worker runs): at most once a minute. */
export async function maybeRunScheduledNewsletters(env) {
  try {
    const db = env.DB;
    await ensureNewsletterSchema(db);
    const now = Date.now();
    const claim = await db.prepare(`INSERT INTO newsletter_settings (key, value, updated_at) VALUES ('scheduler_last_check', ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(newsletter_settings.value AS INTEGER) < ?`)
      .bind(String(now), new Date(now).toISOString(), now - 60000).run();
    if (!claim.meta.changes) return null;
    return await runScheduledNewsletters(env, now);
  } catch { return null; }
}
