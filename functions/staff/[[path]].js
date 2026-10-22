import { portalPath, PORTAL_DEFAULT_PATH } from '../api/_lib/squadPortal.js';

// /staff/... -- the Squad & Staff Data Portal page, served at PORTAL_PATH
// (default /staff/squad-data) with strict security headers: no framing, a tight
// Content Security Policy, HSTS, no referrer, never indexed, never cached.
// The camera is allowed on this page (profile photos); the microphone is not
// (name recordings were removed on 22 Oct 2026). Any other /staff/ address is "not found".
export const PORTAL_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const want = portalPath(env);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.toLowerCase() === want.toLowerCase()) {
    if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${want}/${url.search}`, 301);
    const res = want === PORTAL_DEFAULT_PATH ? await next() : await env.ASSETS.fetch(new URL(`${PORTAL_DEFAULT_PATH}/`, url));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(PORTAL_HEADERS)) out.headers.set(k, v);
    return out;
  }
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } });
}
