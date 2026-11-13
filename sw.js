// Service worker: permite usar la app sin conexión (p. ej. en el rocódromo sin cobertura).
const CACHE = 'escalada-v1';
const ASSETS = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/db.js', './js/model.js', './js/insights.js', './js/charts.js', './js/demo.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Red primero (para recibir actualizaciones) y caché como respaldo.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
