/* CVF PT service worker.
 *
 * Deploy-safety model: there is NO precache manifest. Vite's content-hashed
 * assets are cached on first use (immutable, cache-first); navigations are
 * network-first so a fresh deploy's index.html always wins while online, and
 * the cached copy is only an offline fallback. __SW_VERSION__ is replaced
 * with a unique build id at build time, so every deploy byte-changes this
 * file — the browser installs the new worker and activate() drops every
 * cache from previous builds.
 */
const VERSION = '__SW_VERSION__';
const SHELL_CACHE = `cvf-shell-${VERSION}`;
const ASSET_CACHE = `cvf-assets-${VERSION}`;
const STATIC_CACHE = `cvf-static-${VERSION}`;
const OWN_CACHES = [SHELL_CACHE, ASSET_CACHE, STATIC_CACHE];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.add('/'))
      .catch(() => {}) // offline install: shell fills in on first online navigation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('cvf-') && !OWN_CACHES.includes(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/');
    if (cached) return cached;
    throw new Error('offline and no cached shell');
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API traffic is never intercepted or cached — always straight to network.
  if (url.pathname.startsWith('/api')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Content-hashed build output: immutable, so cache-first is always correct.
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

// Program 012: web push. Payloads are {title, body, url} only — no chat
// content ever rides a push (same privacy rule as the digest).
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || 'CVF PT';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
