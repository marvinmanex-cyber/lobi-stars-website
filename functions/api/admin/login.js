import { verifyPassword } from '../_lib/password.js';
import { sessionCookie, ensureAdminSchema, OWNER, logAdminAction } from '../_lib/adminSession.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema, checkTurnstile } from '../_lib/fans.js';
import { verifyTotp } from '../_lib/totp.js';
import { roleOf } from '../_lib/adminRoles.js';
import {
  createSession, deviceIdFrom, deviceCookie, randomHex, rememberDevice, looksLikeBackupCode, useBackupCode,
  securitySettings, allowlistApplies, ipAllowed, alertAddresses, securityEmail, loginDetails, describeDevice,
  LOCK_AFTER, LOCK_MS, CAPTCHA_AFTER,
} from '../_lib/adminSecurity.js';

// POST /api/admin/login
//   { code }                       -- the owner, with the ADMIN_CODE secret (every use is emailed to the Super Admins)
//   { email, password }            -- a staff account
//   { email, password, otp }       -- the same with two-step login: the 6-digit code or a backup code (abcd-efgh)
//   + turnstile                    -- the human check, asked for after 3 wrong attempts
// 5 wrong passwords or codes in a row lock the account for 15 minutes (the person is emailed).
// Sets the session cookie that opens the /admin pages and admin APIs.
const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.ADMIN_CODE) return json({ error: 'Admin access is not configured. Set ADMIN_CODE in the server environment.' }, 503);
  const later = p => { try { waitUntil(p); } catch { p.catch(() => {}); } };
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const db = env.DB;
  const ip = clientIp(request);
  const origin = new URL(request.url).origin;

  await ensureFanSchema(db); // creates the rate_limits table
  await ensureAdminSchema(db);
  if (!(await rateLimit(db, `admin-login:${ip}`, 15, 900))) return tooMany();

  // Wrong attempts from this network in the last 15 minutes (any account).
  const win = Math.floor(Date.now() / 1000); const start = win - (win % 900);
  const ipRow = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(`admin-fail:${ip}`).first();
  const ipFails = ipRow && ipRow.window_start === start ? ipRow.count : 0;
  const ipFail = () => rateLimit(db, `admin-fail:${ip}`, 1e6, 900);
  const captchaOk = () => checkTurnstile(env, typeof body.turnstile === 'string' ? body.turnstile : '', ip);
  const needCaptcha = (error = 'Please tick the box to show you are not a robot, then log in again.') => json({ needCaptcha: true, error }, 401);

  // ── The owner's admin code ──
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (code) {
    if (ipFails >= CAPTCHA_AFTER && !(await captchaOk())) return needCaptcha();
    if (code.length !== env.ADMIN_CODE.length || code !== env.ADMIN_CODE) {
      await ipFail();
      await logAdminAction(db, { id: 'unknown', name: 'Admin code' }, 'login_failed', `wrong admin code from ${ip}`);
      return json({ error: 'Invalid admin code', needCaptcha: ipFails + 1 >= CAPTCHA_AFTER || undefined }, 401);
    }
    const { deviceId, setDevice } = device(request);
    const sid = await createSession(db, request, 'owner', { deviceId });
    await rememberDevice(db, 'owner', deviceId, request);
    await logAdminAction(db, OWNER, 'owner_code_login', `${describeDevice(request.headers.get('User-Agent') || '')}, ${ip}`);
    // The admin code is the way back in when nothing else works, so every use is reported.
    later(alertAddresses(env).then(to => securityEmail(env, to, 'Lobi Stars admin: the owner admin code was used to sign in', [
      'Someone signed in to the Lobi Stars admin with the <strong>owner admin code</strong>.', loginDetails(request),
      'If nobody at the club did this, change ADMIN_CODE in Cloudflare straight away (that signs everyone out) and tell the Super Admins.'], origin)));
    return withCookies(json({ ok: true, admin: OWNER }), await sessionCookie(env, sid), setDevice);
  }

  // ── A staff account ──
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return json({ error: 'Please enter your email and password.' }, 400);
  const u = await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first();
  const now = Date.now();

  if (u?.locked_until && u.locked_until > now) {
    const mins = Math.ceil((u.locked_until - now) / 60000);
    return json({ locked: true, error: `This account is locked for ${mins} more minute${mins === 1 ? '' : 's'} after too many wrong attempts. Try again then, or ask a Super Admin.` }, 423);
  }
  if (ipFails >= CAPTCHA_AFTER || (u?.failed_logins || 0) >= CAPTCHA_AFTER) {
    if (!(await captchaOk())) return needCaptcha();
  }

  const fail = async (message, extra = {}) => {
    await ipFail();
    if (!u) {
      await logAdminAction(db, { id: 'unknown', name: email.slice(0, 80) }, 'login_failed', `unknown or inactive email, from ${ip}`);
      return json({ error: message, ...extra }, 401);
    }
    const n = (u.failed_logins || 0) + 1;
    if (n >= LOCK_AFTER) {
      await db.prepare(`UPDATE admin_users SET failed_logins = 0, locked_until = ? WHERE id = ?`).bind(now + LOCK_MS, u.id).run();
      await logAdminAction(db, { id: u.id, name: u.name }, 'account_locked', `${LOCK_AFTER} wrong attempts; locked for 15 minutes (from ${ip})`);
      later(securityEmail(env, u.email, 'Lobi Stars admin: your account was locked for 15 minutes', [
        `Hello ${u.name.split(' ')[0]},`, `There were ${LOCK_AFTER} wrong attempts to sign in to your Lobi Stars admin account, so it is locked for 15 minutes.`,
        loginDetails(request), "If this was you, wait 15 minutes and try again. If it wasn't, someone may know your email address: once you're in, change your password and make sure two-step login is on."], origin));
      return json({ locked: true, error: 'Too many wrong attempts. This account is now locked for 15 minutes; we have emailed the account holder.' }, 423);
    }
    await db.prepare(`UPDATE admin_users SET failed_logins = ? WHERE id = ?`).bind(n, u.id).run();
    await logAdminAction(db, { id: u.id, name: u.name }, 'login_failed', `${extra.needCode ? 'wrong two-step code' : 'wrong password'} (${n} of ${LOCK_AFTER}), from ${ip}`);
    return json({ error: message, ...extra, needCaptcha: n >= CAPTCHA_AFTER || undefined }, 401);
  };

  if (!u || !u.active || !(await verifyPassword(password, u.password_hash))) return fail('Incorrect email or password.');

  // An IP allowlist can limit where some roles sign in from.
  const settings = await securitySettings(db);
  if (allowlistApplies(settings, roleOf(u)) && !ipAllowed(ip, settings.ip_allowlist)) {
    await logAdminAction(db, { id: u.id, name: u.name }, 'login_blocked_ip', `sign-in from ${ip} is not on the IP allowlist`);
    return json({ error: "Signing in from this network isn't allowed for your role. Use the club's network, or ask a Super Admin." }, 403);
  }

  // Two-step login: the password alone is not enough.
  let twoStep = false;
  if (u.totp_enabled) {
    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    if (!otp) return json({ needCode: true, error: 'Enter the 6-digit code from your authenticator app (or one of your backup codes).' }, 401);
    if (!(await rateLimit(db, `admin-otp:${u.id}`, 8, 900))) return tooMany();
    if (looksLikeBackupCode(otp)) {
      const left = await useBackupCode(db, u.id, otp);
      if (left === null) return fail('That backup code is not right or has already been used.', { needCode: true });
      await logAdminAction(db, { id: u.id, name: u.name }, 'backup_code_used', `${left} backup code${left === 1 ? '' : 's'} left`);
      later(securityEmail(env, u.email, 'Lobi Stars admin: a backup code was used', [
        `Hello ${u.name.split(' ')[0]},`, `One of your two-step login backup codes was just used to sign in. You have <strong>${left}</strong> left.`, loginDetails(request),
        left <= 3 ? 'You are running low: make new backup codes in My account.' : 'Each code works once. You can make new ones in My account.'], origin));
    } else {
      const step = await verifyTotp(u.totp_secret, otp, u.totp_last_step);
      if (!step) return fail('That code is not right or has already been used. Wait for the next code and try again.', { needCode: true });
      // Conditional update: the same code can never be used twice, even at the same moment.
      const r = await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run();
      if (!r.meta?.changes) return fail('That code has already been used. Wait for the next code.', { needCode: true });
    }
    twoStep = true;
  }

  await db.prepare(`UPDATE admin_users SET last_login_at = datetime('now'), failed_logins = 0, locked_until = NULL${twoStep ? `, twostep_login_at = datetime('now')` : ''} WHERE id = ?`).bind(u.id).run();
  const { deviceId, setDevice } = device(request);
  const seen = await rememberDevice(db, u.id, deviceId, request);
  const sid = await createSession(db, request, u.id, { twoStep, deviceId });
  await logAdminAction(db, { id: u.id, name: u.name }, 'login', `${describeDevice(request.headers.get('User-Agent') || '')}, ${ip}${twoStep ? ', two-step' : ''}${seen.isNew ? ', new device' : ''}`);
  if (seen.isNew && !seen.firstEver) {
    later(securityEmail(env, u.email, 'Lobi Stars admin: new sign-in to your account', [
      `Hello ${u.name.split(' ')[0]},`, 'Your Lobi Stars admin account was just signed in to on a device we haven\'t seen before.', loginDetails(request),
      "If this was you, there's nothing to do."], origin));
  }
  return withCookies(json({
    ok: true,
    admin: { id: u.id, name: u.name, role: roleOf(u), canExport: !!u.can_export_fan_data },
    mustChangePassword: !!u.must_change_password || undefined,
  }), await sessionCookie(env, sid), setDevice);
}

function device(request) {
  const known = deviceIdFrom(request);
  const deviceId = known || randomHex(16);
  return { deviceId, setDevice: known ? null : deviceCookie(deviceId) };
}
function withCookies(res, ...cookies) {
  for (const c of cookies) if (c) res.headers.append('Set-Cookie', c);
  return res;
}
