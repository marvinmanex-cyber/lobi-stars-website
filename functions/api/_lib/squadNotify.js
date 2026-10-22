// Squad & Staff Data Portal: telling the club reviewers (Website & Data Officer
// and Super Admins) that a profile was submitted. The admin bell shows the
// waiting profiles from the database (notifications.js); this sends the email.
// Reviewer addresses: SQUAD_REVIEWER_EMAILS (comma list) if set, otherwise every
// active Matchday Admin (Website & Data Officer) and the Super Admins.
import { sendEmail } from './email.js';
import { superAdminEmails } from './superAdmins.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function reviewerEmails(env) {
  const set = String(env.SQUAD_REVIEWER_EMAILS || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
  if (set.length) return [...new Set(set)];
  const rows = (await env.DB.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role IN ('matchday_admin', 'super_admin')`).all().catch(() => ({ results: [] }))).results;
  return [...new Set([...rows.map(r => String(r.email || '').toLowerCase()), ...superAdminEmails(env)].filter(e => EMAIL_RE.test(e)))];
}

export async function notifyReviewers(env, profile, byName) {
  if (!env.RESEND_API_KEY) return false;
  const to = await reviewerEmails(env);
  if (!to.length) return false;
  const site = String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
  const what = profile.type === 'staff' ? 'coach / staff' : 'player';
  await sendEmail(env, {
    to, subject: `Squad profile submitted for review: ${profile.display_name}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16181D">
      <p><b>${esc(byName)}</b> submitted the ${what} profile of <b>${esc(profile.display_name)}</b> (${esc(profile.season)}) for club review.</p>
      <p><a href="${esc(site)}/admin/squad-profiles/?id=${encodeURIComponent(profile.id)}" style="display:inline-block;background:#B3121A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Review the profile</a></p>
      <p style="color:#4A505C;font-size:13px">Lobi Stars FC website · Squad profile submissions</p></div>`,
  });
  return true;
}

/** "Forgot the password?" in the portal: tells the three Super Admins (who make a new password). */
export async function notifyPasswordRequest(env, req) {
  if (!env.RESEND_API_KEY) return false;
  const to = superAdminEmails(env);
  if (!to.length) return false;
  const site = String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
  await sendEmail(env, {
    to, subject: `Squad Data Portal: ${req.name} asked for a new password`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16181D">
      <p><b>${esc(req.name)}</b> forgot the Squad & Staff Data Portal password and asked for a new one (${esc(req.device)}).</p>
      <p>Reach them on: <b>${esc(req.contact)}</b></p>
      <p>If you know this person: open the portal settings, press <b>Generate new password</b> and send it to them by WhatsApp or in person (never by email). If you don't know them, ignore this request.</p>
      <p><a href="${esc(site)}/admin/squad-portal/" style="display:inline-block;background:#B3121A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open portal settings</a></p>
      <p style="color:#4A505C;font-size:13px">Lobi Stars FC website · Squad & Staff Data Portal</p></div>`,
  });
  return true;
}
