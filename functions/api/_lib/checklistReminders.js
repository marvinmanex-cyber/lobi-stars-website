// Match Checklist daily reminders: ONE digest email per recipient per day,
// at the reminder time (Africa/Lagos), listing the outstanding tasks of every
// open checklist (Overdue / Due today / Due in the next 3 days). Nothing is sent
// when nothing is outstanding. Never twice a day: the day is claimed in
// checklist_settings.last_sent_date and every recipient in checklist_reminder_log.
// Super Admins also get a "Broken task links" note when a task link no longer works.
import { getSettings, saveSetting, loadChecklist, tasksToRemind, digestSections, digestSubject, reminderRecipients,
  routeExists, lagosDay, lagosHHMM, ensureChecklistSchema, EMAIL_RE } from './matchChecklist.js';
import { digestEmail, siteBase } from './checklistOutput.js';
import { withName, DEFAULT_FROM } from './email.js';

/** Task links that don't work: unknown admin page, missing match values, or a bad external address. */
export function brokenLinks(checklists) {
  const out = [];
  for (const c of checklists) for (const t of c.tasks) {
    const where = `${c.match.home} vs ${c.match.away}: ${t.title}`;
    if (t.link_type === 'internal' && !routeExists(t.link_route)) out.push(`${where} (page not found: ${String(t.link_route || '').split(/[?#]/)[0] || 'none'})`);
    else if (t.link_type === 'internal' && t.link?.broken) out.push(`${where} (no ${t.link.missing.join(', ')} for this match)`);
    else if (t.link_type === 'external' && !t.link) out.push(`${where} (external address must start with https://)`);
  }
  return out;
}

/** The digest for everyone, or a preview (dryRun). force: ignore the time of day and "already sent today". */
export async function runReminders(env, { now = Date.now(), dryRun = false, force = false } = {}) {
  const db = env.DB;
  await ensureChecklistSchema(db);
  const s = await getSettings(db);
  const today = lagosDay(now);
  if (!force) {
    if (!s.remindersEnabled) return { skipped: 'Reminders are switched off.' };
    if (s.lastSentDate === today) return { skipped: `Already sent today (${today}).` };
    if (lagosHHMM(now) < s.reminderSendTime) return { skipped: `Not yet ${s.reminderSendTime} in Lagos.` };
  }
  const base = siteBase(env);
  const ids = (await db.prepare(`SELECT id FROM match_checklists WHERE status IN ('active', 'awaiting_closeout') ORDER BY kickoff_at`).all()).results.map(r => r.id);
  const checklists = [];
  for (const id of ids) { const c = await loadChecklist(db, id, now, { env, base }); if (c) checklists.push(c); }
  const items = checklists.map(c => ({ checklist: c, sections: digestSections(tasksToRemind(c, s, now), now) }))
    .filter(x => x.sections.overdue.length + x.sections.today.length + x.sections.soon.length > 0);
  const count = items.reduce((n, x) => n + x.sections.overdue.length + x.sections.today.length + x.sections.soon.length, 0);
  if (!items.length) {
    // No digest today, but broken task links are still reported to the Super Admins (once a day).
    const brokenToday = brokenLinks(checklists);
    let brokenSent = false;
    if (!dryRun && brokenToday.length && env.RESEND_API_KEY) {
      const supers = (await db.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role = 'super_admin'`).all()).results.map(r => String(r.email || '').toLowerCase()).filter(e => EMAIL_RE.test(e));
      if (supers.length) {
        try {
          const { sendEmail } = await import('./email.js');
          await sendEmail(env, { to: supers, subject: `Match checklist: ${brokenToday.length} broken task link${brokenToday.length === 1 ? '' : 's'}`,
            html: `<p>These "Go to task" links don't work. Fix them on Match Checklist › Templates:</p><ul>${brokenToday.map(b => `<li>${String(b).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</li>`).join('')}</ul><p><a href="${base}/admin/match-checklist/templates/">Open Templates</a></p>` });
          brokenSent = true;
        } catch (err) { console.error('[checklist] broken links email', err); }
      }
    }
    if (!dryRun) await saveSetting(db, 'last_sent_date', today, 'Automatic');
    return { sent: [], skipped: 'Nothing outstanding: no email sent.', count: 0, brokenLinks: brokenToday, brokenSent };
  }
  const recipients = await reminderRecipients(env, s, checklists);
  const supers = new Set((await db.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role = 'super_admin'`).all()).results.map(r => String(r.email || '').toLowerCase()));
  const broken = brokenLinks(checklists);
  const subject = digestSubject(items[0].checklist, count, now);
  const plan = recipients.map(to => ({ to, broken: supers.has(to) ? broken : [] }));

  if (dryRun) {
    return {
      dryRun: true, subject, count,
      checklists: items.map(x => ({ match: `${x.checklist.match.home} vs ${x.checklist.match.away}`, overdue: x.sections.overdue.map(t => t.title), today: x.sections.today.map(t => t.title), soon: x.sections.soon.map(t => t.title) })),
      recipients: plan.map(p => ({ to: p.to, brokenLinks: p.broken.length })), brokenLinks: broken,
    };
  }

  // Claim the day once (a second run the same day stops here).
  if (!force) {
    await db.prepare(`INSERT OR IGNORE INTO checklist_settings (key, value, updated_at, updated_by) VALUES ('last_sent_date', '', ?, 'Automatic')`).bind(new Date(now).toISOString()).run();
    const claim = await db.prepare(`UPDATE checklist_settings SET value = ?, updated_at = ?, updated_by = 'Automatic' WHERE key = 'last_sent_date' AND COALESCE(value, '') != ?`).bind(today, new Date(now).toISOString(), today).run();
    if (!claim.meta?.changes) return { skipped: `Already sent today (${today}).` };
  }
  // Each recipient at most once a day.
  const fresh = [], already = [];
  for (const p of plan) {
    const r = await db.prepare(`INSERT OR IGNORE INTO checklist_reminder_log (day, email, sent_at, tasks, ok) VALUES (?, ?, ?, ?, 0)`).bind(today, p.to, new Date(now).toISOString(), count).run();
    (r.meta?.changes ? fresh : already).push(p);
  }
  if (!fresh.length) return { sent: [], skipped: 'Everyone already had today\'s reminder.', already: already.map(p => p.to) };
  if (!env.RESEND_API_KEY) {
    await markResult(db, today, fresh.map(p => p.to), false, 'RESEND_API_KEY not set');
    return { sent: [], failed: fresh.map(p => p.to), error: 'Email is not set up (RESEND_API_KEY).' };
  }
  const from = withName(env.RESEND_FROM || DEFAULT_FROM);
  const emails = fresh.map(p => ({ from, to: [p.to], subject, html: digestEmail(items, { base, subject, brokenLinks: p.broken }).html, reply_to: env.REPLY_TO_EMAIL || 'info@lobistarsfc.com' }));
  const sent = [], failed = [];
  // Resend's batch endpoint: up to 100 emails in one request.
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    try {
      const res = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      sent.push(...chunk.map(e => e.to[0]));
    } catch (err) {
      console.error('[checklist] reminder batch failed', err);
      failed.push(...chunk.map(e => e.to[0]));
      await markResult(db, today, chunk.map(e => e.to[0]), false, String(err.message || err).slice(0, 300));
    }
  }
  if (sent.length) await markResult(db, today, sent, true, null);
  return { sent, failed, already: already.map(p => p.to), subject, count };
}
async function markResult(db, day, emails, ok, error) {
  for (let i = 0; i < emails.length; i += 50) {
    await db.batch(emails.slice(i, i + 50).map(e => db.prepare(`UPDATE checklist_reminder_log SET ok = ?, error = ? WHERE day = ? AND email = ?`).bind(ok ? 1 : 0, error, day, e)));
  }
}

/** Settings › "Send a test reminder": today's digest (or a short note) to one address, marked TEST, not counted. */
export async function sendTestReminder(env, to, { now = Date.now() } = {}) {
  if (!EMAIL_RE.test(String(to || ''))) return { error: 'Your account has no valid email address.' };
  if (!env.RESEND_API_KEY) return { error: 'Email is not set up (RESEND_API_KEY).' };
  const preview = await runReminders(env, { now, dryRun: true, force: true });
  const db = env.DB, base = siteBase(env);
  const ids = (await db.prepare(`SELECT id FROM match_checklists WHERE status IN ('active', 'awaiting_closeout') ORDER BY kickoff_at`).all()).results.map(r => r.id);
  const s = await getSettings(db);
  const items = [];
  for (const id of ids) {
    const c = await loadChecklist(db, id, now, { env, base });
    if (!c) continue;
    const sections = digestSections(tasksToRemind(c, s, now), now);
    if (sections.overdue.length + sections.today.length + sections.soon.length) items.push({ checklist: c, sections });
  }
  const { sendEmail } = await import('./email.js');
  if (!items.length) {
    await sendEmail(env, { to: [to], subject: '[TEST] Match checklist reminder', html: '<p>This is a test of the Match Checklist reminder. Nothing is outstanding right now, so the real daily email would not be sent today.</p>' });
    return { ok: true, nothingOutstanding: true };
  }
  const subject = `[TEST] ${preview.subject || digestSubject(items[0].checklist, 0, now)}`;
  await sendEmail(env, { to: [to], subject, html: digestEmail(items, { base, subject, brokenLinks: preview.brokenLinks || [] }).html });
  return { ok: true, subject };
}
