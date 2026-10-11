// Staff notifications (scope /admin/, registered only by staff who turn them on).
//  - Kitchen alerts (Kitchen Screen, /admin/kitchen/): the push carries the
//    order ticket (encrypted end to end), stays on screen until tapped,
//    vibrates, and tells any open Kitchen Screen to refresh at once.
//  - Other food alerts (live order board "Enable notifications"): the push is
//    empty; this asks the website for the newest alert and shows it.
// Nothing is cached: the admin and every /api/ request always go to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const ICON = '/images/icon-192.png';

async function tellWindows(message) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of wins) w.postMessage(message);
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = null;
    try { data = event.data ? event.data.json() : null; } catch { data = null; }
    if (data && data.kind === 'kitchen') {
      await self.registration.showNotification(data.title || '🍽️ New paid order', {
        body: data.body || '', tag: data.ref ? `kitchen-${data.ref}` : 'kitchen', renotify: true,
        requireInteraction: data.attempt !== 'test', vibrate: [300, 100, 300, 100, 300],
        icon: ICON, badge: ICON, data: { url: data.url || '/admin/kitchen/' },
      });
      await tellWindows({ type: 'kitchen-push', ref: data.ref || null, attempt: data.attempt || '' });
      return;
    }
    let title = '🍽️ New food order', body = 'Open the live order board.', tag = 'food', urgent = true;
    try {
      const r = await fetch('/api/admin/food-alerts?latest=1', { credentials: 'include', cache: 'no-store' });
      const d = await r.json();
      if (d.alert) { title = d.alert.title; body = d.alert.body; tag = `food-${d.alert.kind}-${d.alert.ref}`; urgent = d.alert.kind !== 'unpaid'; }
    } catch { /* show the general message */ }
    await self.registration.showNotification(title, {
      body, tag, renotify: true, requireInteraction: urgent,
      icon: ICON, badge: ICON,
      vibrate: urgent ? [300, 120, 300, 120, 600] : [150],
      data: { url: '/admin/food-orders/live/' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin/food-orders/live/';
  const kitchen = url.includes('/admin/kitchen');
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find(w => w.url.includes(kitchen ? '/admin/kitchen' : '/admin/food-orders/live'));
    if (open) { await open.focus(); open.postMessage({ type: 'kitchen-push', open: url }); return; }
    return self.clients.openWindow(url);
  })());
});
