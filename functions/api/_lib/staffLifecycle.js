// Joining and leaving: invite links (the person chooses their own password;
// no admin ever chooses or sends one), password reset links, the leaver
// process (disable, sign out everywhere, record who and why; accounts are
// never deleted so their history stays) and the monthly access review.
import { ensureAdminSchema, logAdminAction } from './adminSession.js';
import { sha256Hex, randomHex, revokeSessions, securityEmail, alertAddresses, securitySettings, saveSecuritySetting } from './adminSecurity.js';
const normE = e => String(e || '').trim().toLowerCase();
import { ROLE_DEFAULTS, roleOf } from './adminRoles.js';

export const INVITE_HOURS = 48;
export const RESET_HOURS = 2;
export const NO_PASSWORD = '!'; // an invited person hasn't chosen a password yet
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ready = false;
export async function ensureLifecycleSchema(db) {
  if (ready) return;
  await ensureAdminSchema(db);
  const cols = new Set((await db.prepare(`PRAGMA table_info(admin_users)`).all()).results.map(r => r.name));
  for (const [name, type] of [['invite_hash', 'TEXT'], ['invite_expires', 'INTEGER'], ['invite_kind', 'TEXT'], ['invited_by', 'TEXT'], ['role_email', 'TEXT'],
    ['disabled_at', 'TEXT'], ['disabled_by', 'TEXT'], ['disabled_reason', 'TEXT'], ['reviewed_at', 'TEXT']]) {
    if (!cols.has(name)) {
      try { await db.prepare(`ALTER TABLE admin_users ADD COLUMN ${name} ${type}`).run(); }
      catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
    }
  }
  ready = true;
}

/** Active / Disabled / Pending invite. */
export const staffStatus = u => (!u.active || u.disabled_at ? 'disabled' : u.password_hash === NO_PASSWORD ? 'pending' : 'active');

/**
 * Makes a one-time link and emails it. kind 'invite' (48 hours: choose a
 * password and set up two-step login) or 'reset' (2 hours: choose a new password).
 * Returns { url, emailed } (url only for the test server).
 */
export async function sendStaffLink(env, origin, u, kind, by) {
  await ensureLifecycleSchema(env.DB);
  const token = randomHex(32);
  const hours = kind === 'invite' ? INVITE_HOURS : RESET_HOURS;
  await env.DB.prepare(`UPDATE admin_users SET invite_hash = ?, invite_expires = ?, invite_kind = ?, invited_by = ? WHERE id = ?`)
    .bind(await sha256Hex(token), Date.now() + hours * 3600e3, kind, by?.name || null, u.id).run();
  const url = `${origin}/admin/invite/?t=${token}`;
  const first = String(u.name || '').split(' ')[0];
  const role = ROLE_DEFAULTS[roleOf(u)];
  const lines = kind === 'invite'
    ? [`Hello ${esc(first)},`, `${esc(by?.name || 'The club')} has given you an account on the Lobi Stars FC website admin${role ? ` as <strong>${esc(role.label)}</strong> (${esc(role.job || '')})` : ''}.`,
       `<a href="${url}" style="display:inline-block;padding:12px 20px;background:#C11A1F;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Set up your account</a>`,
       `The link works once, for the next ${INVITE_HOURS} hours. You'll choose your own password (at least 12 characters) and set up two-step login with an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Authy, free).`,
       'Never share your password or your codes with anyone, including club staff.']
    : [`Hello ${esc(first)},`, 'Someone asked to reset the password for your Lobi Stars admin account.',
       `<a href="${url}" style="display:inline-block;padding:12px 20px;background:#C11A1F;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Choose a new password</a>`,
       `The link works once, for the next ${RESET_HOURS} hours. After that you sign in as usual, with your two-step login code.`,
       "If you didn't ask for this, you can ignore this email: your password hasn't changed."];
  const emailed = await securityEmail(env, u.email, kind === 'invite' ? 'Your Lobi Stars FC admin account' : 'Reset your Lobi Stars admin password', lines, origin);
  return { url: env.FANS_DEV_LINKS === '1' ? url : undefined, emailed };
}

/** The account a link belongs to (still valid), or null. */
export async function findByLink(db, token) {
  await ensureLifecycleSchema(db);
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const u = await db.prepare(`SELECT * FROM admin_users WHERE invite_hash = ?`).bind(await sha256Hex(token)).first();
  if (!u || !u.invite_expires || u.invite_expires < Date.now() || staffStatus(u) === 'disabled') return null;
  return u;
}

/** The leaver process: disabled at once, signed out on every device, invite links cancelled; who and why recorded. */
export async function disableStaff(env, u, by, reason) {
  await ensureLifecycleSchema(env.DB);
  const why = String(reason || '').trim().slice(0, 300) || 'No reason given';
  await env.DB.prepare(`UPDATE admin_users SET active = 0, disabled_at = datetime('now'), disabled_by = ?, disabled_reason = ?, invite_hash = NULL, invite_expires = NULL,
    email_code_hash = NULL WHERE id = ?`).bind(by.name, why, u.id).run();
  const n = await revokeSessions(env.DB, u.id, `account disabled by ${by.name}`);
  // The site has no other access tokens for staff (the content CMS uses each person's own GitHub access: remove them from GitHub too).
  await logAdminAction(env.DB, by, 'staff_disabled', `${u.name} <${u.email}>: disabled (${why}); signed out of ${n} device(s)`);
  // A Super Admin disabled: the other Super Admins are told straight away.
  if (u.role === 'super_admin') {
    const to = (await alertAddresses(env)).filter(e => e !== normE(u.email));
    await securityEmail(env, to, `Lobi Stars admin: Super Admin ${u.name} was disabled`, [`<strong>${esc(by.name)}</strong> disabled the Super Admin account of <strong>${esc(u.name)}</strong> (${esc(u.email)}).`, `Reason: ${esc(why)}`, "If this wasn't agreed, sign in and check Settings › Staff Users & Roles straight away."]);
  }
  return n;
}

// ── Monthly access review (the 1st of each month, Nigeria time) ──

const lagos = (now = Date.now()) => new Date(now + 3600e3);
export const reviewMonth = (now = Date.now()) => lagos(now).toISOString().slice(0, 7);

/** Everyone active, with role, last sign-in and whether they haven't signed in for 30+ days. */
export async function accessReviewList(db) {
  await ensureLifecycleSchema(db);
  const { results } = await db.prepare(`SELECT id, name, email, role, role_email, last_login_at, created_at, reviewed_at, password_hash, active, disabled_at,
      (SELECT MAX(last_seen) FROM admin_sessions s WHERE s.user_id = u.id) AS last_seen
    FROM admin_users u WHERE active = 1 AND disabled_at IS NULL ORDER BY name`).all();
  const now = Date.now();
  return results.map(u => {
    const last = Math.max(Date.parse(String(u.last_login_at || '').replace(' ', 'T') + 'Z') || 0, u.last_seen || 0);
    const since = last || Date.parse(String(u.created_at || '').replace(' ', 'T') + 'Z') || now;
    return { id: u.id, name: u.name, email: u.email, role: ROLE_DEFAULTS[roleOf(u)]?.label || u.role, roleEmail: u.role_email, status: staffStatus(u),
      lastActive: last ? new Date(last).toISOString() : null, idleDays: Math.floor((now - since) / 864e5), unused: now - since > 30 * 864e5, reviewedAt: u.reviewed_at };
  });
}

/** Emails the review to the Super Admins (and club management addresses). force = send now (button), otherwise once on the 1st. */
export async function sendAccessReview(env, origin, { force = false } = {}) {
  const db = env.DB;
  await ensureLifecycleSchema(db);
  const month = reviewMonth();
  if (!force) {
    if (lagos().getUTCDate() !== 1) return { sent: false, reason: 'not the 1st' };
    const s = await securitySettings(db, { force: true });
    if (s.access_review_month === month) return { sent: false, reason: 'already sent' };
  }
  const list = await accessReviewList(db);
  const rows = list.map(u => `<tr style="background:${u.unused ? '#FFF4E5' : '#fff'}"><td style="padding:8px;border-bottom:1px solid #eee"><strong>${esc(u.name)}</strong><br><span style="color:#5b6470;font-size:13px">${esc(u.email)}</span></td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(u.role)}</td><td style="padding:8px;border-bottom:1px solid #eee">${u.status === 'pending' ? 'Invite not accepted yet' : u.lastActive ? `${esc(new Date(u.lastActive).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' }))}${u.unused ? `<br><strong style="color:#A3161B">Not used for ${u.idleDays} days</strong>` : ''}` : '<strong style="color:#A3161B">Never signed in</strong>'}</td></tr>`).join('');
  const unused = list.filter(u => u.unused).length;
  const link = `${origin}/admin/staff/?review=${month}#review`;
  const html = [
    `Here are everyone's admin accounts for the monthly access review (${esc(month)}). ${unused ? `<strong>${unused} account${unused === 1 ? ' has' : 's have'} not been used for 30 days or more</strong> (highlighted).` : 'Every account has been used in the last 30 days.'}`,
    `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#15181D;color:#fff"><th style="padding:8px;text-align:left">Person</th><th style="padding:8px;text-align:left">Role</th><th style="padding:8px;text-align:left">Last active</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="padding:8px">No staff accounts.</td></tr>'}</tbody></table>`,
    `<a href="${link}" style="display:inline-block;padding:12px 20px;background:#C11A1F;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Review: Keep or Disable each account</a>`,
    'Sign in, and on the Staff page press <strong>Keep</strong> or <strong>Disable</strong> next to each person. Disable anyone who has left the club or no longer needs access.',
  ];
  const to = await alertAddresses(env);
  const sent = await securityEmail(env, to, `Lobi Stars admin: monthly access review (${month})`, html, origin);
  await saveSecuritySetting(db, 'access_review_month', month, 'Monthly access review');
  await logAdminAction(db, { id: 'system', name: 'Monthly access review' }, 'access_review_sent', `${list.length} account(s), ${unused} unused for 30+ days; emailed to ${to.length} address(es)${sent ? '' : ' (email not sent: Resend not set up)'}`);
  return { sent, accounts: list.length, unused };
}
