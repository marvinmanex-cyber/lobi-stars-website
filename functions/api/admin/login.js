import { verifyPassword } from '../_lib/password.js';
import { createAdminCookie, ensureAdminSchema, OWNER } from '../_lib/adminSession.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { verifyTotp } from '../_lib/totp.js';

// POST /api/admin/login
//   { code }             -- owner, using the ADMIN_CODE secret
//   { email, password }  -- a staff account created by the owner
//   { email, password, otp } -- the same, when two-step login is on (6-digit authenticator code)
// Sets the staff cookie that opens the /admin pages and admin APIs.
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_CODE) return Response.json({ error: 'Admin access is not configured. Set ADMIN_CODE in the server environment.' }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { body = {}; }

  await ensureFanSchema(env.DB); // creates the rate_limits table
  if (!(await rateLimit(env.DB, `admin-login:${clientIp(request)}`, 15, 900))) return tooMany();

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (code) {
    if (code.length !== env.ADMIN_CODE.length || code !== env.ADMIN_CODE) {
      return Response.json({ error: 'Invalid admin code' }, { status: 401 });
    }
    return Response.json({ ok: true, admin: OWNER }, { headers: { 'Set-Cookie': await createAdminCookie(env, 'owner') } });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return Response.json({ error: 'Please enter your email and password.' }, { status: 400 });

  await ensureAdminSchema(env.DB);
  const u = await env.DB.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first();
  if (!u || !u.active || !(await verifyPassword(password, u.password_hash))) {
    return Response.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }
  // Two-step login: the password alone is not enough.
  if (u.totp_enabled) {
    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    if (!otp) return Response.json({ needCode: true, error: 'Enter the 6-digit code from your authenticator app.' }, { status: 401 });
    if (!(await rateLimit(env.DB, `admin-otp:${u.id}`, 8, 900))) return tooMany();
    const step = await verifyTotp(u.totp_secret, otp, u.totp_last_step);
    if (!step) return Response.json({ needCode: true, error: 'That code is not right or has already been used. Wait for the next code and try again.' }, { status: 401 });
    // Conditional update: the same code can never be used twice, even at the same moment.
    const r = await env.DB.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run();
    if (!r.meta?.changes) return Response.json({ needCode: true, error: 'That code has already been used. Wait for the next code.' }, { status: 401 });
  }
  await env.DB.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).bind(u.id).run();
  return Response.json(
    { ok: true, admin: { id: u.id, name: u.name, role: u.role, canExport: !!u.can_export_fan_data } },
    { headers: { 'Set-Cookie': await createAdminCookie(env, u.id) } }
  );
}
