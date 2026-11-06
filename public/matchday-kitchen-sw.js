// MatchDay Kitchen staff app: service worker, served as /matchday-kitchen/sw.js
// (functions/matchday-kitchen/[[path]].js), so it only looks after the kitchen
// staff area. Pages and the API always come from the network (orders must be
// live); the app's scripts, styles and pictures are kept for a fast start; with
// no connection a "no connection" screen shows instead of a browser error.
const STATIC = 'mk-static-v1';
const ICON = '/images/matchday-kitchen/icon-192.png';
const OFFLINE = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No connection | MatchDay Kitchen</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07471a;color:#fff;font:18px/1.5 Arial,Helvetica,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
.c{max-width:420px}h1{font-size:28px;margin:12px 0 8px}button{margin-top:18px;min-height:56px;padding:0 28px;border:0;border-radius:12px;background:#fff;color:#07471a;font-weight:bold;font-size:18px;cursor:pointer}</style></head>
<body><div class="c"><div style="font-size:56px" aria-hidden="true">📶</div><h1>No connection</h1><p>The MatchDay Kitchen app needs the internet to show live orders. Check the Wi-Fi or mobile data, then try again.</p>
<button onclick="location.reload()">Try again</button></div><script>addEventListener('online',()=>location.reload())</script></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('mk-') && k !== STATIC) await caches.delete(k);
  await self.clients.claim();
})()));

// Order alerts, even when the app is closed. Tapping one opens the right page of the app.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
    await self.registration.showNotification(d.title || '🍽️ New MatchDay Kitchen order', {
      body: d.body || 'Open MatchDay Kitchen.', tag: d.ref ? `kitchen-${d.ref}` : 'kitchen', renotify: true,
      requireInteraction: d.attempt !== 'test' && d.loud !== false, silent: d.loud === false, vibrate: d.loud === false ? [] : [300, 100, 300, 100, 500], icon: ICON, badge: ICON,
      data: { url: d.url || '/matchday-kitchen/' },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/matchday-kitchen/', location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // The app's main window (the pages inside its tabs are frames).
    const win = wins.find(w => w.frameType === 'top-level' && new URL(w.url).pathname.startsWith('/matchday-kitchen'));
    if (win) { await win.focus(); win.postMessage({ type: 'mk-open', page: url.searchParams.get('open') || '' }); return; }
    await self.clients.openWindow(url.href);
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Kitchen pages: always live; a friendly screen when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  // Built scripts/styles (names change with every update) and kitchen pictures: cache first.
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/images/matchday-kitchen/')) {
    e.respondWith(caches.open(STATIC).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
  // Everything else (the API: orders, menu, sign-in) goes straight to the network.
});
