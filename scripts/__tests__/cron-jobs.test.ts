/**
 * Test per scripts/cron-jobs.ts
 * Copre: pulizia sessioni, transizione automatica inviata→in_attesa,
 * anonimizzazione GDPR, gestione errori.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock PrismaClient
const mockDb = {
  sessione: {
    deleteMany: vi.fn(),
  },
  segnalazione: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  allegato: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  storicoStato: {
    create: vi.fn(),
  },
  // $transaction supporta due forme in Prisma:
  //  - array di PrismaPromise: ritorna Promise<result[]>
  //  - callback interattiva (tx) => Promise<T>: ritorna Promise<T>
  // Il mock gestisce entrambe: se l'argomento è una funzione, la esegue
  // passandogli mockDb come "tx"; se è un array, esegue tutte le promise
  // in parallelo e ritorna i risultati.
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return undefined;
  }),
  // $queryRaw: cron-jobs.ts acquisisce un advisory lock PostgreSQL via
  // $queryRaw. Mockiamo ritornando [{ acquired: true }] così il lock viene
  // sempre considerato acquisito e runCronJobs viene eseguita.
  $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
  // $executeRaw: cron-jobs.ts rilascia il lock via $executeRaw. Mock no-op.
  $executeRaw: vi.fn().mockResolvedValue(1),
  $disconnect: vi.fn(),
};

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockDb),
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code: string;
      constructor(args: { code: string; message: string }) {
        super(args.message);
        this.code = args.code;
      }
    },
  },
}));

// Mock di @/lib/db per evitare $extends non disponibile nel mock PrismaClient
vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

// Mock di @/lib/gdpr per evitare import chain che richiede Prisma reale
const mockAnonimizza = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/gdpr", () => ({
  anonimizzaSegnalazione: mockAnonimizza,
}));

// Mock di fs/promises per cleanupFileOrfani (readdir su UPLOADS_ROOT)
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockRejectedValue(new Error("ENOENT")),
  lstat: vi.fn(),
  rm: vi.fn(),
}));

// Mock di @/lib/logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock console.log e console.error per silenziare output non rilevante
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

// Mock process.exit per prevenire chiusura del processo di test
const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
  // Non fare nulla: previene la chiusura del processo di test
}) as never);

import { logger } from "../../src/lib/logger";

describe("cron-jobs.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.TRANSIZIONE_INVIATA_GIORNI;
    delete process.env.RETENTION_SEGNALAZIONI_ANNI;
    mockAnonimizza.mockClear();
    mockAnonimizza.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("esegue pulizia sessioni scadute e transizione automatica", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 5 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([
        { id: "s1", volontarioId: "v1" },
        { id: "s2", volontarioId: "v2" },
      ])
      .mockResolvedValueOnce([]);
    mockDb.segnalazione.updateMany.mockResolvedValue({ count: 1 });
    mockDb.storicoStato.create.mockResolvedValue({});

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(mockDb.sessione.deleteMany).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({}), expect.stringContaining("Inizio cron jobs"));
  });

  it("transita segnalazioni inviata → in_attesa dopo N giorni", async () => {
    process.env.TRANSIZIONE_INVIATA_GIORNI = "7";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([{ id: "s1", volontarioId: "v1" }]).mockResolvedValueOnce([]);
    mockDb.segnalazione.updateMany.mockResolvedValue({ count: 1 });
    mockDb.storicoStato.create.mockResolvedValue({});

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(mockDb.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stato: "in_attesa" },
      }),
    );
  });

  it("non crea storico se updateMany ritorna count=0 (race condition)", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([{ id: "s1", volontarioId: "v1" }]).mockResolvedValueOnce([]);
    mockDb.segnalazione.updateMany.mockResolvedValue({ count: 0 });
    mockDb.storicoStato.create.mockResolvedValue({});

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    const createCalls = mockDb.storicoStato.create.mock.calls;
    const transizioneCalls = createCalls.filter(
      (call) => (call[0] as { data?: { statoPrecedente?: string } }).data?.statoPrecedente === "inviata",
    );
    expect(transizioneCalls).toHaveLength(0);
  });

  it("anonimizza segnalazioni tramite anonimizzaSegnalazione (lib condivisa)", async () => {
    process.env.RETENTION_SEGNALAZIONI_ANNI = "10";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "s-old" }]);

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(mockAnonimizza).toHaveBeenCalledWith(mockDb, "s-old", 10, null);
  });

  it("non conta pratiche diventate non idonee durante l'anonimizzazione", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "s-riaperta" }]);
    mockAnonimizza.mockResolvedValueOnce(false);
    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0, retentionAnni: expect.any(Number) }),
      "Segnalazioni anonimizzate per GDPR retention",
    );
  });

  it("logga errori e chiama process.exit(1) su eccezione", async () => {
    mockDb.sessione.deleteMany.mockRejectedValue(new Error("DB connection failed"));

    vi.resetModules();
    try {
      const modulo = await import("../../scripts/cron-jobs");
      await modulo.run();
    } catch {
      // Expected: process.exit throws
    }

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({}), "Errore cron jobs");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("chiama $disconnect nel finally", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(mockDb.$disconnect).toHaveBeenCalled();
  });

  it("logga file orfani rimossi quando cleanupFileOrfani ritorna >0", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    // Simula cleanupFileOrfani che trova e rimuove 1 directory orfana
    mockDb.allegato.findMany.mockResolvedValue([]);
    // segnalazione.findMany è già mockato sopra per 2 chiamate;
    // la 3ª chiamata (da cleanupFileOrfani per segnalazioni esistenti) ritorna []
    mockDb.segnalazione.findMany.mockResolvedValue([]);

    // Override readdir per simulare una directory orfana
    const { readdir: mockReaddir } = await import("fs/promises");
    vi.mocked(mockReaddir).mockResolvedValueOnce(["orphan-dir"] as never);
    const { lstat: mockStat } = await import("fs/promises");
    vi.mocked(mockStat).mockResolvedValue({ isDirectory: () => true } as never);
    const { rm: mockRm } = await import("fs/promises");
    vi.mocked(mockRm).mockResolvedValue(undefined);

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.stringContaining("File orfani rimossi"),
    );
  });

  it("un errore su una segnalazione non blocca l'anonimizzazione delle successive", async () => {
    process.env.RETENTION_SEGNALAZIONI_ANNI = "10";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "s-fs-err" }, { id: "s-ok" }]);
    mockAnonimizza.mockRejectedValueOnce(new Error("filesystem error")).mockResolvedValueOnce(true);

    vi.resetModules();
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();

    expect(mockAnonimizza).toHaveBeenCalledTimes(2);
    expect(mockAnonimizza).toHaveBeenNthCalledWith(2, mockDb, "s-ok", 10, null);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ segnalazioneId: "s-fs-err" }),
      expect.stringContaining("continuo col prossimo"),
    );
  });
});

// -----------------------------------------------------------------------------
// Lock di maintenance già occupato: l'esecuzione esce senza eseguire i job.
// Punto d'ingresso cron-entry: importarlo avvia la maintenance.
// -----------------------------------------------------------------------------
describe("cron-jobs.ts - lock occupato e punto d'ingresso", () => {
  it("con lock occupato registra l'uscita e non esegue la maintenance", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([{ acquired: false }]);
    const modulo = await import("../../scripts/cron-jobs");
    await modulo.run();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("già in corso"));
    expect(mockAnonimizza).not.toHaveBeenCalled();
  });

  it("il punto d'ingresso avvia la maintenance all'importazione", async () => {
    await import("../../scripts/cron-entry");
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: expect.any(String) }),
        "Cron jobs completati.",
      ),
    );
  });
});
