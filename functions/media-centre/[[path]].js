// /media-centre and everything under it (/media-centre/login, /media-centre/news/...):
// the one Media Centre page (built at /media-centre/), which shows the right
// screen for the address. Strict security headers: never framed by another
// site, a tight Content Security Policy, never indexed, never cached.
export const MEDIA_CENTRE_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.pathname === '/media-centre') return Response.redirect(`${url.origin}/media-centre/${url.search}`, 301);
  if (!/^\/media-centre\/[a-z0-9/_-]*$/i.test(url.pathname)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' } });
  const res = url.pathname === '/media-centre/' ? await next() : await env.ASSETS.fetch(new URL('/media-centre/', url));
  const out = new Response(res.body, { status: res.ok ? 200 : res.status, headers: res.headers });
  for (const [k, v] of Object.entries(MEDIA_CENTRE_HEADERS)) out.headers.set(k, v);
  out.headers.delete('Content-Length');
  return out;
}
