// Score verification alerts: emails to the Website & Data Officer (Matchday
// Admin role) and, for conflicts and official corrections, the Super Admins.
// The admin bell shows the same things from the database (notifications.js),
// so nothing is lost when email isn't set up. Each alert is sent once (key).
import { sendEmail } from '../email.js';
import { superAdminEmails } from '../superAdmins.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function scoreAlertRecipients(env, { superAdmins = false } = {}) {
  const rows = (await env.DB.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role IN (${superAdmins ? "'matchday_admin', 'super_admin'" : "'matchday_admin'"})`).all().catch(() => ({ results: [] }))).results;
  const list = rows.map(r => String(r.email || '').toLowerCase());
  if (superAdmins || !list.length) list.push(...superAdminEmails(env));
  return [...new Set(list.filter(e => EMAIL_RE.test(e)))];
}

/** Sends one alert email once per key. Returns true when sent. */
export async function scoreAlert(env, { key, subject, lines, link = '/admin/scores/', superAdmins = false }) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS score_alerts (key TEXT PRIMARY KEY, subject TEXT, sent_to INTEGER, created_at TEXT NOT NULL)`).run();
  const fresh = await db.prepare(`INSERT OR IGNORE INTO score_alerts (key, subject, sent_to, created_at) VALUES (?, ?, 0, ?) RETURNING key`).bind(key, subject, new Date().toISOString()).first();
  if (!fresh) return false;
  const to = await scoreAlertRecipients(env, { superAdmins });
  if (!to.length || !env.RESEND_API_KEY) return false;
  const site = String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#15181D">
    ${lines.map(l => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}
    <p><a href="${esc(site + link)}" style="display:inline-block;background:#E31E24;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open in the admin</a></p>
    <p style="color:#5B6470;font-size:13px">Lobi Stars website · score verification</p></div>`;
  try {
    await sendEmail(env, { to, subject, html });
    await db.prepare(`UPDATE score_alerts SET sent_to = ? WHERE key = ?`).bind(to.length, key).run();
    return true;
  } catch (err) {
    console.error('[scores] alert email', err);
    return false;
  }
}
