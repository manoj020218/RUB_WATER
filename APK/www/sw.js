const CACHE_NAME = 'floodguard-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './app.css',
  './app-icon-192.png',
  './floodguard-logo.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => clients.claim())
  );
});

// Static app shell: cache-first. All other requests (API calls to VPS): network only.
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith(self.location.origin)) return; // let API calls pass through
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
