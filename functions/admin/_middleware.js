import { getAdmin } from '../api/_lib/adminSession.js';
import { allowedPath, loadRoles, roleLabel, cmsConfigFor } from '../api/_lib/adminRoles.js';
import { withSecurityHeaders } from '../api/_lib/securityHeaders.js';
import { ADMIN_PAGE_HEADERS, securitySettings } from '../api/_lib/adminSecurity.js';
import { helperMayOpen } from '../api/_lib/helpers.js';
import { hasPortalCookie, getPortalSession } from '../api/_lib/squadPortal.js';

// Every /admin page (the CMS, Manage Matches, Analytics...) needs a staff
// login. Visitors without a valid staff cookie are sent to /admin/login, and
// staff are only let into the screens their role allows (others see a
// friendly "You don't have access" page).
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  // The login page and the invite / password-reset page (the emailed link is the key) open without signing in.
  const isLoginPage = /^\/admin\/(login|invite)\/?$/.test(url.pathname);
  const admin = isLoginPage ? null : await getAdmin(request, env);

  // The Squad & Staff Data Portal login never opens the admin back end.
  if (!admin && !isLoginPage && hasPortalCookie(request) && await getPortalSession(request, env, { touch: false })) {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>No access</title><p style="font:16px/1.5 sans-serif;padding:24px">The Squad &amp; Staff Data Portal login only opens the portal. It has no access to any other part of the website.</p>',
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (!isLoginPage && !admin) {
    const login = new URL('/admin/login/', url);
    login.searchParams.set('next', url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: login.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  // Matchday helpers only see their one screen.
  if (admin?.helper && !helperMayOpen(admin, url.pathname)) {
    return new Response(null, { status: 302, headers: { Location: new URL(admin.screen, url).toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  // Must choose a new password or set up two-step login first: only My account opens.
  if (admin?.restrict && !/^\/admin\/account(\/|$)/.test(url.pathname)) {
    return new Response(null, { status: 302, headers: { Location: new URL(`/admin/account/?must=${admin.restrict}`, url).toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (admin) await loadRoles(env.DB);
  if (admin && !allowedPath(admin, url.pathname)) {
    const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    adminHeaders(h);
    return new Response(deniedPage(admin, url), { status: 403, headers: h });
  }

  const res = await next();
  // The content CMS reads its list of sections from config.yml: each person gets only the sections they may edit.
  if (admin && /^\/admin\/config\.yml$/.test(url.pathname) && res.ok) {
    const h = new Headers({ 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    const predictNeedsApproval = (await securitySettings(env.DB)).approvals_predict !== '0';
    return new Response(cmsConfigFor(admin, await res.text(), { predictNeedsApproval }), { status: 200, headers: adminHeaders(h) });
  }
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Cache-Control', 'no-store');
  adminHeaders(out.headers);
  return out;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function deniedPage(admin, url) {
  // Opened from a Match Checklist task ("Go to task"): offer the way back to it.
  const task = url?.searchParams.get('from') === 'checklist' ? Number(url.searchParams.get('task')) : 0;
  const back = Number.isInteger(task) && task > 0
    ? `<a class="b" href="/admin/match-checklist/?task=${task}#task-${task}">Back to checklist</a> `
    : '';
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
${back}<a class="b" href="/admin/dashboard/">Back to the dashboard</a>
</main></body></html>`;
}

// Admin pages: no framing by any website, scripts only from this site and the
// listed libraries (CMS, charts, the human check), plus the usual headers.
function adminHeaders(h) {
  for (const [k, v] of Object.entries(ADMIN_PAGE_HEADERS)) h.set(k, v);
  return withSecurityHeaders(h);
}
