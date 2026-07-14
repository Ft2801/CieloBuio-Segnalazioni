/**
 * Service worker minimale per CieloBuio.
 *
 * Strategia: cache-first per asset statici, network-first per le API.
 * Non fa caching aggressivo per evitare problemi di dati stale in un'app
 * con dati che cambiano frequentemente.
 *
 * L'obiettivo principale è rendere l'app installabile come PWA e dare un
 * fallback minimo per l'uso offline (shell dell'app).
 *
 * Affidabilità:
 *  - precache tollerante: se un URL fallisce, gli altri vengono comunque
 *    precached (cache.addAll rigetterebbe l'intera installazione).
 *  - fallback di navigazione con risposta 503 esplicita se la cache è
 *    vuota, evitando "responded with undefined value" errors.
 *  - limita la cache a 100 entry per asset statici (LRU approssimato)
 *    per evitare crescita illimitata.
 */

const CACHE_NAME = "cielobuio-v1";
const PRECACHE_URLS = ["/", "/manifest.json"];
const MAX_CACHE_ENTRIES = 100;

self.addEventListener("install", (event) => {
  // Precache tollerante: se un URL fallisce (es. /manifest.json 404 in
  // dev), cache.addAll rigetterebbe l'intera installazione. Usiamo
  // Promise.all con cache.add individuale che ignora i fallimenti,
  // così l'SW si attiva anche se un asset non è disponibile.
  event.waitUntil(
    Promise.all(
      PRECACHE_URLS.map((url) =>
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.add(url))
          .catch((err) => console.warn("[SW] Precache fallito per", url, err))
      )
    )
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

  // Rispetta cache: "no-store": non cachiamo richieste che lo sviluppatore
  // ha esplicitamente marcato come non-cachabili.
  if (event.request.cache === "no-store") {
    return;
  }

  // Per navigazioni: prova network, fallback cache, fallback offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match("/");
          if (fallback) return fallback;
          // Cache vuota: ritorna una risposta 503 esplicita invece di
          // undefined, che causerebbe "FetchEvent responded with an
          // undefined value" e una pagina rotta.
          return new Response(
            "Offline: applicazione non disponibile senza connessione al server.",
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }
      })()
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
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              // LRU eviction: se la cache supera MAX_CACHE_ENTRIES,
              // rimuovi la entry più vecchia (prime insertita).
              cache.keys().then((keys) => {
                if (keys.length > MAX_CACHE_ENTRIES) {
                  cache.delete(keys[0]);
                }
              });
            });
          }
          return response;
        });
      })
    );
  }
});
