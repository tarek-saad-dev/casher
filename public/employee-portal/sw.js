/* CUT STAFF service worker — scoped to /employee-portal, network-only HTML + Web Push. */
const APP_ID = 'cut-staff';
const VERSION = 'cut-staff-v2-push';

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

self.addEventListener('push', (event) => {
  let data = {
    title: 'حجز جديد لك',
    body: 'تمت إضافة حجز جديد إلى جدولك',
    url: '/employee-portal/bookings',
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: String(parsed.title || data.title),
        body: String(parsed.body || data.body),
        url: String(parsed.url || data.url),
      };
    }
  } catch {
    try {
      const text = event.data ? event.data.text() : '';
      if (text) data.body = text;
    } catch {
      /* keep defaults */
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/cut-staff/icon-192.png',
      badge: '/icons/cut-staff/icon-192.png',
      data: { url: data.url },
      lang: 'ar',
      dir: 'rtl',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/employee-portal/bookings';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client && client.url.includes('/employee-portal')) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
