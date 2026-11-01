import { getKitchenSession, csrfProblem, clearKitchenCookie, json } from '../_lib/matchdayKitchen.js';

// Every /api/matchday-kitchen/* call (except signing in) needs a MatchDay
// Kitchen session (cookie ls_mdk, never the admin session). Changes must come
// from the MatchDay Kitchen pages (same website + the session's token).
// X-Activity: 0 (automatic refreshes) doesn't count as activity, so an idle
// tablet still signs out.
const OPEN = /^\/api\/matchday-kitchen\/login\/?$/;

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  if (OPEN.test(url.pathname)) return next();
  const session = await getKitchenSession(request, env, { touch: request.headers.get('X-Activity') !== '0' });
  if (!session) return json({ error: 'Please sign in to MatchDay Kitchen again.', signedOut: true }, 401, { 'Set-Cookie': clearKitchenCookie() });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bad = csrfProblem(request, session);
    if (bad) return json({ error: bad }, 403);
  }
  data.mk = session;
  return next();
}
