import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../_lib/adminSession.js';
import { hashPassword, verifyPassword } from '../_lib/password.js';
import { newTotpSecret, verifyTotp, otpauthUri } from '../_lib/totp.js';
import { qrPngBuffer } from '../_lib/qrcode.js';
import { rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// My account (any signed-in staff member).
// GET  /api/admin/account                          -- name, email, whether two-step login is on
// POST /api/admin/account
//   { action: 'password', current, next }          change my password
//   { action: 'start_2fa' }                        a new secret + QR code to scan (not on yet)
//   { action: 'confirm_2fa', otp }                 turn two-step login on with the first code
//   { action: 'disable_2fa', password, otp }       turn it off (password + a current code)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const b64 = bytes => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (admin.id === 'owner') return json({ owner: true, name: admin.name });
  await ensureAdminSchema(env.DB);
  const u = await env.DB.prepare(`SELECT name, email, role, totp_enabled FROM admin_users WHERE id = ?`).bind(admin.id).first();
  return json({ owner: false, name: u.name, email: u.email, role: u.role, twoStep: !!u.totp_enabled });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (admin.id === 'owner') return json({ error: 'The owner admin code has no account settings. Sign in with a personal staff account to use two-step login.' }, 400);
  const db = env.DB;
  await ensureAdminSchema(db);
  await ensureFanSchema(db);
  if (!(await rateLimit(db, `account:${admin.id}`, 20, 900))) return tooMany();
  const b = await request.json().catch(() => ({}));
  const u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(admin.id).first();
  if (!u) return json({ error: 'Account not found.' }, 404);

  if (b.action === 'password') {
    if (!(await verifyPassword(String(b.current || ''), u.password_hash))) return json({ error: 'Your current password is not right.' }, 400);
    const next = String(b.next || '');
    if (next.length < 10) return json({ error: 'The new password must be at least 10 characters.' }, 400);
    await db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(next), u.id).run();
    await logAdminAction(db, admin, 'account_password', 'changed own password');
    return json({ ok: true });
  }
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
    await logAdminAction(db, admin, 'account_2fa_on', 'two-step login turned on');
    return json({ ok: true });
  }
  if (b.action === 'disable_2fa') {
    if (!u.totp_enabled) return json({ ok: true });
    if (!(await verifyPassword(String(b.password || ''), u.password_hash))) return json({ error: 'Your password is not right.' }, 400);
    const step = await verifyTotp(u.totp_secret, b.otp, u.totp_last_step);
    if (!step) return json({ error: 'That code is not right or has already been used.' }, 400);
    await db.prepare(`UPDATE admin_users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?`).bind(u.id).run();
    await logAdminAction(db, admin, 'account_2fa_off', 'two-step login turned off');
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
