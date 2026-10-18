import { getAdmin } from '../_lib/adminSession.js';
import { allowedPath, loadRoles } from '../_lib/adminRoles.js';

// Role check for every admin API (the endpoints themselves check the login).
// A signed-in staff member calling an API outside their role gets 403.
// After staff save anything, the cached homepage (functions/index.js, kept
// 30 seconds) is cleared so match changes such as FULL TIME show at once.
export async function onRequest({ request, env, next, waitUntil }) {
  const url = new URL(request.url);
  const admin = await getAdmin(request, env);
  if (admin) await loadRoles(env.DB);
  if (admin && !allowedPath(admin, url.pathname, request.method)) {
    return Response.json({ error: "You don't have access to this. Ask a Super Admin if you need it." }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const res = await next();
  if (request.method !== 'GET' && request.method !== 'HEAD' && res.status < 400) {
    try { waitUntil(caches.default.delete(new Request(new URL('/', request.url).toString()))); } catch { /* nothing cached */ }
  }
  return res;
}
