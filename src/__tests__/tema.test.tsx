/**
 * Test per il tema chiaro/scuro: modulo src/lib/tema.ts e lo script inline
 * SCRIPT_TEMA_INIZIALE che applica il tema prima del primo rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CHIAVE_TEMA,
  SCRIPT_TEMA_INIZIALE,
  applicaTema,
  ascoltaTema,
  leggiTemaSalvato,
  salvaTema,
  temaCorrenteScuro,
} from "@/lib/tema";

interface MediaControl {
  matches: boolean;
  listeners: Set<(e: { matches: boolean }) => void>;
}

function installMatchMedia(matches: boolean): MediaControl {
  const control: MediaControl = { matches, listeners: new Set() };
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return control.matches;
      },
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => control.listeners.add(cb),
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => control.listeners.delete(cb),
    }) as unknown as MediaQueryList;
  return control;
}

function cambiaSistema(control: MediaControl, scuro: boolean) {
  control.matches = scuro;
  control.listeners.forEach((cb) => cb({ matches: scuro }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("leggiTemaSalvato", () => {
  it("restituisce null quando non c'è una scelta salvata", () => {
    expect(leggiTemaSalvato()).toBeNull();
  });

  it("restituisce la scelta salvata se valida", () => {
    window.localStorage.setItem(CHIAVE_TEMA, "scuro");
    expect(leggiTemaSalvato()).toBe("scuro");
    window.localStorage.setItem(CHIAVE_TEMA, "chiaro");
    expect(leggiTemaSalvato()).toBe("chiaro");
  });

  it("ignora valori non validi", () => {
    window.localStorage.setItem(CHIAVE_TEMA, "blu");
    expect(leggiTemaSalvato()).toBeNull();
  });

  it("restituisce null se l'archiviazione non è disponibile", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(leggiTemaSalvato()).toBeNull();
  });
});

describe("salvaTema", () => {
  it("salva la scelta in localStorage", () => {
    salvaTema("scuro");
    expect(window.localStorage.getItem(CHIAVE_TEMA)).toBe("scuro");
  });

  it("non lancia se l'archiviazione è piena o bloccata", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => salvaTema("chiaro")).not.toThrow();
  });
});

describe("applicaTema e temaCorrenteScuro", () => {
  it("aggiunge e rimuove la classe dark su <html>", () => {
    applicaTema("scuro");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(temaCorrenteScuro()).toBe(true);
    applicaTema("chiaro");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(temaCorrenteScuro()).toBe(false);
  });

  it("notifica i listener con l'evento del tema", () => {
    installMatchMedia(false);
    const notifica = vi.fn();
    const annulla = ascoltaTema(notifica);
    applicaTema("scuro");
    expect(notifica).toHaveBeenCalledTimes(1);
    annulla();
    applicaTema("chiaro");
    expect(notifica).toHaveBeenCalledTimes(1);
  });
});

describe("ascoltaTema e preferenza di sistema", () => {
  it("segue il sistema quando non c'è una scelta salvata", () => {
    const media = installMatchMedia(false);
    const annulla = ascoltaTema(() => {});
    cambiaSistema(media, true);
    expect(temaCorrenteScuro()).toBe(true);
    cambiaSistema(media, false);
    expect(temaCorrenteScuro()).toBe(false);
    annulla();
  });

  it("ignora il sistema quando l'utente ha scelto un tema", () => {
    const media = installMatchMedia(false);
    salvaTema("chiaro");
    const annulla = ascoltaTema(() => {});
    cambiaSistema(media, true);
    expect(temaCorrenteScuro()).toBe(false);
    annulla();
  });

  it("rimuove il listener del sistema alla disiscrizione", () => {
    const media = installMatchMedia(false);
    const annulla = ascoltaTema(() => {});
    expect(media.listeners.size).toBe(1);
    annulla();
    expect(media.listeners.size).toBe(0);
  });
});

describe("SCRIPT_TEMA_INIZIALE", () => {
  const esegui = () => new Function(SCRIPT_TEMA_INIZIALE)();

  it("applica il tema scuro se l'utente lo ha scelto", () => {
    window.localStorage.setItem(CHIAVE_TEMA, "scuro");
    installMatchMedia(false);
    esegui();
    expect(temaCorrenteScuro()).toBe(true);
  });

  it("applica il tema chiaro se l'utente lo ha scelto, anche con sistema scuro", () => {
    window.localStorage.setItem(CHIAVE_TEMA, "chiaro");
    installMatchMedia(true);
    esegui();
    expect(temaCorrenteScuro()).toBe(false);
  });

  it("segue il sistema scuro senza scelta salvata", () => {
    installMatchMedia(true);
    esegui();
    expect(temaCorrenteScuro()).toBe(true);
  });

  it("resta chiaro senza scelta e con sistema chiaro", () => {
    installMatchMedia(false);
    esegui();
    expect(temaCorrenteScuro()).toBe(false);
  });

  it("usa il sistema se l'archiviazione non è disponibile", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    installMatchMedia(true);
    esegui();
    expect(temaCorrenteScuro()).toBe(true);
  });

  it("resta chiaro se matchMedia non è disponibile", () => {
    const originale = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    try {
      expect(() => esegui()).not.toThrow();
      expect(temaCorrenteScuro()).toBe(false);
    } finally {
      window.matchMedia = originale;
    }
  });
});
