import { signIn, approverSignIn, adminMediaSignIn, json } from '../_lib/mediaCentre.js';
import { looksLikeEmail } from '../_lib/superAdminLogin.js';

// POST /api/media-centre/login { loginId, password } -- media staff: Login ID + password.
//   { loginId: <website email>, password, code } -- website Super Admins.   { approver: true, password } -- the media approver.
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'This request came from another website and was refused.' }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  // The media approver signs in with the approval password only.
  const r = b.approver ? await approverSignIn(env, request, b.password)
    : looksLikeEmail(b.loginId) ? await adminMediaSignIn(env, request, { email: b.loginId, password: b.password, code: b.code })
    : await signIn(env, request, { loginId: b.loginId, password: b.password });
  if (!r.ok) return json({ error: r.error, needCode: r.needCode || undefined }, r.status || 400);
  return json({ ok: true, ...r.session }, 200, { 'Set-Cookie': r.cookie });
}
