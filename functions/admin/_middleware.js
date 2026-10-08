import { hasAdminSession } from '../api/_lib/adminSession.js';

// Every /admin page (the CMS, Manage Matches, Analytics) needs a staff
// login. Visitors without a valid staff cookie are sent to /admin/login.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const isLoginPage = /^\/admin\/login\/?$/.test(url.pathname);

  if (!isLoginPage && !(await hasAdminSession(request, env))) {
    const login = new URL('/admin/login/', url);
    login.searchParams.set('next', url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: login.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
