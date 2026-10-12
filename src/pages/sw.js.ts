// /sw.js -- the service worker that makes the site an installable app.
//
// Rules (an earlier version cached the homepage and froze it, so this one is careful):
//  - Pages are NEVER cached: they always come fresh from the network (scores,
//    fixtures, tickets and commentary are live). Only when the phone is
//    offline is the small "You're offline" page shown instead.
//  - Only static files are cached: the hashed /_astro/ files, images, icons
//    and fonts. Never /api/, /data/, /admin, /scan, documents or other sites.
//  - Each deployment gets a new cache name; old caches are deleted.
//  - Shows fans' match alerts (push) and opens the right page when tapped.
//  - Match Day Programme page images (/api/programme/<slug>/page/<n>.jpg?v=)
//    are kept for offline reading (cache-first; each upload has a new ?v=
//    address). The PDF and every other /api answer are never cached. Signing
//    out clears them (message 'clear-programme-pages').
export const prerender = true;

const VERSION = Date.now().toString(36);

const worker = `// Lobi Stars FC service worker (build ${VERSION}). See src/pages/sw.js.ts.
const STATIC = 'ls-static-${VERSION}';
const OFFLINE = '/offline/';
const PRECACHE = [OFFLINE, '/images/icon-192.png', '/images/lobi-stars-fc.jpg', '/manifest.json'];
const MAX_ITEMS = 160;
const PROGRAMME = 'programme-pages-v1';
const PROGRAMME_PAGE = /^\\/api\\/programme\\/[a-z0-9-]+\\/page\\/[1-4]\\.jpg$/;
const NEVER = /^\\/(api|data|admin|scan|documents|functions)(\\/|$)|^\\/(sw|admin-sw|track)\\.js$/;
const STATIC_FILE = /^\\/(_astro|images|fonts)\\/|\\.(png|jpe?g|webp|gif|svg|ico|woff2?)$|^\\/manifest\\.json$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== STATIC && key !== PROGRAMME) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ITEMS; i++) if (!PRECACHE.includes(new URL(keys[i].url).pathname)) await cache.delete(keys[i]);
}

// Match alerts for fans (kick-off, goals, radio show on air…), turned on with "🔔 Match alerts".
self.addEventListener('push', event => {
  let d = null;
  try { d = event.data ? event.data.json() : null; } catch (e) { d = null; }
  if (!d || d.kind !== 'match') return;
  event.waitUntil(self.registration.showNotification(d.title || 'Lobi Stars FC', {
    body: d.body || '', tag: d.tag || 'match', renotify: true,
    icon: '/images/icon-192.png', badge: '/images/icon-192.png', vibrate: [200, 100, 200],
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find(w => w.url === url);
    if (same) return same.focus();
    return self.clients.openWindow(url);
  })());
});

// Signing out of the programme removes the saved pages from this device.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'clear-programme-pages') event.waitUntil(caches.delete(PROGRAMME));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Programme pages: from the cache when saved (works offline), otherwise saved after loading.
  if (url.origin === self.location.origin && PROGRAMME_PAGE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(PROGRAMME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;

  // Pages: always the network; the offline page only when there is no connection.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  if (!STATIC_FILE.test(url.pathname) || req.headers.has('range')) return;

  // Static files: from the cache straight away, refreshed in the background.
  event.respondWith((async () => {
    const cache = await caches.open(STATIC);
    const cached = await cache.match(req);
    const fresh = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { cache.put(req, res.clone()).then(() => trim(cache)); }
      return res;
    }).catch(() => cached || Response.error());
    // Hashed build files never change, so a cached copy is always right.
    if (cached) { if (!url.pathname.startsWith('/_astro/')) event.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh;
  })());
});
`;

export function GET() {
  return new Response(worker, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
}
