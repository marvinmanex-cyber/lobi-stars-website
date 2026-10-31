import { getMediaSession, csrfProblem, clearMediaCookie, json } from '../_lib/mediaCentre.js';

// Every /api/media-centre/* call (except signing in and the sign-in status)
// needs a Media Centre session. Changes must come from the Media Centre page
// (same website + the session's CSRF token). Someone with a temporary password
// can only change it (or sign out) until they have.
const OPEN = /^\/api\/media-centre\/(login|session)\/?$/;
const PASSWORD_ONLY = /^\/api\/media-centre\/(password|logout|session)\/?$/;

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  if (OPEN.test(url.pathname)) return next();
  const session = await getMediaSession(request, env, { touch: request.headers.get('X-Activity') !== '0' });
  if (!session) return json({ error: 'Please sign in to the Media Centre again.', signedOut: true }, 401, { 'Set-Cookie': clearMediaCookie() });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bad = csrfProblem(request, session);
    if (bad) return json({ error: bad }, 403);
  }
  if (session.user.mustChange && !PASSWORD_ONLY.test(url.pathname)) return json({ error: 'Please choose your own password first.', mustChange: true }, 403);
  data.mc = session;
  return next();
}
