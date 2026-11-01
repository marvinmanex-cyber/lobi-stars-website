// Media Centre: the every-minute job (run from /api/internal/newsletter-run).
//  - publishes approved items whose scheduled time has come;
//  - Lobi Stars Weekly Newsletter reminders: Monday (from 09:00 Lagos) to the media team
//    if this week's newsletter has not been started; Tuesday evening (after
//    the deadline) to the Super Admins if one is waiting for approval. Each
//    reminder goes once a week (remembered in mc_settings);
//  - squad milestones (every 10 minutes): new ones become draft story suggestions (squadMilestones.js);
//  - news links (every 10 minutes): tag suggestions and AI fact suggestions (squadNews.js).
import { publishDue } from './mediaApprovals.js';
import { ensureMediaSchema, mcSettings, setMcSetting, mcLog, SYSTEM } from './mediaCentre.js';
import { weekStart, nextWeekly } from './mediaDeadlines.js';
import { sendEmail } from './email.js';
import { superAdminEmails } from './superAdmins.js';
import { detectMilestones } from './squadMilestones.js';
import { newsLinkTick } from './squadNews.js';

const LAGOS = 3600e3;
const SITE = 'https://lobistarsfc.com';

export async function newsletterReminders(env, now = Date.now()) {
  const db = env.DB;
  await ensureMediaSchema(db);
  const s = await mcSettings(db);
  const local = new Date(now + LAGOS), dow = local.getUTCDay(), hour = local.getUTCHours();
  const wk = weekStart(now).slice(0, 10), out = {};
  const sendOnce = async (key, to, subject, body) => {
    if (s[key] === wk) return false;
    await setMcSetting(db, key, wk, 'reminder');
    let sent = false;
    if (env.RESEND_API_KEY && to.length) {
      try { await sendEmail(env, { to, subject, html: `<p style="font:16px/1.5 Arial,sans-serif">${body}</p><p style="font:14px Arial,sans-serif"><a href="${SITE}/media-centre/newsletter/">Open the Media Centre</a></p>`, text: body }); sent = true; }
      catch (e) { console.error('[media centre] reminder', e); }
    }
    await mcLog(db, SYSTEM, 'reminder', { section: 'newsletter', itemTitle: subject, details: `${sent ? 'Emailed' : 'Email not set up; shown on the Media Centre home'}: ${to.join(', ') || 'nobody'}` });
    return true;
  };
  const items = (await db.prepare(`SELECT status FROM mc_items WHERE kind = 'newsletter' AND created_at >= ?`).bind(weekStart(now)).all()).results;
  // Monday from 09:00: nothing started this week.
  if (dow === 1 && hour >= 9 && !items.length) {
    const due = new Date(nextWeekly(s.newsletter_deadline, now)).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
    out.mondayReminder = await sendOnce('reminded_monday', [s.media_team_email].filter(Boolean), 'Reminder: start this week\'s Lobi Stars Weekly Newsletter',
      `This week's Lobi Stars Weekly Newsletter has not been started yet. Please write it in the Media Centre and send it for approval by ${due}.`);
  }
  // Tuesday after the deadline time: one waiting for approval.
  const [dDow, dHm = '18:00'] = String(s.newsletter_deadline).split('|');
  const [dh, dm] = dHm.split(':').map(Number);
  if (dow === Number(dDow) && (hour > dh || (hour === dh && local.getUTCMinutes() >= (dm || 0) + 30)) && items.some(i => i.status === 'submitted')) {
    out.tuesdayReminder = await sendOnce('reminded_tuesday', superAdminEmails(env), 'Lobi Stars Weekly Newsletter is waiting for your approval',
      'This week\'s Lobi Stars Weekly Newsletter has been sent for approval. Please review it in Admin › Media Centre › Approval Queue so it can go out on Wednesday morning.');
  }
  return out;
}

export async function mediaCentreTick(env, now = Date.now()) {
  const out = { scheduled: await publishDue(env) };
  try { Object.assign(out, await newsletterReminders(env, now)); } catch (e) { console.error('[media centre] reminders', e); out.reminderError = String(e?.message || e).slice(0, 200); }
  try { out.newsLinks = await newsLinkTick(env, { now }); } catch (e) { console.error('[squad] news links', e); out.newsLinkError = String(e?.message || e).slice(0, 200); }
  try { out.milestones = await detectMilestones(env, { now }); } catch (e) { console.error('[squad] milestones', e); out.milestoneError = String(e?.message || e).slice(0, 200); }
  return out;
}
