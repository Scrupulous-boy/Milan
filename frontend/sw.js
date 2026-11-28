/* MILAN service worker */
var CACHE_NAME = 'milan-brand-icons';
var OFFLINE_URL = '/offline.html';
var PRECACHE = [OFFLINE_URL, '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/safari-pinned-tab.svg', '/assets/favicon-192x192.png', '/assets/favicon-512x512.png', '/manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(PRECACHE.map(function (u) {
        return cache.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (/^milan-/i.test(k) && k !== CACHE_NAME) ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || req.headers.has('range') ||
      /\.(mp4|webm|mov|m4v|3gp|m3u8)$/i.test(url.pathname)) return;

  // Versioned JS/CSS (?v=...): cache-first. URL badalta hai to file bhi badalti hai.
  if (/\.(js|css)$/i.test(url.pathname) && /[?&]v=/.test(url.search)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Pages: hamesha network se; offline ho to offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(function () { return fetch(req); })
        .catch(function () { return caches.match(OFFLINE_URL); })
        .then(function (r) { return r || Response.error(); })
    );
  }
});


/* MILAN FORCE FRESH ASSETS */
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* MILAN LOGIN SESSION FIX 20261127074733 */
