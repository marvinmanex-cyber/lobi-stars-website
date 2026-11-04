// Gate Control app (served at /gate-control/sw.js, scope /gate-control/): keeps the page,
// its scripts, styles, fonts and the camera scanner on the phone so Gate Control still
// opens when the stadium's mobile data drops. Ticket data is never cached here (the page
// keeps today's ticket list itself); /api/ always goes to the network.
const CACHE = 'gate-control-v6';
const EXTRA = ['/vendor/jsqr-1.4.0.min.js', '/images/gate-control/logo-640.webp', '/images/gate-control/icon-192.png', '/gate-control.webmanifest',
  '/fonts/bebas-neue-400.woff2', '/fonts/barlow-400.woff2', '/fonts/barlow-600.woff2', '/fonts/barlow-700.woff2', '/fonts/barlow-condensed-700.woff2'];

// Saves the page and every script / style it uses (their names change with each update).
async function savePage(cache, res) {
  const html = await res.clone().text();
  await cache.put('/gate-control/', res);
  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map(m => m[1]))];
  await Promise.all(files.map(u => cache.match(u).then(hit => hit || cache.add(u)).catch(() => {})));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { const res = await fetch('/gate-control/', { cache: 'no-store' }); if (res.ok) await savePage(c, res); } catch { /* offline: next time */ }
    await Promise.all(EXTRA.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gate-control-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // The page: always the newest when online (and saved with its files); the saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => savePage(c, copy)).catch(() => {})); }
      return res;
    }).catch(() => caches.match('/gate-control/', { ignoreVary: true })));
    return;
  }
  // Scripts, styles, fonts and images: from the phone once saved.
  if (/^\/(_astro|vendor|fonts|images)\//.test(url.pathname) || url.pathname === '/gate-control.webmanifest') {
    e.respondWith(caches.match(req, { ignoreVary: true, ignoreSearch: url.pathname.startsWith('/images/') }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
