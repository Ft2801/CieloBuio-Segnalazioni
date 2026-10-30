/**
 * Service worker minimale per CieloBuio.
 *
 * Strategia: cache-first solo per gli asset statici (/_next/static/ e i file
 * elencati in ASSET_PATHS); navigazioni network-first con fallback. Tutte le
 * altre richieste, incluse le API e i payload RSC delle pagine, passano
 * direttamente alla rete senza essere memorizzate: contengono dati personali
 * e dati che cambiano spesso, e non devono essere serviti a un altro utente
 * dello stesso browser.
 *
 * L'obiettivo principale è rendere l'app installabile come PWA e dare un
 * fallback minimo per l'uso offline (shell dell'app).
 *
 * Affidabilità:
 *  - precache tollerante: se un URL fallisce, gli altri vengono comunque
 *    precached (cache.addAll rigetterebbe l'intera installazione).
 *  - fallback di navigazione con risposta 503 esplicita se la cache è
 *    vuota, evitando "responded with undefined value" errors.
 *  - limita la cache a 100 entry per asset statici (eviction FIFO)
 *    per evitare crescita illimitata.
 */

// Lo scope indica la root reale dell'app, anche su Pages sotto /nome-repo/.
// Non intercettare né memorizzare la home o le API di altri progetti
// pubblicati sullo stesso dominio.
const APP_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = `cielobuio-assets-${encodeURIComponent(APP_PATH)}-`;
const CACHE_NAME = `${CACHE_PREFIX}1.0.0`;
const PRECACHE_URLS = [APP_PATH, `${APP_PATH}manifest.json`];
const MAX_CACHE_ENTRIES = 100;
// File statici di public/ memorizzabili in cache (oltre a _next/static/).
const ASSET_PATHS = new Set([`${APP_PATH}manifest.json`, `${APP_PATH}robots.txt`, `${APP_PATH}sw-register.js`]);

function isAssetStatico(url) {
  return url.pathname.startsWith(`${APP_PATH}_next/static/`) || ASSET_PATHS.has(url.pathname);
}

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
          .catch((err) => console.warn("[SW] Precache fallito per", url, err)),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // CacheStorage è condiviso per origine, non per scope. Non rimuovere le
  // cache di altre app sullo stesso dominio GitHub Pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => (k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME) || (APP_PATH === "/" && k === "cielobuio-assets"),
            )
            .map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Le API non vengono mai intercettate
  if (url.pathname.startsWith(`${APP_PATH}api/`)) {
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
          const fallback = await caches.match(APP_PATH);
          if (fallback) return fallback;
          // Cache vuota: ritorna una risposta 503 esplicita invece di
          // undefined, che causerebbe "FetchEvent responded with an
          // undefined value" e una pagina rotta.
          return new Response("Offline: applicazione non disponibile senza connessione al server.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  // Solo asset statici same-origin: cache-first. Il resto va alla rete.
  if (event.request.method === "GET" && url.origin === self.location.origin && isAssetStatico(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              // Eviction FIFO: se la cache supera MAX_CACHE_ENTRIES,
              // rimuovi la entry inserita per prima.
              cache.keys().then((keys) => {
                if (keys.length > MAX_CACHE_ENTRIES) {
                  cache.delete(keys[0]);
                }
              });
            });
          }
          return response;
        });
      }),
    );
  }
});
