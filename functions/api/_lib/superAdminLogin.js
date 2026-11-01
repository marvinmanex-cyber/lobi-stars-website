// Website Super Admins sign in to the separate staff areas (Media Centre, IT
// Centre / Squad Data Portal) with their website email, password and two-step
// code. This only checks who they are; each area then starts its own session
// (never the admin session, so signing in or out there leaves /admin alone).
// 5 wrong passwords for an email: refused for 15 minutes. A wrong email takes as
// long to refuse as a wrong password.
import { verifyPassword } from './password.js';
import { rateLimit } from './fans.js';
import { isFullSuperAdmin } from './superAdmins.js';
import { verifyTotp } from './totp.js';

const DUMMY_HASH = '100000:00000000000000000000000000000000:00';
export const looksLikeEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

/** -> { admin: { id, name, email } } or { error, status, needCode? } */
export async function verifySuperAdmin(env, { email, password, code }, area = 'staff') {
  const db = env.DB;
  const e = String(email || '').trim().toLowerCase().slice(0, 254);
  const key = `sa-area-fail:${area}:${e}`;
  const win = Math.floor(Date.now() / 1000), start = win - (win % 900);
  const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first().catch(() => null);
  if (row && row.window_start === start && row.count >= 5) return { error: 'Too many wrong passwords. Wait 15 minutes and try again.', status: 423 };
  const u = await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(e).first().catch(() => null);
  const ok = await verifyPassword(String(password || ''), u?.password_hash || DUMMY_HASH).catch(() => false);
  if (!ok || !u || !u.active || u.disabled_at) {
    await rateLimit(db, key, 1e6, 900);
    return { error: 'The email or password is not right.', status: 401 };
  }
  if (!isFullSuperAdmin(env, u)) return { error: 'Only website Super Admins can sign in here with an email.', status: 403 };
  if (u.totp_enabled) {
    const otp = String(code || '').replace(/\s/g, '');
    if (!otp) return { needCode: true, error: 'Enter the 6-digit code from your authenticator app.', status: 401 };
    const step = await verifyTotp(u.totp_secret, otp, u.totp_last_step || 0);
    if (!step) return { needCode: true, error: 'That code is not right. Wait for the next code and try again.', status: 401 };
    const r = await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run();
    if (!r.meta?.changes) return { needCode: true, error: 'That code has already been used. Wait for the next code.', status: 401 };
  }
  return { admin: { id: u.id, name: u.name || u.email, email: u.email } };
}

/** The Super Admin behind an area session (still a full Super Admin and active), or null. */
export async function stillSuperAdmin(env, adminId) {
  const u = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(adminId).first().catch(() => null);
  return u && u.active && !u.disabled_at && isFullSuperAdmin(env, u) ? { id: u.id, name: u.name || u.email, email: u.email } : null;
}
