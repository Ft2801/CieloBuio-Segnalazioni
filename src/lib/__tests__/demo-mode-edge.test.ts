/**
 * Test per i rami residui di demo-mode.ts:
 * - getActiveDemoSession: valori non JSON, non oggetto o senza isDemo
 * - activateDemoSession: errore di sessionStorage.setItem gestito
 * - clearDemoSession: errore di sessionStorage.removeItem gestito
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEMO_ACCOUNTS,
  activateDemoSession,
  getActiveDemoSession,
  clearDemoSession,
  isDemoSession,
  guardDemoReadOnly,
} from "@/lib/demo-mode";

describe("demo session - edge cases per coverage 100%", () => {
  const originalSessionStorage = global.sessionStorage;

  beforeEach(() => {
    clearDemoSession();
  });

  afterEach(() => {
    // Ripristina sessionStorage originale dopo ogni test
    Object.defineProperty(global, "sessionStorage", {
      value: originalSessionStorage,
      writable: true,
      configurable: true,
    });
  });

  it("getActiveDemoSession ritorna null se JSON.parse fallisce (catch branch)", () => {
    // Simula sessionStorage con valore non-JSON
    const fakeStorage = {
      getItem: () => "not-valid-json{{{",
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se il valore non ha isDemo=true", () => {
    // Simula sessionStorage con oggetto valido ma senza isDemo true
    const fakeStorage = {
      getItem: () => JSON.stringify({ id: "fake", isDemo: false }),
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se raw è null (ramo !raw)", () => {
    const fakeStorage = {
      getItem: () => null, // raw = null -> ramo `if (!raw) return null`
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se raw è stringa vuota (ramo !raw)", () => {
    const fakeStorage = {
      getItem: () => "", // raw = "" -> ramo `if (!raw) return null` (empty string è falsy)
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se JSON.parse ritorna null (parsed falsy)", () => {
    const fakeStorage = {
      getItem: () => "null", // JSON.parse("null") === null -> parsed falsy
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se parsed non ha proprietà isDemo (undefined)", () => {
    const fakeStorage = {
      getItem: () => JSON.stringify({ id: "fake", ruolo: "volontario" }), // senza isDemo
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se parsed è un numero (truthy ma non oggetto)", () => {
    const fakeStorage = {
      getItem: () => "42",
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna null se parsed è un array", () => {
    const fakeStorage = {
      getItem: () => "[1, 2, 3]",
      setItem: () => {},
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    expect(getActiveDemoSession()).toBeNull();
  });

  it("activateDemoSession gestisce errore sessionStorage.setItem (catch branch)", () => {
    const fakeStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage full");
      },
      removeItem: () => {},
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    // Non deve lanciare: ritorna comunque un DemoSessionUser valido
    const session = activateDemoSession(DEMO_ACCOUNTS[0]);
    expect(session).toBeTruthy();
    expect(session.isDemo).toBe(true);
    expect(session.email).toBe(DEMO_ACCOUNTS[0].email);
  });

  it("clearDemoSession gestisce errore sessionStorage.removeItem (catch branch)", () => {
    const fakeStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("Storage error");
      },
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    // Non deve lanciare
    expect(() => clearDemoSession()).not.toThrow();
  });

  it("activateDemoSession poi getActiveDemoSession ritorna la sessione (ciclo completo con mock storage)", () => {
    // Simula sessionStorage con storage in-memory
    const memStore: Record<string, string> = {};
    const fakeStorage = {
      getItem: (key: string) => (key in memStore ? memStore[key] : null),
      setItem: (key: string, value: string) => {
        memStore[key] = value;
      },
      removeItem: (key: string) => {
        delete memStore[key];
      },
    };
    Object.defineProperty(global, "sessionStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });

    const session = activateDemoSession(DEMO_ACCOUNTS[1]);
    const retrieved = getActiveDemoSession();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.email).toBe(session.email);
    expect(retrieved?.isDemo).toBe(true);
    expect(retrieved?.ruolo).toBe(DEMO_ACCOUNTS[1].ruolo);
  });
});

describe("isDemoSession - edge cases", () => {
  it("ritorna false per oggetto con isDemo=true ma valore non boolean", () => {
    expect(isDemoSession({ isDemo: "true" })).toBe(false);
    expect(isDemoSession({ isDemo: 1 })).toBe(false);
    expect(isDemoSession({ isDemo: "yes" })).toBe(false);
  });

  it("ritorna false per array", () => {
    expect(isDemoSession([])).toBe(false);
  });

  it("ritorna false per oggetto con isDemo null", () => {
    expect(isDemoSession({ isDemo: null })).toBe(false);
  });

  it("ritorna false per number", () => {
    expect(isDemoSession(42)).toBe(false);
  });
});

describe("guardDemoReadOnly - additional cases", () => {
  it("non lancia per undefined", () => {
    expect(() => guardDemoReadOnly(undefined)).not.toThrow();
  });

  it("non lancia per oggetto con isDemo=false", () => {
    expect(() => guardDemoReadOnly({ isDemo: false })).not.toThrow();
  });
});
