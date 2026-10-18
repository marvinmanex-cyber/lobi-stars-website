import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction, clearAdminCookie } from '../_lib/adminSession.js';
import { hashPassword, verifyPassword } from '../_lib/password.js';
import { newTotpSecret, verifyTotp, otpauthUri } from '../_lib/totp.js';
import { qrPngBuffer } from '../_lib/qrcode.js';
import { rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import {
  passwordProblem, newBackupCodes, backupCodesLeft, listSessions, revokeSessions, revokeSession, securitySettings,
  securityEmail, loginDetails, looksLikeBackupCode, useBackupCode,
} from '../_lib/adminSecurity.js';

// My account (any signed-in staff member).
// GET  /api/admin/account                          -- name, email, two-step login, backup codes left, my signed-in devices
// POST /api/admin/account
//   { action: 'password', current, next }          change my password (12+ characters, not a leaked password)
//   { action: 'start_2fa' }                        a new secret + QR code to scan (not on yet)
//   { action: 'confirm_2fa', otp }                 turn two-step login on with the first code; returns 10 backup codes
//   { action: 'backup_codes', password, otp }      10 new backup codes (the old ones stop working)
//   { action: 'disable_2fa', password, otp }       turn it off (password + a current code), unless the club requires it
//   { action: 'logout_session', id }               sign out one of my devices
//   { action: 'logout_others' }                    sign out everywhere except here
//   { action: 'logout_all' }                       sign out everywhere, including here
const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const b64 = bytes => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const sessionsFor = async (db, admin) => (await listSessions(db, admin.id)).map(s => ({
  id: s.id, device: s.device, ip: s.ip, country: s.country, signedIn: new Date(s.created_at).toISOString(), lastActive: new Date(s.last_seen).toISOString(), twoStep: !!s.two_step, current: s.id === admin.sessionId,
}));

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { allowRestricted: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureAdminSchema(db);
  const settings = await securitySettings(db);
  const required = settings.require_two_step === '1';
  if (admin.id === 'owner') return json({ owner: true, name: admin.name, sessions: await sessionsFor(db, admin), twoStepRequired: required });
  const u = await db.prepare(`SELECT name, email, role, totp_enabled, must_change_password, password_changed_at FROM admin_users WHERE id = ?`).bind(admin.id).first();
  return json({
    owner: false, name: u.name, email: u.email, role: u.role, twoStep: !!u.totp_enabled,
    backupCodesLeft: u.totp_enabled ? await backupCodesLeft(db, admin.id) : 0,
    mustChangePassword: !!u.must_change_password, passwordChangedAt: u.password_changed_at,
    twoStepRequired: required, twoStepDue: admin.twoStepDue || null, restrict: admin.restrict || null,
    sessions: await sessionsFor(db, admin),
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env, { allowRestricted: true });
  if (denied) return denied;
  const db = env.DB;
  const later = p => { try { waitUntil(p); } catch { p.catch(() => {}); } };
  await ensureAdminSchema(db);
  await ensureFanSchema(db);
  if (!(await rateLimit(db, `account:${admin.id}`, 20, 900))) return tooMany();
  const b = await request.json().catch(() => ({}));

  // Signing out devices: staff and the owner.
  if (b.action === 'logout_session') {
    if (b.id === admin.sessionId) return json({ error: 'That is this device: use "Log out" instead.' }, 400);
    const n = await revokeSession(db, String(b.id || ''), 'signed out by the account holder', admin.id);
    if (n) await logAdminAction(db, admin, 'sessions_revoked', 'signed out one other device');
    return json({ ok: true, signedOut: n });
  }
  if (b.action === 'logout_others' || b.action === 'logout_all') {
    const all = b.action === 'logout_all';
    const n = await revokeSessions(db, admin.id, all ? 'logged out of all devices' : 'logged out of other devices', { keepId: all ? null : admin.sessionId });
    await logAdminAction(db, admin, 'sessions_revoked', all ? `logged out of all devices (${n})` : `logged out of all other devices (${n})`);
    return json({ ok: true, signedOut: n }, 200, all ? { 'Set-Cookie': clearAdminCookie() } : {});
  }

  if (admin.id === 'owner') return json({ error: 'The owner admin code has no password or two-step settings. Sign in with a personal staff account to use them.' }, 400);
  const u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(admin.id).first();
  if (!u) return json({ error: 'Account not found.' }, 404);
  const origin = new URL(request.url).origin;
  const settings = await securitySettings(db);
  const codeOk = async otp => {
    if (looksLikeBackupCode(otp)) return (await useBackupCode(db, u.id, otp)) !== null;
    const step = await verifyTotp(u.totp_secret, otp, u.totp_last_step);
    if (step) await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run();
    return !!step;
  };

  if (b.action === 'password') {
    if (!(await verifyPassword(String(b.current || ''), u.password_hash))) return json({ error: 'Your current password is not right.' }, 400);
    const next = String(b.next || '');
    if (next === String(b.current || '')) return json({ error: 'Choose a password different from your current one.' }, 400);
    const problem = await passwordProblem(env, next, { email: u.email, name: u.name });
    if (problem) return json({ error: problem }, 400);
    await db.prepare(`UPDATE admin_users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ?`).bind(await hashPassword(next), u.id).run();
    // Anyone who knew the old password is signed out on their devices.
    const n = await revokeSessions(db, u.id, 'password changed', { keepId: admin.sessionId });
    await logAdminAction(db, admin, 'account_password', `changed own password${n ? `; ${n} other device(s) signed out` : ''}`);
    later(securityEmail(env, u.email, 'Lobi Stars admin: your password was changed', [`Hello ${u.name.split(' ')[0]},`, 'The password for your Lobi Stars admin account was just changed. Your other devices have been signed out.', loginDetails(request)], origin));
    return json({ ok: true, otherDevicesSignedOut: n });
  }
  if (admin.restrict === 'password') return json({ error: 'Please choose a new password first.', restrict: 'password' }, 403);

  if (b.action === 'start_2fa') {
    if (u.totp_enabled) return json({ error: 'Two-step login is already on.' }, 409);
    const secret = newTotpSecret();
    await db.prepare(`UPDATE admin_users SET totp_pending = ? WHERE id = ?`).bind(secret, u.id).run();
    const uri = otpauthUri(secret, u.email);
    const png = await qrPngBuffer(uri, { size: 240, margin: 4 });
    return json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr: `data:image/png;base64,${b64(png)}` });
  }
  if (b.action === 'confirm_2fa') {
    if (!u.totp_pending) return json({ error: 'Start again: press "Turn on two-step login".' }, 400);
    const step = await verifyTotp(u.totp_pending, b.otp, 0);
    if (!step) return json({ error: 'That code is not right. Check the time on your phone is set automatically, and type the newest code.' }, 400);
    await db.prepare(`UPDATE admin_users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?`).bind(step, u.id).run();
    const codes = await newBackupCodes(db, u.id);
    await logAdminAction(db, admin, 'account_2fa_on', 'two-step login turned on; 10 backup codes made');
    later(securityEmail(env, u.email, 'Lobi Stars admin: two-step login is on', [`Hello ${u.name.split(' ')[0]},`, 'Two-step login is now on for your Lobi Stars admin account. Keep your backup codes somewhere safe, away from your phone.'], origin));
    return json({ ok: true, backupCodes: codes });
  }
  if (b.action === 'backup_codes') {
    if (!u.totp_enabled) return json({ error: 'Turn on two-step login first.' }, 400);
    if (!(await verifyPassword(String(b.password || ''), u.password_hash))) return json({ error: 'Your password is not right.' }, 400);
    if (!(await codeOk(b.otp))) return json({ error: 'That code is not right or has already been used.' }, 400);
    const codes = await newBackupCodes(db, u.id);
    await logAdminAction(db, admin, 'backup_codes_new', '10 new backup codes made (old ones stopped working)');
    return json({ ok: true, backupCodes: codes });
  }
  if (b.action === 'disable_2fa') {
    if (!u.totp_enabled) return json({ ok: true });
    if (settings.require_two_step === '1') return json({ error: 'Two-step login is required for all Lobi Stars staff, so it cannot be turned off. If you lost your phone, use a backup code or ask a Super Admin to reset it.' }, 403);
    if (!(await verifyPassword(String(b.password || ''), u.password_hash))) return json({ error: 'Your password is not right.' }, 400);
    if (!(await codeOk(b.otp))) return json({ error: 'That code is not right or has already been used.' }, 400);
    await db.prepare(`UPDATE admin_users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?`).bind(u.id).run();
    await db.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?`).bind(u.id).run();
    await logAdminAction(db, admin, 'account_2fa_off', 'two-step login turned off');
    later(securityEmail(env, u.email, 'Lobi Stars admin: two-step login was turned off', [`Hello ${u.name.split(' ')[0]},`, 'Two-step login was just turned off for your Lobi Stars admin account. Your password is now the only thing protecting it.', loginDetails(request)], origin));
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
