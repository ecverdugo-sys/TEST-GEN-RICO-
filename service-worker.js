const CACHE_NAME = 'cuestionario-temas-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './A1_GENERAL_2020-23__DEFINITIVO REVISADO.txt',
  './A2_GENERAL_2020-23.txt',
  './C1_GENERAL_2020-23.txt',
  './C1_ESPECÍFICO_2020-23.txt',
  './PSICOLOGIA_2020-23__DEFINITIVO REVISADO.txt',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Navegación: app usable sin conexión
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(event.request);
          return network;
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match('./index.html');
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  const isTxt = url.pathname.endsWith('.txt');

  // TXT: estrategia red-primero con copia en caché "canónica" (sin query)
  if (isTxt) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const urlNoSearch = new URL(event.request.url);
        urlNoSearch.search = '';
        const cacheKey = urlNoSearch.toString();

        try {
          const networkResponse = await fetch(event.request);
          cache.put(cacheKey, networkResponse.clone());
          return networkResponse;
        } catch (err) {
          const cached = await cache.match(cacheKey);
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Resto de recursos: caché-primero
  if (APP_SHELL.some(path => url.pathname.endsWith(path.replace('./','/')))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
