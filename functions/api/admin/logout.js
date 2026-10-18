import { clearAdminCookie, cookieSessionId } from '../_lib/adminSession.js';
import { revokeSession } from '../_lib/adminSecurity.js';

// POST /api/admin/logout -- ends this sign-in (the session stops working on
// the server too, not just in this browser) and clears the cookie.
export async function onRequestPost({ request, env }) {
  const sid = await cookieSessionId(request, env).catch(() => null);
  if (sid && env.DB) await revokeSession(env.DB, sid, 'logout').catch(() => {});
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAdminCookie(), 'Cache-Control': 'no-store' } });
}
