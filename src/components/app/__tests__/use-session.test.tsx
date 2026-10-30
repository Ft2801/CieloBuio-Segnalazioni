// @vitest-environment jsdom
/**
 * Copertura completa di useSession: sessione demo locale, sessione server,
 * login (demo, TOTP, errori) e logout (demo, server, errore di rete).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const demoState = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/demo-mode", () => ({
  get DEMO_ABILITATA() {
    return demoState.enabled;
  },
  getActiveDemoSession: vi.fn(),
  activateDemoSession: vi.fn(),
  matchDemoAccount: vi.fn(),
  clearDemoSession: vi.fn(),
}));

import * as demo from "@/lib/demo-mode";
import { useSession } from "@/components/app/use-session";

const UTENTE = { id: "u1", email: "u@t.it", ruolo: "admin", nomeCognome: "Utente Test" };

function risposta(ok: boolean, corpo: unknown, jsonFallisce = false) {
  return {
    ok,
    json: jsonFallisce ? () => Promise.reject(new Error("json non valido")) : async () => corpo,
  } as never;
}

let fetchMock: ReturnType<typeof vi.fn>;

function rispondi(mappa: Record<string, () => Promise<unknown>>) {
  fetchMock.mockImplementation((url: string) => {
    const handler = mappa[url];
    if (handler) return handler();
    return Promise.resolve(risposta(true, { user: null }));
  });
}

async function montato() {
  const hook = renderHook(() => useSession());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  demoState.enabled = false;
  vi.mocked(demo.getActiveDemoSession).mockReturnValue(null);
  fetchMock = vi.fn().mockResolvedValue(risposta(true, { user: null }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useSession - caricamento sessione", () => {
  it("con sessione demo attiva usa la sessione locale senza chiamare il server", async () => {
    vi.mocked(demo.getActiveDemoSession).mockReturnValue({ ...UTENTE, demo: true } as never);
    const { result } = await montato();
    expect(result.current.user).toMatchObject({ id: "u1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("l'export statico senza sessione demo non chiama API su un altro percorso Pages", async () => {
    demoState.enabled = true;
    const { result } = await montato();
    expect(result.current.user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carica l'utente dalla sessione server", async () => {
    rispondi({ "/api/auth/me": () => Promise.resolve(risposta(true, { user: UTENTE })) });
    const { result } = await montato();
    expect(result.current.user).toEqual(UTENTE);
  });

  it("senza campo user la sessione risulta assente", async () => {
    rispondi({ "/api/auth/me": () => Promise.resolve(risposta(true, {})) });
    const { result } = await montato();
    expect(result.current.user).toBeNull();
  });

  it("una risposta con JSON non valido non imposta alcun utente", async () => {
    rispondi({ "/api/auth/me": () => Promise.resolve(risposta(true, undefined, true)) });
    const { result } = await montato();
    expect(result.current.user).toBeNull();
  });

  it("un errore di rete azzera la sessione e termina il caricamento", async () => {
    rispondi({ "/api/auth/me": () => Promise.reject(new Error("rete assente")) });
    const { result } = await montato();
    expect(result.current.user).toBeNull();
  });

  it("refresh ricarica la sessione dal server", async () => {
    const { result } = await montato();
    rispondi({ "/api/auth/me": () => Promise.resolve(risposta(true, { user: UTENTE })) });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.user).toEqual(UTENTE);
  });
});

describe("useSession - login", () => {
  it("un account demo accede senza chiamare il server", async () => {
    const account = { email: "demo@t.it", password: "x" };
    const utenteDemo = { ...UTENTE, id: "demo-1", demo: true };
    vi.mocked(demo.matchDemoAccount).mockReturnValue(account as never);
    vi.mocked(demo.activateDemoSession).mockReturnValue(utenteDemo as never);
    const { result } = await montato();
    let esito: unknown;
    await act(async () => {
      esito = await result.current.login("demo@t.it", "x");
    });
    expect(esito).toEqual({ ok: true, user: utenteDemo });
    expect(result.current.user).toEqual(utenteDemo);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/login", expect.anything());
  });

  it("l'export statico rifiuta credenziali non demo senza inviarle ad alcuna API", async () => {
    demoState.enabled = true;
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    await expect(
      act(async () => {
        await result.current.login("persona@example.com", "PasswordPrivata123!");
      }),
    ).rejects.toThrow("solo gli account dimostrativi");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("login riuscito chiama il server senza codice TOTP e aggiorna la sessione", async () => {
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    rispondi({
      "/api/auth/login": () => Promise.resolve(risposta(true, { ok: true, user: UTENTE })),
      "/api/auth/me": () => Promise.resolve(risposta(true, { user: UTENTE })),
    });
    let esito: unknown;
    await act(async () => {
      esito = await result.current.login("u@t.it", "Password1!");
    });
    expect(esito).toEqual({ ok: true, user: UTENTE });
    const chiamata = fetchMock.mock.calls.find((c) => c[0] === "/api/auth/login");
    expect(JSON.parse(String((chiamata?.[1] as RequestInit).body))).not.toHaveProperty("totpToken");
    expect(result.current.user).toEqual(UTENTE);
  });

  it("invia il codice TOTP quando fornito", async () => {
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    rispondi({ "/api/auth/login": () => Promise.resolve(risposta(true, { ok: true, user: UTENTE })) });
    await act(async () => {
      await result.current.login("u@t.it", "Password1!", "123456");
    });
    const chiamata = fetchMock.mock.calls.find((c) => c[0] === "/api/auth/login");
    expect(JSON.parse(String((chiamata?.[1] as RequestInit).body)).totpToken).toBe("123456");
  });

  it("richiede il codice TOTP senza lanciare errore", async () => {
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    rispondi({
      "/api/auth/login": () => Promise.resolve(risposta(false, { requiresTotp: true, error: "Inserire il codice" })),
    });
    let esito: unknown;
    await act(async () => {
      esito = await result.current.login("u@t.it", "Password1!");
    });
    expect(esito).toEqual({ ok: false, requiresTotp: true, error: "Inserire il codice" });
  });

  it("un errore del server viene rilanciato con il suo messaggio", async () => {
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    rispondi({ "/api/auth/login": () => Promise.resolve(risposta(false, { error: "Credenziali errate" })) });
    await expect(
      act(async () => {
        await result.current.login("u@t.it", "sbagliata");
      }),
    ).rejects.toThrow("Credenziali errate");
  });

  it("un errore senza messaggio viene rilanciato con testo generico", async () => {
    vi.mocked(demo.matchDemoAccount).mockReturnValue(null);
    const { result } = await montato();
    rispondi({ "/api/auth/login": () => Promise.resolve(risposta(false, {}, true)) });
    await expect(
      act(async () => {
        await result.current.login("u@t.it", "sbagliata");
      }),
    ).rejects.toThrow("Errore di accesso");
  });
});

describe("useSession - logout", () => {
  it("in modalità demo azzera la sessione locale senza chiamare il server", async () => {
    vi.mocked(demo.getActiveDemoSession).mockReturnValue({ ...UTENTE, demo: true } as never);
    const { result } = await montato();
    await act(async () => {
      await result.current.logout();
    });
    expect(demo.clearDemoSession).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
  });

  it("il logout server azzera l'utente", async () => {
    rispondi({
      "/api/auth/me": () => Promise.resolve(risposta(true, { user: UTENTE })),
      "/api/auth/logout": () => Promise.resolve(risposta(true, { ok: true })),
    });
    const { result } = await montato();
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
  });

  it("un errore di rete del logout server viene segnalato fuori dalla produzione", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rispondi({
      "/api/auth/logout": () => Promise.reject(new Error("rete assente")),
    });
    const { result } = await montato();
    await act(async () => {
      await result.current.logout();
    });
    expect(warn).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it("in produzione un errore di rete del logout non produce log", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rispondi({
      "/api/auth/logout": () => Promise.reject(new Error("rete assente")),
    });
    const { result } = await montato();
    await act(async () => {
      await result.current.logout();
    });
    expect(warn).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });
});
