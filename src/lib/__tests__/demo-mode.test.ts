/**
 * Test completi per src/lib/demo-mode.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEMO_ACCOUNTS,
  matchDemoAccount,
  activateDemoSession,
  getActiveDemoSession,
  clearDemoSession,
  isDemoSession,
  guardDemoReadOnly,
  DEMO_READONLY_MESSAGE,
} from "@/lib/demo-mode";

describe("DEMO_ACCOUNTS", () => {
  it("ha 3 account", () => {
    expect(DEMO_ACCOUNTS).toHaveLength(3);
  });

  it("ogni account ha email, password, ruolo, nomeCognome", () => {
    for (const a of DEMO_ACCOUNTS) {
      expect(a.email).toBeTruthy();
      expect(a.password).toBeTruthy();
      expect(a.ruolo).toBeTruthy();
      expect(a.nomeCognome).toBeTruthy();
    }
  });

  it("ha i tre ruoli: volontario, referente_provinciale, admin", () => {
    const ruoli = DEMO_ACCOUNTS.map((a) => a.ruolo);
    expect(ruoli).toContain("volontario");
    expect(ruoli).toContain("referente_provinciale");
    expect(ruoli).toContain("admin");
  });

  it("le email usano il dominio .local", () => {
    for (const a of DEMO_ACCOUNTS) {
      expect(a.email).toContain(".local");
    }
  });
});

describe("matchDemoAccount", () => {
  it("matcha credenziali esatte", () => {
    const account = DEMO_ACCOUNTS[0];
    const result = matchDemoAccount(account.email, account.password);
    expect(result).not.toBeNull();
    expect(result?.email).toBe(account.email);
  });

  it("matcha email case-insensitive", () => {
    const account = DEMO_ACCOUNTS[0];
    const result = matchDemoAccount(account.email.toUpperCase(), account.password);
    expect(result).not.toBeNull();
  });

  it("matcha email con spazi", () => {
    const account = DEMO_ACCOUNTS[0];
    const result = matchDemoAccount(`  ${account.email}  `, account.password);
    expect(result).not.toBeNull();
  });

  it("non matcha password sbagliata", () => {
    const account = DEMO_ACCOUNTS[0];
    const result = matchDemoAccount(account.email, "password-sbagliata");
    expect(result).toBeNull();
  });

  it("non matcha email non esistente", () => {
    const result = matchDemoAccount("nonexistent@demo.local", "password");
    expect(result).toBeNull();
  });

  it("non matcha entrambi vuoti", () => {
    expect(matchDemoAccount("", "")).toBeNull();
  });
});

// Storage in memoria con la stessa interfaccia di sessionStorage: l'ambiente node
// dei test non lo fornisce.
function memoriaSessione(): Storage {
  const dati = new Map<string, string>();
  return {
    get length() {
      return dati.size;
    },
    key: (indice: number) => Array.from(dati.keys())[indice] ?? null,
    getItem: (chiave: string) => dati.get(chiave) ?? null,
    setItem: (chiave: string, valore: string) => {
      dati.set(chiave, String(valore));
    },
    removeItem: (chiave: string) => {
      dati.delete(chiave);
    },
    clear: () => dati.clear(),
  };
}

describe("demo session lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memoriaSessione());
    clearDemoSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activateDemoSession ritorna DemoSessionUser con isDemo=true", () => {
    const account = DEMO_ACCOUNTS[0];
    const session = activateDemoSession(account);
    expect(session.isDemo).toBe(true);
    expect(session.email).toBe(account.email);
    expect(session.ruolo).toBe(account.ruolo);
    expect(session.id).toBe(`demo-${account.ruolo}`);
  });

  it("getActiveDemoSession ritorna null se nessuna sessione attiva", () => {
    expect(getActiveDemoSession()).toBeNull();
  });

  it("getActiveDemoSession ritorna la sessione salvata da activate", () => {
    const account = DEMO_ACCOUNTS[1];
    activateDemoSession(account);
    const session = getActiveDemoSession();
    expect(session).not.toBeNull();
    expect(session?.email).toBe(account.email);
    expect(session?.isDemo).toBe(true);
  });

  it("getActiveDemoSession ignora un valore manomesso in sessionStorage", () => {
    sessionStorage.setItem("cb_demo_session", "{non json");
    expect(getActiveDemoSession()).toBeNull();
  });

  it("clearDemoSession rimuove la sessione", () => {
    activateDemoSession(DEMO_ACCOUNTS[0]);
    expect(sessionStorage.length).toBe(1);
    clearDemoSession();
    expect(sessionStorage.length).toBe(0);
    expect(getActiveDemoSession()).toBeNull();
  });

  it("demo session ha provinciaId null (fail-closed)", () => {
    const session = activateDemoSession(DEMO_ACCOUNTS[1]);
    expect(session.provinciaId).toBeNull();
    expect(session.regioneId).toBeNull();
  });

  it("demo session ha inizialiProtocollo DM", () => {
    const session = activateDemoSession(DEMO_ACCOUNTS[0]);
    expect(session.inizialiProtocollo).toBe("DM");
  });
});

describe("isDemoSession", () => {
  it("ritorna true per DemoSessionUser", () => {
    const session = activateDemoSession(DEMO_ACCOUNTS[0]);
    expect(isDemoSession(session)).toBe(true);
  });

  it("ritorna false per oggetto normale", () => {
    expect(isDemoSession({ id: "1", ruolo: "volontario" })).toBe(false);
  });

  it("ritorna false per null", () => {
    expect(isDemoSession(null)).toBe(false);
  });

  it("ritorna false per undefined", () => {
    expect(isDemoSession(undefined)).toBe(false);
  });

  it("ritorna false per oggetto senza isDemo", () => {
    expect(isDemoSession({ id: "1" })).toBe(false);
  });

  it("ritorna false per isDemo=false", () => {
    expect(isDemoSession({ isDemo: false })).toBe(false);
  });

  it("ritorna false per stringa", () => {
    expect(isDemoSession("test")).toBe(false);
  });
});

describe("guardDemoReadOnly", () => {
  it("lancia errore per sessione demo", () => {
    const session = activateDemoSession(DEMO_ACCOUNTS[0]);
    expect(() => guardDemoReadOnly(session)).toThrow(DEMO_READONLY_MESSAGE);
  });

  it("non lancia per utente non demo", () => {
    expect(() => guardDemoReadOnly({ id: "1", ruolo: "volontario" })).not.toThrow();
  });

  it("non lancia per null", () => {
    expect(() => guardDemoReadOnly(null)).not.toThrow();
  });
});

describe("DEMO_READONLY_MESSAGE", () => {
  it("contiene testo esplicativo", () => {
    expect(DEMO_READONLY_MESSAGE).toContain("questo account");
    expect(DEMO_READONLY_MESSAGE).toContain("non è consentito");
  });
});
