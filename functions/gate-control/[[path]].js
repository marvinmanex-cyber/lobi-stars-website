// /gate-control and /gate-control/login: the Gate Control page (sign-in, gate
// choice, scanner, today's check-ins, records). Strict security headers: the
// camera is allowed for this page only (the ticket scanner), scripts only from
// this website, never framed, never indexed, never cached.
const HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/gate-control' || path === '/gate-control/login') return Response.redirect(`${url.origin}/gate-control/${url.search}`, 301);
  let res;
  if (path === '/gate-control/') res = await next();
  else if (path === '/gate-control/login/') res = await env.ASSETS.fetch(new URL('/gate-control/', url));
  else return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' } });
  const out = new Response(res.body, { status: res.ok ? 200 : res.status, headers: res.headers });
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  out.headers.delete('Content-Length');
  return out;
}
