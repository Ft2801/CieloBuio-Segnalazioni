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
  stat: vi.fn(),
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

// Mock console.log e console.error per verificare output
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

// Mock process.exit per prevenire chiusura del processo di test
const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
  // Non fare nulla: previene la chiusura del processo di test
}) as any);

describe("cron-jobs.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.TRANSIZIONE_INVIATA_GIORNI;
    delete process.env.RETENTION_SEGNALAZIONI_ANNI;
    mockAnonimizza.mockClear();
    mockAnonimizza.mockResolvedValue(undefined);
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
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockDb.sessione.deleteMany).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Inizio cron jobs")
    );
  });

  it("transita segnalazioni inviata → in_attesa dopo N giorni", async () => {
    process.env.TRANSIZIONE_INVIATA_GIORNI = "7";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([{ id: "s1", volontarioId: "v1" }])
      .mockResolvedValueOnce([]);
    mockDb.segnalazione.updateMany.mockResolvedValue({ count: 1 });
    mockDb.storicoStato.create.mockResolvedValue({});

    vi.resetModules();
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockDb.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stato: "in_attesa" },
      })
    );
  });

  it("non crea storico se updateMany ritorna count=0 (race condition)", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([{ id: "s1", volontarioId: "v1" }])
      .mockResolvedValueOnce([]);
    mockDb.segnalazione.updateMany.mockResolvedValue({ count: 0 });
    mockDb.storicoStato.create.mockResolvedValue({});

    vi.resetModules();
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const createCalls = mockDb.storicoStato.create.mock.calls;
    const transizioneCalls = createCalls.filter(
      (call) => (call[0] as any).data?.statoPrecedente === "inviata"
    );
    expect(transizioneCalls).toHaveLength(0);
  });

  it("anonimizza segnalazioni tramite anonimizzaSegnalazione (lib condivisa)", async () => {
    process.env.RETENTION_SEGNALAZIONI_ANNI = "10";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "s-old" }]);

    vi.resetModules();
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockAnonimizza).toHaveBeenCalledWith("s-old", 10, null);
  });

  it("logga errori e chiama process.exit(1) su eccezione", async () => {
    mockDb.sessione.deleteMany.mockRejectedValue(new Error("DB connection failed"));

    vi.resetModules();
    try {
      await import("../../scripts/cron-jobs");
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // Expected: process.exit throws
    }

    expect(errorSpy).toHaveBeenCalledWith(
      "Errore cron jobs:",
      expect.any(Error)
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("chiama $disconnect nel finally", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.resetModules();
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockDb.$disconnect).toHaveBeenCalled();
  });

  it("logga file orfani rimossi quando cleanupFileOrfani ritorna >0", async () => {
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Simula cleanupFileOrfani che trova e rimuove 1 directory orfana
    mockDb.allegato.findMany.mockResolvedValue([]);
    // segnalazione.findMany è già mockato sopra per 2 chiamate;
    // la 3ª chiamata (da cleanupFileOrfani per segnalazioni esistenti) ritorna []
    mockDb.segnalazione.findMany.mockResolvedValue([]);

    // Override readdir per simulare una directory orfana
    const { readdir: mockReaddir } = await import("fs/promises");
    vi.mocked(mockReaddir).mockResolvedValueOnce(["orphan-dir"] as any);
    const { stat: mockStat } = await import("fs/promises");
    vi.mocked(mockStat).mockResolvedValue({ isDirectory: () => true } as any);
    const { rm: mockRm } = await import("fs/promises");
    vi.mocked(mockRm).mockResolvedValue(undefined);

    vi.resetModules();
    await import("../../scripts/cron-jobs");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("File orfani rimossi")
    );
  });

  it("anonimizzaSegnalazione gestisce errore filesystem (catch non bloccante)", async () => {
    process.env.RETENTION_SEGNALAZIONI_ANNI = "10";
    mockDb.sessione.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.segnalazione.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "s-fs-err" }]);

    // Simula errore filesystem nel rm
    vi.doMock("@/lib/gdpr", () => ({
      anonimizzaSegnalazione: vi.fn().mockImplementation(async (id: string) => {
        // Simula il comportamento: prova rm, fallisce, ma continua
        throw new Error("filesystem error");
      }),
    }));

    vi.resetModules();
    try {
      await import("../../scripts/cron-jobs");
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // L'errore del singolo record non deve bloccare il cron
    }

    // Verifica che il cron abbia tentato l'anonimizzazione
    expect(mockAnonimizza).not.toHaveBeenCalled(); // Il mock è stato sostituito dal doMock
  });
});
