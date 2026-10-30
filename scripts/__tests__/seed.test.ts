/**
 * Copertura dello script seed: caricamento iniziale, riesecuzione (duplicati
 * già presenti), allineamento dei riferimenti normativi ed errori non
 * recuperabili. Il database è finto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

const stato = vi.hoisted(() => ({
  id: 0,
  // Restituisce un errore da lanciare per la chiamata di creazione, oppure null.
  errorePerCreazione: null as null | ((modello: string, dati: unknown) => unknown),
  // Record restituiti per le province (ricerca per sigla).
  record: null as { id: number; regioneId?: number } | null,
  // Regioni già presenti nel finto database, indicizzate per nome.
  regioni: {} as Record<string, Record<string, unknown>>,
  disconnessioni: 0,
  creazioni: [] as Array<{ modello: string; dati: unknown }>,
  aggiornamenti: [] as Array<{ where: { id: number }; data: unknown }>,
}));

vi.mock("@/lib/prisma-client", () => {
  const crea = (modello: string) => async (args: { data: unknown }) => {
    stato.creazioni.push({ modello, dati: args.data });
    const errore = stato.errorePerCreazione?.(modello, args.data);
    if (errore) throw errore;
    stato.id += 1;
    return { id: stato.id };
  };
  const trovaProvincia = async () => stato.record;
  const trovaRegione = async (args: { where: { regione: string } }) => stato.regioni[args.where.regione] ?? null;
  const aggiornaRegione = async (args: { where: { id: number }; data: unknown }) => {
    stato.aggiornamenti.push(args);
    return { id: args.where.id };
  };
  return {
    createPrismaClient: () => ({
      regioneLegge: {
        create: crea("regioneLegge"),
        findUnique: trovaRegione,
        update: aggiornaRegione,
      },
      provincia: { create: crea("provincia"), findUnique: trovaProvincia },
      comune: { create: crea("comune") },
      $disconnect: async () => {
        stato.disconnessioni += 1;
      },
    }),
  };
});

function duplicato(): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.1",
  });
}

/** Esegue lo script seed con gli argomenti da riga di comando indicati. */
async function eseguiSeed(argomenti: string[] = []): Promise<number | undefined> {
  const argvOriginale = process.argv;
  process.argv = [...argvOriginale, ...argomenti];
  try {
    vi.resetModules();
    process.exitCode = undefined;
    await import("../seed");
    await vi.waitFor(() => expect(stato.disconnessioni).toBe(1));
    return process.exitCode;
  } finally {
    process.argv = argvOriginale;
  }
}

beforeEach(() => {
  stato.id = 0;
  stato.errorePerCreazione = null;
  // Di default le ricerche di province trovano il record: le province di riferimento esistono.
  stato.record = { id: 1 };
  stato.regioni = {};
  stato.disconnessioni = 0;
  stato.creazioni = [];
  stato.aggiornamenti = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("seed - primo caricamento", () => {
  it("crea regioni, province e comuni senza impostare errori", async () => {
    const codice = await eseguiSeed();
    expect(codice).toBeUndefined();
    const modelli = stato.creazioni.map((c) => c.modello);
    expect(modelli.filter((m) => m === "regioneLegge").length).toBe(4);
    expect(modelli.filter((m) => m === "provincia").length).toBe(6);
    expect(modelli.filter((m) => m === "comune").length).toBeGreaterThan(0);
    expect(console.log).toHaveBeenCalledWith("Seed dei dati di configurazione completato.");
  });

  it("le province usano l'id della regione appena creata", async () => {
    await eseguiSeed();
    const primaProvincia = stato.creazioni.find((c) => c.modello === "provincia");
    expect(primaProvincia?.dati).toMatchObject({ sigla: "BG", regioneId: 1 });
  });
});

/** Ricarica nel finto database le regioni create dal primo caricamento. */
async function regioniGiaPresenti(): Promise<void> {
  await eseguiSeed();
  const creazioniRegioni = stato.creazioni.filter((c) => c.modello === "regioneLegge");
  stato.regioni = {};
  creazioniRegioni.forEach((c, indice) => {
    const dati = c.dati as Record<string, unknown> & { regione: string };
    stato.regioni[dati.regione] = { id: indice + 1, ...dati };
  });
  stato.creazioni = [];
  stato.disconnessioni = 0;
}

describe("seed - riesecuzione", () => {
  it("con regioni invariate non crea nulla e non segnala differenze", async () => {
    await regioniGiaPresenti();
    const codice = await eseguiSeed();
    expect(codice).toBeUndefined();
    expect(stato.creazioni.filter((c) => c.modello === "regioneLegge")).toHaveLength(0);
    expect(stato.aggiornamenti).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("con differenze nei riferimenti normativi le segnala senza sovrascrivere", async () => {
    await regioniGiaPresenti();
    stato.regioni.VENETO.testoSanzioni = "valore modificato dal pannello";
    const codice = await eseguiSeed();
    expect(codice).toBeUndefined();
    expect(stato.aggiornamenti).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("VENETO: campi diversi dal seed (testoSanzioni)"),
    );
  });

  it("con --aggiorna-normativa allinea i campi diversi", async () => {
    await regioniGiaPresenti();
    stato.regioni.VENETO.testoSanzioni = "valore modificato dal pannello";
    const codice = await eseguiSeed(["--aggiorna-normativa"]);
    expect(codice).toBeUndefined();
    expect(stato.aggiornamenti).toHaveLength(1);
    expect(stato.aggiornamenti[0]?.where).toEqual({ id: stato.regioni.VENETO.id });
    expect(stato.aggiornamenti[0]?.data).toMatchObject({ regione: "VENETO", testoSanzioni: "art. 11" });
    expect(console.log).toHaveBeenCalledWith("VENETO: aggiornati i campi testoSanzioni");
  });

  it("con record già presenti recupera quelli esistenti senza errori", async () => {
    // Le regioni esistono già; province e comuni duplicati vengono recuperati o saltati.
    await regioniGiaPresenti();
    stato.errorePerCreazione = (modello) => (modello === "regioneLegge" ? null : duplicato());
    stato.record = { id: 42, regioneId: 1 };
    const codice = await eseguiSeed();
    expect(codice).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("un duplicato senza record recuperabile interrompe il seed", async () => {
    stato.errorePerCreazione = () => duplicato();
    stato.record = null;
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore durante il seed:", expect.any(Error));
  });

  it("una provincia BG già presente ma collegata ad altra regione interrompe il seed", async () => {
    stato.errorePerCreazione = (modello) => (modello === "provincia" ? duplicato() : null);
    stato.record = { id: 42, regioneId: 99 };
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(vi.mocked(console.error).mock.calls[0]?.[1]).toHaveProperty(
      "message",
      expect.stringContaining("verificare il database"),
    );
  });

  it("un duplicato di provincia senza record recuperabile interrompe il seed", async () => {
    stato.errorePerCreazione = (modello) => (modello === "provincia" ? duplicato() : null);
    stato.record = null;
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore durante il seed:", expect.any(Error));
  });

  it("un comune già presente viene saltato mentre le altre righe proseguono", async () => {
    stato.errorePerCreazione = (modello) => (modello === "comune" ? duplicato() : null);
    const codice = await eseguiSeed();
    expect(codice).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("seed - errori non recuperabili", () => {
  it("un errore di comune diverso da un duplicato viene propagato", async () => {
    stato.errorePerCreazione = (modello) => (modello === "comune" ? new Error("database non disponibile") : null);
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore durante il seed:", expect.any(Error));
    expect(vi.mocked(console.error).mock.calls[0]?.[1]).toHaveProperty("message", "database non disponibile");
  });

  it("un errore non di unicità durante la creazione di una provincia viene propagato", async () => {
    stato.errorePerCreazione = (modello) => (modello === "provincia" ? new Error("disco pieno") : null);
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore durante il seed:", expect.any(Error));
  });

  it("un errore generico durante la creazione di una regione interrompe il seed", async () => {
    stato.errorePerCreazione = (modello) => (modello === "regioneLegge" ? new Error("disco pieno") : null);
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(stato.disconnessioni).toBe(1);
  });
});

describe("seed - province di riferimento mancanti", () => {
  it("se una provincia di riferimento non esiste il seed si interrompe con errore esplicito", async () => {
    // Le regioni vengono create; le ricerche di province successive non trovano nulla.
    stato.record = null;
    const codice = await eseguiSeed();
    expect(codice).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Errore durante il seed:", expect.any(Error));
    expect(vi.mocked(console.error).mock.calls[0]?.[1]).toHaveProperty(
      "message",
      expect.stringContaining("non trovata"),
    );
  });
});
