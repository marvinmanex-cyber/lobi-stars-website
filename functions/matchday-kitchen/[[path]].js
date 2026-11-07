// /matchday-kitchen and everything under it. Two built pages:
//   /matchday-kitchen/ and /matchday-kitchen/login/  -> the home screen (sign-in, ticket rail, tabs)
//   every inner page (kitchen, live, orders/<id>, …)  -> the panel page, which draws the page for its address
// Strict security headers: only framed by MatchDay Kitchen itself (the tabs),
// a tight Content Security Policy, never indexed, never cached.
const HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'", "frame-src 'self'",
    "frame-ancestors 'self'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};
const PANEL = /^\/matchday-kitchen\/(kitchen|live|delivery|refunds|reports|sales|alerts|orders|orders\/[A-Za-z0-9_-]{1,60}|menu|analytics|shift|handover|activity|staff|not-available)\/$/;

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  let path = url.pathname;
  // The kitchen staff app's service worker (its scope is the kitchen area only).
  if (path === '/matchday-kitchen/sw.js') {
    const sw = await env.ASSETS.fetch(new URL('/matchday-kitchen-sw.js', url));
    return new Response(sw.body, { status: sw.status, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/matchday-kitchen/', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path === '/matchday-kitchen') return Response.redirect(`${url.origin}/matchday-kitchen/${url.search}`, 301);
  if (!path.endsWith('/') && PANEL.test(`${path}/`)) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
  if (path === '/matchday-kitchen/login') path = '/matchday-kitchen/login/';
  let res;
  if (path === '/matchday-kitchen/') res = await next();
  else if (path === '/matchday-kitchen/login/') res = await env.ASSETS.fetch(new URL('/matchday-kitchen/', url));
  else if (PANEL.test(path)) res = await env.ASSETS.fetch(new URL('/matchday-kitchen/panel/', url));
  else return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' } });
  const out = new Response(res.body, { status: res.ok ? 200 : res.status, headers: res.headers });
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  out.headers.delete('Content-Length');
  return out;
}
