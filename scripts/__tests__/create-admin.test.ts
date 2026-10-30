/**
 * Copertura dello script create-admin: collegamento tra terminale, readline,
 * database e procedura creaUtente. Tutte le dipendenze sono finte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stato = vi.hoisted(() => ({
  risposte: [] as string[],
  chunkTerminale: [] as string[],
  isTTY: false,
  interfacceCreate: 0,
  interfacceChiuse: 0,
  disconnessioni: 0,
  utenteEsistente: null as { ruolo: string } | null,
  createRifiuta: false,
  hashChiamate: [] as Array<[string, number]>,
  createChiamate: [] as unknown[],
}));

// Interfaccia readline finta: a ogni prompt invia la riga successiva di `risposte`
// come evento "line", come fa readline con un terminale o con input in pipe.
vi.mock("node:readline", () => ({
  createInterface: () => {
    stato.interfacceCreate++;
    let aperta = true;
    const ascoltatori: Record<string, Array<(riga: string) => void>> = {};
    const interfaccia = {
      on: (evento: string, ascolto: (riga: string) => void) => {
        (ascoltatori[evento] ??= []).push(ascolto);
        return interfaccia;
      },
      setPrompt: () => {},
      prompt: () => {
        setTimeout(() => {
          if (aperta) (ascoltatori.line ?? []).forEach((f) => f(stato.risposte.shift() ?? ""));
        }, 0);
      },
      close: () => {
        if (aperta) stato.interfacceChiuse++;
        aperta = false;
      },
    };
    return interfaccia;
  },
}));

vi.mock("node:process", async (importOriginale) => {
  const originale = await importOriginale<typeof import("node:process")>();
  const ascoltatori: Array<(blocco: string) => void> = [];
  const stdinFinto = {
    get isTTY() {
      return stato.isTTY;
    },
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    setEncoding: vi.fn(),
    on: (_evento: string, ascolto: (blocco: string) => void) => {
      ascoltatori.push(ascolto);
      const blocco = stato.chunkTerminale.shift();
      if (blocco !== undefined) setTimeout(() => ascolto(blocco), 0);
    },
    removeListener: (_evento: string, ascolto: (blocco: string) => void) => {
      const i = ascoltatori.indexOf(ascolto);
      if (i >= 0) ascoltatori.splice(i, 1);
    },
  };
  return { ...originale, stdin: stdinFinto, stdout: { write: vi.fn() } };
});

vi.mock("@/lib/prisma-client", () => ({
  createPrismaClient: () => ({
    user: {
      findUnique: async () => stato.utenteEsistente,
      create: async (args: unknown) => {
        stato.createChiamate.push(args);
        if (stato.createRifiuta) throw new Error("vincolo violato");
        return { id: "u-1", email: "a@b.it", ruolo: "admin" };
      },
    },
    provincia: { findUnique: async () => null },
    regioneLegge: { findUnique: async () => null },
    $disconnect: async () => {
      stato.disconnessioni++;
    },
  }),
}));

vi.mock("bcryptjs", () => ({
  hash: async (p: string, costo: number) => {
    stato.hashChiamate.push([p, costo]);
    return `hash:${p}`;
  },
}));

const PASSWORD = "CieloBuio!2026";

function azzera() {
  stato.risposte = [];
  stato.chunkTerminale = [];
  stato.isTTY = false;
  stato.interfacceCreate = 0;
  stato.interfacceChiuse = 0;
  stato.disconnessioni = 0;
  stato.utenteEsistente = null;
  stato.createRifiuta = false;
  stato.hashChiamate = [];
  stato.createChiamate = [];
}

async function eseguiScript(): Promise<number | undefined> {
  // Lo script si avvia all'importazione: il codice di uscita compare in process.exitCode.
  vi.resetModules();
  process.exitCode = undefined;
  await import("../create-admin");
  await vi.waitFor(() => expect(stato.disconnessioni).toBe(1));
  return process.exitCode;
}

beforeEach(() => {
  azzera();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.ADMIN_PASSWORD;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  delete process.env.ADMIN_PASSWORD;
});

describe("create-admin: flusso non interattivo", () => {
  it("crea l'utente con ADMIN_PASSWORD e chiude interfaccia e database", async () => {
    stato.risposte = ["mario@esempio.it", "Mario Rossi", "", ""];
    process.env.ADMIN_PASSWORD = PASSWORD;
    const codice = await eseguiScript();
    expect(codice).toBe(0);
    expect(stato.createChiamate).toHaveLength(1);
    expect(stato.hashChiamate).toEqual([[PASSWORD, 12]]);
    expect(stato.interfacceChiuse).toBeGreaterThanOrEqual(1);
  });

  it("senza ADMIN_PASSWORD legge anche la password dalla riga di input", async () => {
    stato.risposte = ["mario@esempio.it", "Mario Rossi", "volontario", "", PASSWORD, PASSWORD];
    const codice = await eseguiScript();
    expect(codice).toBe(0);
    expect(stato.hashChiamate[0]?.[0]).toBe(PASSWORD);
  });

  it("un errore di validazione restituisce 1", async () => {
    stato.risposte = ["email-non-valida"];
    const codice = await eseguiScript();
    expect(codice).toBe(1);
    expect(stato.createChiamate).toHaveLength(0);
  });

  it("un errore imprevisto del database viene registrato e restituisce 1", async () => {
    stato.risposte = ["mario@esempio.it", "Mario Rossi", "volontario", ""];
    stato.createRifiuta = true;
    process.env.ADMIN_PASSWORD = PASSWORD;
    const codice = await eseguiScript();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore:", "vincolo violato");
  });

  it("un errore non Error viene registrato come testo", async () => {
    stato.risposte = ["mario@esempio.it", "Mario Rossi", "volontario", ""];
    process.env.ADMIN_PASSWORD = PASSWORD;
    // Un rifiuto che non è un Error deve comunque essere registrato come testo.
    vi.doMock("@/lib/cli-utenti", async (orig) => {
      const m = await orig<typeof import("@/lib/cli-utenti")>();
      return {
        ...m,
        creaUtente: async () => {
          throw "stringa grezza";
        },
      };
    });
    try {
      const codice = await eseguiScript();
      expect(codice).toBe(1);
      expect(console.error).toHaveBeenCalledWith("Errore:", "stringa grezza");
    } finally {
      vi.doUnmock("@/lib/cli-utenti");
    }
  });
});

describe("create-admin: terminale interattivo", () => {
  it("con TTY chiude l'interfaccia prima di leggere la password nascosta", async () => {
    stato.isTTY = true;
    stato.risposte = ["mario@esempio.it", "Mario Rossi", "volontario", ""];
    stato.chunkTerminale = [`${PASSWORD}\n`, `${PASSWORD}\n`];
    const codice = await eseguiScript();
    expect(codice).toBe(0);
    expect(stato.hashChiamate[0]?.[0]).toBe(PASSWORD);
    expect(stato.interfacceChiuse).toBeGreaterThanOrEqual(1);
  });
});
