/* CUT STAFF service worker — scoped to /employee-portal, network-only HTML. */
const APP_ID = 'cut-staff';
const VERSION = 'cut-staff-v1';

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

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response('CUT STAFF is offline. Reconnect and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
      ),
    );
  }
});
