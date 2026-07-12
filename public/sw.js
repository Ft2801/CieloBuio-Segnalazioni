/**
 * Service worker minimale per CieloBuio.
 *
 * Strategia: cache-first per asset statici, network-first per le API.
 * Non fa caching aggressivo per evitare problemi di dati stale in un'app
 * con dati che cambiano frequentemente.
 *
 * L'obiettivo principale è rendere l'app installabile come PWA e dare un
 * fallback minimo per l'uso offline (shell dell'app).
 */

const CACHE_NAME = "cielobuio-v1";
const PRECACHE_URLS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Non interferire con API calls e navigazioni
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Per navigazioni: prova network, fallback cache, fallback offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((r) => r || caches.match("/"))
      )
    );
    return;
  }

  // Per asset statici: cache-first
  if (event.request.method === "GET") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
