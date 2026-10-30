/**
 * Modalità demo disattivata (build di produzione, server reale).
 *
 * Nei test la modalità demo è attiva (src/setup-tests.ts). Qui si verifica il
 * comportamento del sistema reale: gli account demo non devono essere
 * riconosciuti e nessuna sessione demo deve essere ripristinata dal browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const EMAIL_VOLONTARIO = "volontario@demo.cielobuio-segnalazioni.local";
const PASSWORD_VOLONTARIO = "SoloLettura-Volontario!1";
const CHIAVE_SESSIONE = "cb_demo_session";

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

describe("modalità demo disattivata (sistema reale)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CIELOBUIO_DEMO", "");
    vi.stubGlobal("sessionStorage", memoriaSessione());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("DEMO_ABILITATA è falso senza il flag della build statica", async () => {
    const demo = await import("@/lib/demo-mode");
    expect(demo.DEMO_ABILITATA).toBe(false);
  });

  it("non riconosce le credenziali di un account demo", async () => {
    const demo = await import("@/lib/demo-mode");
    expect(demo.matchDemoAccount(EMAIL_VOLONTARIO, PASSWORD_VOLONTARIO)).toBeNull();
  });

  it("non ripristina una sessione demo salvata nel browser", async () => {
    sessionStorage.setItem(
      CHIAVE_SESSIONE,
      JSON.stringify({
        id: "demo-volontario",
        email: EMAIL_VOLONTARIO,
        nomeCognome: "Giulia Ferri",
        ruolo: "volontario",
        provinciaId: null,
        regioneId: null,
        inizialiProtocollo: "DM",
        pec: null,
        emailOrdinaria: null,
        indirizzo: null,
        firma: null,
        isDemo: true,
      }),
    );
    const demo = await import("@/lib/demo-mode");
    expect(demo.getActiveDemoSession()).toBeNull();
  });
});
