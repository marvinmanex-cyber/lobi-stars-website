import { signIn, json } from '../_lib/mediaCentre.js';

// POST /api/media-centre/login { loginId, password } -- Login ID + password only (no email sign-in).
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'This request came from another website and was refused.' }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const r = await signIn(env, request, { loginId: b.loginId, password: b.password });
  if (!r.ok) return json({ error: r.error }, r.status || 400);
  return json({ ok: true, ...r.session }, 200, { 'Set-Cookie': r.cookie });
}
