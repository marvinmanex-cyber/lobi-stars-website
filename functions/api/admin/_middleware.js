import { getAdmin } from '../_lib/adminSession.js';
import { allowedPath, loadRoles } from '../_lib/adminRoles.js';
import { crossSiteWrite } from '../_lib/adminSecurity.js';
import { helperMayOpen } from '../_lib/helpers.js';
import { hasPortalCookie, getPortalSession } from '../_lib/squadPortal.js';

// Role check for every admin API (the endpoints themselves check the login).
// A signed-in staff member calling an API outside their role gets 403.
// Changes must come from the website's own pages (not another website), and
// someone who must first choose a new password or set up two-step login can
// only use My account.
// After staff save anything, the cached homepage (functions/index.js, kept
// 30 seconds) is cleared so match changes such as FULL TIME show at once.
export async function onRequest({ request, env, next, waitUntil }) {
  const url = new URL(request.url);
  if (crossSiteWrite(request)) return Response.json({ error: 'This request came from another website and was refused.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const admin = await getAdmin(request, env);
  // The Squad & Staff Data Portal login never opens any admin API.
  if (!admin && !/^\/api\/admin\/(login|logout|invite|password-reset)(\/|$)/.test(url.pathname) && hasPortalCookie(request) && await getPortalSession(request, env, { touch: false })) {
    return Response.json({ error: 'The Squad & Staff Data Portal login only opens the portal.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  // Matchday helpers only use their own screen's APIs.
  if (admin?.helper && !helperMayOpen(admin, url.pathname)) return Response.json({ error: 'Helper accounts only open their own screen.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (admin?.restrict && !/^\/api\/admin\/(account|me|logout|login)(\/|$)/.test(url.pathname)) {
    return Response.json({ error: admin.restrict === 'password' ? 'Please choose a new password first (My account).' : 'Please set up two-step login first (My account).', restrict: admin.restrict }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
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
