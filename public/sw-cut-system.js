/* CUT SYSTEM service worker — network-only navigations, no stale HTML cache. */
const APP_ID = 'cut-system';
const VERSION = 'cut-system-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(`${APP_ID}-`) && key !== VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nested staff app owns /employee-portal*; never intercept those navigations.
  if (url.pathname === '/employee-portal' || url.pathname.startsWith('/employee-portal/')) {
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response('CUT SYSTEM is offline. Reconnect and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
      ),
    );
  }
});
