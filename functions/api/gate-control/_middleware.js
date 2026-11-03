import { getGateSession, csrfProblem, clearGateCookie, json } from '../_lib/gateControl.js';

// Every /api/gate-control/* call (except signing in) needs a Gate Control
// session (cookie ls_gate, never the admin session). Changes must come from
// the Gate Control page (same website + the session's token). X-Activity: 0
// (automatic refreshes) doesn't count as activity, so an idle phone still signs out.
const OPEN = /^\/api\/gate-control\/login\/?$/;

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  if (OPEN.test(url.pathname)) return next();
  const session = await getGateSession(request, env, { touch: request.headers.get('X-Activity') !== '0' });
  if (!session) return json({ error: 'Please sign in to Gate Control again.', signedOut: true }, 401, { 'Set-Cookie': clearGateCookie() });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bad = csrfProblem(request, session);
    if (bad) return json({ error: bad }, 403);
  }
  data.gc = session;
  return next();
}
