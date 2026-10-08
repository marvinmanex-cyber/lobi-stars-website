import { requireAdmin } from '../_lib/adminEvents.js';
import { createAdminCookie } from '../_lib/adminSession.js';

// POST /api/admin/login { code } -- checks the admin code and sets the staff
// cookie that lets the browser open the /admin pages.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  const check = new Request(request.url, { headers: { 'x-admin-code': code } });
  const denied = requireAdmin(check, env);
  if (denied) return denied;

  return Response.json({ ok: true }, { headers: { 'Set-Cookie': await createAdminCookie(env) } });
}
