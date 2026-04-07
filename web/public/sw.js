// Ashbi Hub Service Worker
const CACHE_NAME = 'hub-v2';
const STATIC_CACHE = 'hub-static-v2';
const API_CACHE = 'hub-api-v2';

// App shell files to cache on install
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: strategy depends on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets (JS, CSS, images): cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML navigation: network-first (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request, CACHE_NAME));
});

// Push notification handler
self.addEventListener('push', (event) => {
  let data = { title: 'Ashbi Hub', body: 'New notification' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data?.text() || data.body;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Ashbi Hub', {
      body: data.body || data.message || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'hub-notification',
      data: data.data || {},
    })
  );
});

// Notification click: open Hub
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// --- Strategies ---

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback();
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return offlineFallback();
    return new Response('Offline', { status: 503 });
  }
}

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico)(\?.*)?$/.test(pathname);
}

function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline - Ashbi Hub</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.container{text-align:center;padding:2rem}
h1{color:#3b82f6;font-size:2rem}
p{color:#94a3b8;margin-top:1rem}
button{margin-top:1.5rem;padding:.75rem 1.5rem;background:#3b82f6;color:white;border:none;border-radius:.5rem;font-size:1rem;cursor:pointer}
button:hover{background:#2563eb}
</style></head>
<body><div class="container">
<h1>📡 You're Offline</h1>
<p>Ashbi Hub needs an internet connection. Check your connection and try again.</p>
<button onclick="location.reload()">Retry</button>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
