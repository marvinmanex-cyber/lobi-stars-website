import { guard, json, SUPER_ONLY } from '../../_lib/checklistApi.js';
import { getSettings, saveSetting, parseEmails, EMAIL_RE } from '../../_lib/matchChecklist.js';
import { sendTestReminder, runReminders } from '../../_lib/checklistReminders.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Match Checklist reminder settings (Super Admins only, also for reading).
// GET                                   -- the settings and today's reminder preview (who would get what)
// PUT { reminderSendTime, reminderDaysBefore, postMatchReminderDays, recipientMode, extraRecipientEmails, remindersEnabled }
// POST { action: 'test' }               -- send a test reminder to me
export async function onRequestGet({ request, env }) {
  const { superAdmin, denied } = await guard(request, env);
  if (denied) return denied;
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const s = await getSettings(env.DB);
  const preview = await runReminders(env, { dryRun: true, force: true });
  return json({ settings: s, preview, emailReady: !!env.RESEND_API_KEY });
}

export async function onRequestPut({ request, env }) {
  const { admin, superAdmin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const b = await request.json().catch(() => ({}));
  const time = String(b.reminderSendTime || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({ error: 'Reminder time must be HH:MM (24-hour, Lagos time), e.g. 08:00.' }, 400);
  const days = Number(b.reminderDaysBefore), post = Number(b.postMatchReminderDays);
  if (!Number.isInteger(days) || days < 0 || days > 30) return json({ error: 'Days before the match: a whole number from 0 to 30.' }, 400);
  if (!Number.isInteger(post) || post < 0 || post > 30) return json({ error: 'Days after the match: a whole number from 0 to 30.' }, 400);
  const extras = parseEmails(b.extraRecipientEmails);
  const bad = extras.filter(e => !EMAIL_RE.test(e));
  if (bad.length) return json({ error: `Not a valid email address: ${bad.join(', ')}` }, 400);
  const mode = b.recipientMode === 'owners_plus_super_admins' ? 'owners_plus_super_admins' : 'all_admins';
  const vals = { reminder_send_time: time, reminder_days_before: days, post_match_reminder_days: post, recipient_mode: mode, extra_recipient_emails: extras.join(', '), reminders_enabled: b.remindersEnabled === false ? '0' : '1' };
  for (const [k, v] of Object.entries(vals)) await saveSetting(env.DB, k, v, admin.name);
  await logAdminAction(env.DB, admin, 'checklist_settings', `Match checklist reminders: ${vals.reminders_enabled === '1' ? `on at ${time}` : 'off'}, ${days} days before, ${post} days after, ${mode}${extras.length ? `, +${extras.length} extra` : ''}`);
  return json({ ok: true, settings: await getSettings(env.DB) });
}

export async function onRequestPost({ request, env }) {
  const { admin, superAdmin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  if (!superAdmin) return json({ error: SUPER_ONLY }, 403);
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'test') return json({ error: 'Unknown action' }, 400);
  try {
    const r = await sendTestReminder(env, admin.email);
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, to: admin.email, ...r });
  } catch (err) {
    console.error('[checklist] test reminder', err);
    return json({ error: 'The test email could not be sent.' }, 502);
  }
}
