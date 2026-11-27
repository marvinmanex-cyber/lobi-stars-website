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

// Install as an app on a phone or tablet (home-screen icon, full screen).
const MANIFEST = {
  id: '/staff/statistics-center/', name: 'Lobi Stars Statistics Center', short_name: 'Lobi Stats', orientation: 'any', lang: 'en-GB', start_url: '/staff/statistics-center/', scope: '/staff/statistics-center/', display: 'standalone',
  background_color: '#142E5A', theme_color: '#1C3F7A', description: 'Match statistics, event by event (Lobi Stars FC staff).',
  icons: [{ src: '/images/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
};
// Keeps the page and its files so it opens without a connection (taps are already kept on the device by the app).
// Never stores API answers: data always comes fresh from the server.
const SW = `const C = 'sx-shell-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.add('/staff/statistics-center/'))); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate' && u.pathname.startsWith('/staff/statistics-center/') && !u.pathname.includes('/share/')) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok && u.pathname === '/staff/statistics-center/') caches.open(C).then(c => c.put('/staff/statistics-center/', r.clone())); return r; })
      .catch(() => caches.match('/staff/statistics-center/')));
    return;
  }
  if (u.pathname.startsWith('/_astro/') || u.pathname.startsWith('/images/')) e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) caches.open(C).then(c => c.put(e.request, r.clone())); return r; })));
});`;

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // The app page, and the BST Analysis Form addresses it opens on: /bst-analysis/, /bst-analysis/<id>/,
  // /bst-analysis/<id>/print/ and /bst-analysis/blank/ (the app reads the address).
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/staff/statistics-center/manifest.webmanifest') return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' } });
  if (path === '/staff/statistics-center/sw.js') return new Response(SW, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/staff/statistics-center/', 'X-Robots-Tag': 'noindex' } });
  if (!/^\/staff\/statistics-center(\/bst-analysis(\/(blank|[A-Za-z0-9_-]{6,40}(\/(print|summary))?))?)?$/.test(path)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' } });
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
  const res = await env.ASSETS.fetch(new URL('/staff/statistics-center/', url));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
  return out;
}
