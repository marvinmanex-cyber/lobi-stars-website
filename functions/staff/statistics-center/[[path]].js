// /staff/statistics-center/ -- the Lobi Stars Statistics Center page (src/pages/staff/statistics-center/index.astro),
// served with strict security headers: no framing, a tight Content Security Policy, HSTS, no referrer, never
// indexed, never cached; no camera or microphone. (More specific than functions/staff/[[path]].js, which serves
// the IT Center and answers "not found" for any other /staff/ address.)
const HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com', "img-src 'self' data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // The app page, and the BST Analysis Form addresses it opens on: /bst-analysis/, /bst-analysis/<id>/,
  // /bst-analysis/<id>/print/ and /bst-analysis/blank/ (the app reads the address).
  const path = url.pathname.replace(/\/+$/, '');
  if (!/^\/staff\/statistics-center(\/bst-analysis(\/(blank|[A-Za-z0-9_-]{6,40}(\/(print|summary))?))?)?$/.test(path)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' } });
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
  const res = await env.ASSETS.fetch(new URL('/staff/statistics-center/', url));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  return out;
}
