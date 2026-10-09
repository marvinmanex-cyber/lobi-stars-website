import { verifyPassword } from '../_lib/password.js';
import { createAdminCookie, ensureAdminSchema, OWNER } from '../_lib/adminSession.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// POST /api/admin/login
//   { code }             -- owner, using the ADMIN_CODE secret
//   { email, password }  -- a staff account created by the owner
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
  await env.DB.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).bind(u.id).run();
  return Response.json(
    { ok: true, admin: { id: u.id, name: u.name, role: u.role, canExport: !!u.can_export_fan_data } },
    { headers: { 'Set-Cookie': await createAdminCookie(env, u.id) } }
  );
}
