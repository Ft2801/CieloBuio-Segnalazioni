import "@testing-library/jest-dom/vitest";

// Il logger resta silenzioso nei test: i rami di warning sono verificati tramite spy.
process.env.LOG_LEVEL = "silent";

// La modalità demo è attiva nei test come nella build statica. Il ramo
// disattivato (sistema reale) è verificato in demo-mode-disabilitata.test.ts.
process.env.NEXT_PUBLIC_CIELOBUIO_DEMO = "1";

// Ogni `vi.resetModules()` ricarica il logger Pino, che registra un listener
// `exit` per istanza. Con più reset nello stesso worker Node supera il limite
// di default (10) e stampa MaxListenersExceededWarning. Il limite è alzato solo
// nell'ambiente di test; in produzione il logger viene creato una volta sola.
process.setMaxListeners(Math.max(process.getMaxListeners(), 50));

// jsdom non implementa matchMedia (usato dal tema chiaro/scuro). Il mock
// risponde "tema chiaro" per impostazione predefinita; i test del tema
// sovrascrivono window.matchMedia dove serve.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
