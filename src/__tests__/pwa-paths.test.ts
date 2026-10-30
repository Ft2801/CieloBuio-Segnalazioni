import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";

const ROOT = process.cwd();
const registro = readFileSync(path.join(ROOT, "public", "sw-register.js"), "utf8");
const serviceWorker = readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "public", "manifest.json"), "utf8")) as {
  id: string;
  start_url: string;
  scope: string;
};

// Lo stesso bundle deve funzionare alla radice del server e sotto un
// sottopercorso Pages; in nessun caso deve registrare il worker del dominio.
describe.each(["/", "/CieloBuio-Segnalazioni/"])("PWA nello scope %s", (base) => {
  it("risolve manifest, start_url, scope e id all'interno dell'app", () => {
    const manifestUrl = new URL(`https://example.test${base}manifest.json`);
    for (const valore of [manifest.start_url, manifest.scope, manifest.id]) {
      expect(new URL(valore, manifestUrl).pathname).toBe(base);
    }
  });

  it("registra il service worker nello scope dell'app e non alla root del dominio", () => {
    const register = vi.fn(async () => ({ addEventListener: vi.fn() }));
    let onLoad: (() => void) | undefined;
    runInNewContext(registro, {
      URL,
      document: { currentScript: { src: `https://example.test${base}sw-register.js` } },
      window: {
        location: { href: `https://example.test${base}?v=dashboard` },
        addEventListener: (name: string, handler: () => void) => {
          if (name === "load") onLoad = handler;
        },
      },
      navigator: { serviceWorker: { register, controller: null } },
      console,
    });
    expect(onLoad).toBeDefined();
    onLoad?.();
    expect(register).toHaveBeenCalledWith(`${base}sw.js`, {
      scope: base,
      updateViaCache: "none",
    });
  });

  it("precache e fallback offline restano nello scope, senza eliminare cache di altre app", async () => {
    const cachePrefix = `cielobuio-assets-${encodeURIComponent(base)}-`;
    const cacheName = `${cachePrefix}1.0.0`;
    type Evento = { waitUntil: (promise: Promise<unknown>) => void };
    const listeners = new Map<string, (event: Evento) => void>();
    const add = vi.fn(async () => undefined);
    const del = vi.fn(async () => true);
    const caches = {
      open: vi.fn(async () => ({ add })),
      keys: vi.fn(async () => [
        "altra-app",
        "cielobuio-assets-%2Faltra-app%2F-1.0.0",
        `${cachePrefix}scaduta`,
        cacheName,
      ]),
      delete: del,
      match: vi.fn(async (url: Request | string) => (url === base ? new Response("offline") : undefined)),
    };
    runInNewContext(serviceWorker, {
      URL,
      Response,
      caches,
      self: {
        registration: { scope: `https://example.test${base}` },
        location: { origin: "https://example.test" },
        addEventListener: (name: string, handler: (event: Evento) => void) => listeners.set(name, handler),
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn() },
      },
      console,
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    let lavoro: Promise<unknown> | undefined;
    listeners.get("install")?.({ waitUntil: (promise) => (lavoro = promise) });
    await lavoro;
    expect(add).toHaveBeenCalledWith(base);
    expect(add).toHaveBeenCalledWith(`${base}manifest.json`);

    listeners.get("activate")?.({ waitUntil: (promise) => (lavoro = promise) });
    await lavoro;
    expect(del).toHaveBeenCalledWith(`${cachePrefix}scaduta`);
    expect(del).not.toHaveBeenCalledWith("altra-app");
    expect(del).not.toHaveBeenCalledWith("cielobuio-assets-%2Faltra-app%2F-1.0.0");
    expect(del).not.toHaveBeenCalledWith(cacheName);

    let risposta: Promise<Response> | undefined;
    const navigazione = {
      request: {
        url: `https://example.test${base}?v=lista`,
        cache: "default",
        mode: "navigate",
        method: "GET",
      },
      respondWith: (promise: Promise<Response>) => (risposta = promise),
    };
    listeners.get("fetch")?.(navigazione as unknown as Evento);
    expect((await risposta)?.status).toBe(200);
    expect(caches.match).toHaveBeenCalledWith(base);
  });
});
