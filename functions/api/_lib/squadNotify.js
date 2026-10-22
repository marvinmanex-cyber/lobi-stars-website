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

/**
 * "Forgot the password?" in the portal: the NEW password goes only to the three
 * Super Admins, who give it to the staff member. Returns the addresses it went to
 * ([] if email is not set up or failed; the caller then keeps the old password).
 */
export async function emailNewPassword(env, req, password, username) {
  if (!env.RESEND_API_KEY) return [];
  const to = superAdminEmails(env);
  if (!to.length) return [];
  const site = String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
  await sendEmail(env, {
    to, subject: `Squad Data Portal: new password (asked for by ${req.name})`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16181D">
      <p><b>${esc(req.name)}</b> forgot the Squad & Staff Data Portal password (${esc(req.device)}). A new password has been made and <b>works from now</b>; the old one no longer works for new sign-ins. People already signed in stay signed in.</p>
      <p style="font-size:16px">Username: <b>${esc(username)}</b><br>New password: <b style="font-family:Consolas,monospace;font-size:18px;letter-spacing:.04em">${esc(password)}</b></p>
      <p>Give it to ${esc(req.name)} on WhatsApp or in person: <b>${esc(req.contact)}</b>. They were told to contact their admin. Please don't forward this email.</p>
      <p>If you don't know this person, open the portal settings and choose a new password so that only your team has it.</p>
      <p><a href="${esc(site)}/admin/squad-portal/" style="display:inline-block;background:#B3121A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open portal settings</a></p>
      <p style="color:#4A505C;font-size:13px">Sent only to the Lobi Stars Super Admins · Squad & Staff Data Portal</p></div>`,
  });
  return to;
}
