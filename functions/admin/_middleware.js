import { getAdmin } from '../api/_lib/adminSession.js';
import { allowedPath, loadRoles, roleLabel } from '../api/_lib/adminRoles.js';
import { withSecurityHeaders } from '../api/_lib/securityHeaders.js';

// Every /admin page (the CMS, Manage Matches, Analytics...) needs a staff
// login. Visitors without a valid staff cookie are sent to /admin/login, and
// staff are only let into the screens their role allows (others see a
// friendly "You don't have access" page).
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
  if (admin) await loadRoles(env.DB);
  if (admin && !allowedPath(admin, url.pathname)) {
    const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    withSecurityHeaders(h);
    return new Response(deniedPage(admin), { status: 403, headers: h });
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Cache-Control', 'no-store');
  withSecurityHeaders(out.headers);
  return out;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function deniedPage(admin) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No access | Lobi Stars Admin</title><meta name="robots" content="noindex,nofollow">
<style>
  :root { --bg: #F4F5F7; --card: #fff; --ink: #15181D; --muted: #5B6470; --red: #E31E24; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0F1115; --card: #181B21; --ink: #F2F4F7; --muted: #A3ABB6; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 460px; background: var(--card); border-radius: 14px; padding: 32px 28px; box-shadow: 0 10px 30px rgba(0,0,0,.08); text-align: center; }
  .i { font-size: 44px; } h1 { margin: 8px 0 10px; font-size: 24px; } p { color: var(--muted); margin: 0 0 14px; }
  a.b { display: inline-block; margin-top: 8px; padding: 11px 20px; border-radius: 8px; background: var(--red); color: #fff; text-decoration: none; font-weight: 700; }
</style></head><body><main>
<div class="i" aria-hidden="true">🔒</div>
<h1>You don't have access to this section</h1>
<p>You're signed in as <strong>${esc(admin.name)}</strong> (${esc(roleLabel(admin))}). Your role doesn't include this screen.</p>
<p>If you need it for your work, ask a Super Admin to change your role.</p>
<a class="b" href="/admin/dashboard/">Back to the dashboard</a>
</main></body></html>`;
}
