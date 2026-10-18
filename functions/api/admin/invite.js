import { hashPassword } from '../_lib/password.js';
import { sessionCookie, logAdminAction } from '../_lib/adminSession.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { roleLabel } from '../_lib/adminRoles.js';
import { passwordProblem, createSession, deviceIdFrom, deviceCookie, randomHex, rememberDevice, revokeSessions, securityEmail, securitySettings, loginDetails } from '../_lib/adminSecurity.js';
import { ensureLifecycleSchema, findByLink, sendStaffLink, staffStatus } from '../_lib/staffLifecycle.js';

// The one-time links staff get by email (no sign-in needed; the link is the key).
// GET  /api/admin/invite?t=…                       who the link is for: { kind: invite|reset, name, email, role }
// POST /api/admin/invite { t, password }           choose a password. An invite then signs them in (next: two-step
//                                                  login); a reset signs them out everywhere and they sign in as usual.
// POST /api/admin/invite { action: 'forgot', email } "Forgot password?" on the login page: emails a reset link if the
//                                                  address has an account (the answer is the same either way).
const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const GONE = 'This link has expired or has already been used. Ask a Super Admin to send you a new one.';

export async function onRequestGet({ request, env }) {
  const u = await findByLink(env.DB, new URL(request.url).searchParams.get('t'));
  if (!u) return json({ error: GONE }, 410);
  const s = await securitySettings(env.DB);
  return json({ kind: u.invite_kind, name: u.name, email: u.email, role: roleLabel(u), twoStepRequired: s.require_two_step === '1', expires: new Date(u.invite_expires).toISOString() });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const db = env.DB;
  await ensureFanSchema(db);
  await ensureLifecycleSchema(db);
  const ip = clientIp(request);
  const origin = new URL(request.url).origin;
  const later = p => { try { waitUntil(p); } catch { p.catch(() => {}); } };
  const b = await request.json().catch(() => ({}));

  if (b.action === 'forgot') {
    const email = String(b.email || '').trim().toLowerCase();
    if (!(await rateLimit(db, `admin-forgot:${ip}`, 5, 900)) || !(await rateLimit(db, `admin-forgot:${email}`, 3, 3600))) return tooMany();
    const u = email ? await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first() : null;
    let url;
    if (u && staffStatus(u) === 'active') {
      url = (await sendStaffLink(env, origin, u, 'reset', { name: 'Forgot password (login page)' })).url;
      await logAdminAction(db, { id: u.id, name: u.name }, 'password_reset_requested', `from the login page (${ip})`);
    }
    return json({ ok: true, message: 'If that email address has a Lobi Stars admin account, we have sent it a link to choose a new password. Check your inbox (and spam).', resetUrl: url });
  }

  if (!(await rateLimit(db, `admin-invite:${ip}`, 10, 900))) return tooMany();
  const u = await findByLink(db, b.t);
  if (!u) return json({ error: GONE }, 410);
  const problem = await passwordProblem(env, String(b.password || ''), { email: u.email, name: u.name });
  if (problem) return json({ error: problem }, 400);
  const kind = u.invite_kind;
  // The link works once.
  const r = await db.prepare(`UPDATE admin_users SET password_hash = ?, invite_hash = NULL, invite_expires = NULL, invite_kind = NULL, must_change_password = 0,
      failed_logins = 0, locked_until = NULL, password_changed_at = datetime('now') WHERE id = ? AND invite_hash IS NOT NULL`)
    .bind(await hashPassword(String(b.password)), u.id).run();
  if (!r.meta?.changes) return json({ error: GONE }, 410);

  if (kind === 'reset') {
    const n = await revokeSessions(db, u.id, 'password reset by email link');
    await logAdminAction(db, { id: u.id, name: u.name }, 'account_password', `new password chosen with a reset link; ${n} device(s) signed out`);
    later(securityEmail(env, u.email, 'Lobi Stars admin: your password was changed', [`Hello ${u.name.split(' ')[0]},`, 'The password for your Lobi Stars admin account was just changed with a reset link, and every device was signed out.', loginDetails(request)], origin));
    return json({ ok: true, kind, signedIn: false });
  }
  // A new account: signed in straight away, ready to set up two-step login.
  const known = deviceIdFrom(request);
  const deviceId = known || randomHex(16);
  await rememberDevice(db, u.id, deviceId, request);
  const sid = await createSession(db, request, u.id, { deviceId });
  await db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).bind(u.id).run();
  await logAdminAction(db, { id: u.id, name: u.name }, 'invite_accepted', `account set up (${ip})`);
  const res = json({ ok: true, kind, signedIn: true });
  res.headers.append('Set-Cookie', await sessionCookie(env, sid));
  if (!known) res.headers.append('Set-Cookie', deviceCookie(deviceId));
  return res;
}
