// Staff notifications for in-seat food orders (registered only by staff who
// press "Enable notifications" in the admin, with scope /admin/). The push
// message itself is empty: this asks the website for the newest alert and
// shows it. Nothing is cached, so the admin always loads fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let title = '🍽️ New food order', body = 'Open the live order board.', tag = 'food', urgent = true;
    try {
      const r = await fetch('/api/admin/food-alerts?latest=1', { credentials: 'include', cache: 'no-store' });
      const d = await r.json();
      if (d.alert) { title = d.alert.title; body = d.alert.body; tag = `food-${d.alert.kind}-${d.alert.ref}`; urgent = d.alert.kind !== 'unpaid'; }
    } catch { /* show the general message */ }
    await self.registration.showNotification(title, {
      body, tag, renotify: true, requireInteraction: urgent,
      icon: '/images/icon-192.png', badge: '/images/icon-192.png',
      vibrate: urgent ? [300, 120, 300, 120, 600] : [150],
      data: { url: '/admin/food-orders/live/' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin/food-orders/live/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find(w => w.url.includes('/admin/food-orders/live'));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
