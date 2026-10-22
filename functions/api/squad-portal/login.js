import { signIn, portalJson } from '../_lib/squadPortal.js';

// POST /api/squad-portal/login { username, password, name, turnstile? }
// The portal's own sign-in (never the admin login). Sets the HttpOnly portal cookie.
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return portalJson({ error: 'This request came from another website and was refused.' }, 403);
  const b = await request.json().catch(() => ({}));
  const r = await signIn(env, request, b);
  if (r.error) return portalJson({ error: r.error, needTurnstile: !!r.needTurnstile, field: r.field || null, closed: !!r.closed }, r.status || 400);
  const res = portalJson({ ok: true, name: r.session.name, csrf: r.session.csrf });
  for (const c of r.cookies) res.headers.append('Set-Cookie', c);
  return res;
}
