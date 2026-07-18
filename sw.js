// InsydeLive Service Worker
// Cross-browser safe: does NOT rely on Background Sync API (unsupported in Safari/iOS).
// Actual write-replay is handled by the page via IndexedDB outbox + 'online' event (see app.js).

const CACHE_VERSION = 'insydelive-v2.0.1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('insydelive-') && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Strategy:
// - Navigation requests: network-first, fall back to cached shell, then offline.html
// - Supabase API calls: network-only (never cache auth/data responses)
// - Static assets (css/js/img/fonts): stale-while-revalidate
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return; // never intercept writes; those go straight to network or fail visibly

  if (url.hostname.includes('supabase.co')) {
    return; // let it hit the network directly; app.js decides how to queue failures
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/index.html') || caches.match('/offline.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Allows the page to trigger an immediate cache refresh after a deploy
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ------------------------------------------------------------
// Web Push — works on Chrome/Firefox/Edge/Android everywhere,
// and on iOS Safari 16.4+ once the app is installed to the home screen.
// ------------------------------------------------------------
/* ============================================================
   WEB PUSH — display a notification when the Edge Function sends one.
   Works on Chrome/Firefox/Edge/Android everywhere; on iOS Safari only
   once the app is installed to the home screen (iOS 16.4+), which is
   a platform restriction, not something this code can change.
   ============================================================ */
self.addEventListener('push', (event) => {
  let payload = { title: 'InsydeLive', body: '', data: {} };
  try { payload = event.data ? event.data.json() : payload; } catch (e) { /* non-JSON payload, use default */ }

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'InsydeLive', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = '/#notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
