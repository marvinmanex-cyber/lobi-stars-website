// This service worker previously cached '/' and '/index.html' with a
// cache-first strategy and no versioning, so any browser that installed it
// could keep serving a frozen snapshot of the homepage indefinitely,
// regardless of later deployments (including bugfixes to that exact page).
// This version is a kill switch: it takes over immediately, deletes every
// cache it created, and unregisters itself so the browser goes back to
// fetching the page fresh from the network like normal.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(client => client.navigate(client.url));
    })()
  );
});
