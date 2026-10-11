import { getAdmin } from '../api/_lib/adminSession.js';
import { allowedPath } from '../api/_lib/adminRoles.js';

// Every /admin page (the CMS, Manage Matches, Analytics...) needs a staff
// login. Visitors without a valid staff cookie are sent to /admin/login, and
// staff are only let into the screens their role allows (others go to the
// dashboard with a note).
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const isLoginPage = /^\/admin\/login\/?$/.test(url.pathname);
  const admin = isLoginPage ? null : await getAdmin(request, env);

  if (!isLoginPage && !admin) {
    const login = new URL('/admin/login/', url);
    login.searchParams.set('next', url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: login.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  if (admin && !allowedPath(admin, url.pathname)) {
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/admin/dashboard/?denied=1', url).toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
