// Bump VERSION on every deploy so clients pick up the new app shell.
const VERSION = 'v3.0.0';
const CACHE = `yroster-${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './app.js', './roster.json',
  './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  // Not calling skipWaiting() here: the page shows an "Update available" prompt instead.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('yroster-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Only handle same-origin GETs. ESPN calls are handled (with timeout + local cache) by the app itself.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads: serve cached shell instantly, refresh in background; offline falls back to the shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const net = fetch(request).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const net = fetch(request).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
