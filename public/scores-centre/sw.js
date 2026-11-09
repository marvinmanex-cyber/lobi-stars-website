// Scores Update Centre app (scope /scores-centre/): keeps the page and its fonts on the phone so it
// still opens when the stadium's mobile data drops. Scores are never cached: /api/ always goes to the
// network (updates made with no signal wait on the phone and are sent when it returns; see the page).
const CACHE = 'scores-centre-v1';
const FILES = ['/scores-centre/', '/scores-centre/manifest.webmanifest', '/images/scores-centre/icon-192.png', '/images/lobi-stars-badge.webp',
  '/fonts/bebas-neue-400.woff2', '/fonts/barlow-400.woff2', '/fonts/barlow-600.woff2', '/fonts/barlow-700.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('scores-centre-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // The page: always the newest when online, the saved copy when not.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/scores-centre/', copy)); } return res; }).catch(() => caches.match('/scores-centre/')));
    return;
  }
  if (FILES.includes(url.pathname)) e.respondWith(caches.match(url.pathname).then(hit => hit || fetch(req)));
});
