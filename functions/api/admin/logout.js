import { clearAdminCookie } from '../_lib/adminSession.js';

// POST /api/admin/logout -- clears the staff cookie.
export async function onRequestPost() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAdminCookie() } });
}
