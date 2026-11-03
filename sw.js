const VERSION = 'stamp-studio-v1.0.2';
const PREFIX = 'stamp-studio-';
const ASSETS = ['./', './index.html', './style.css', './app.js', './core.js', './db.js', './pwa.js', './manifest.json', './vendor/jszip.min.js', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const manifestURL = new URL('./manifest.json', self.registration.scope).href;

self.addEventListener('install', event => event.waitUntil((async () => {
  try {
    const cache = await caches.open(VERSION);
    // Revalidate all shell resources instead of installing stale HTTP cache entries.
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
  } catch (error) {
    // Leave the active version intact if any new asset cannot be downloaded.
    await caches.delete(VERSION);
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.registration.scope)) {
        client.postMessage({ type: 'CACHE_ERROR', message: `${error.name}: ${error.message}` });
      }
    }
    throw error;
  }
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith(PREFIX) && key !== VERSION) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  // Activation follows the user's explicit save-and-update action.
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Chrome must be able to discover an updated manifest; retain an offline fallback.
    if (url.href.split('?')[0] === manifestURL) {
      try {
        const response = await fetch(new Request(event.request, { cache: 'no-cache' }));
        if (response.ok) {
          await cache.put(manifestURL, response.clone());
          return response;
        }
      } catch { /* Use the installed manifest offline. */ }
    }
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return cache.match('./index.html');
    return fetch(event.request);
  })());
});
