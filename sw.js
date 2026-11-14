// Service worker: permite usar la app sin conexión (p. ej. en el rocódromo sin cobertura).
const CACHE = 'escalada-v13';
const ASSETS = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  './js/app.js', './js/db.js', './js/model.js', './js/insights.js', './js/charts.js', './js/demo.js', './js/sharma.js', './js/icons.js', './js/schedule.js', './js/notes.js', './js/shareimg.js',
  './data/sharma.json', './data/events.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Red primero (para recibir actualizaciones) y caché como respaldo.
// Solo gestiona archivos propios y las fuentes; los datos de la sala los guarda la app.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (e.request.method !== 'GET' || (!own && !fonts)) return;
  // «no-cache»: pregunta siempre al servidor si hay versión nueva (evita mezclar archivos viejos y nuevos).
  e.respondWith(fetch(e.request, own ? { cache: 'no-cache' } : {}).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
