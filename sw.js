// ============================================================
//  TUTEL SIGHTINGS — sw.js
//  Strategy: network-first with cache fallback for all assets.
// ============================================================

const CACHE_NAME = 'tutel-v1';

// Assets to pre-cache on install (app shell)
const PRECACHE = [
  '/tutel-sightings/',
  '/tutel-sightings/index.html',
  '/tutel-sightings/style.css',
  '/tutel-sightings/script.js',
  '/tutel-sightings/data/appearances.json',
  '/tutel-sightings/data/colors.json',
  '/tutel-sightings/stats/',
  '/tutel-sightings/stats/index.html',
  '/tutel-sightings/stats/style.css',
  '/tutel-sightings/stats/script.js',
];

// ── Install: pre-cache the app shell ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache ──────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Let cross-origin requests (fonts, CDN scripts, YouTube) pass through
  // untouched — we don't cache or intercept those
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Network succeeded — update the cache with the fresh response
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() =>
        // Network failed — serve from cache if available
        caches.match(event.request)
      )
  );
});
