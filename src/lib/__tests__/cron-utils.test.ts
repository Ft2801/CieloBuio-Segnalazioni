/**
 * Test dedicati per cleanupFileOrfani in src/lib/cron-utils.ts.
 * Copre tutti i rami: directory orfana, file orfano, segmenti non sicuri,
 * stat che fallisce, readdir che fallisce, rm che fallisce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
  rm: vi.fn(),
}));

// Mock path-guard per controllare UPLOADS_ROOT
vi.mock("@/lib/path-guard", () => ({
  UPLOADS_ROOT: "/fake/uploads",
  isSafePathSegment: (v: string) =>
    !!v && typeof v === "string" && !v.includes("..") && !v.includes("/") && !v.includes("\\") && !v.includes("\0"),
  parseUrlStorageSicuro: (url: string) => {
    const parts = url.split("/");
    if (parts.length === 2) return { segnalazioneId: parts[0], filename: parts[1] };
    return null;
  },
}));

// Mock gdpr per evitare chain
vi.mock("@/lib/gdpr", () => ({
  anonimizzaSegnalazione: vi.fn(),
}));

import { readdir, lstat, rm } from "fs/promises";
import { cleanupFileOrfani, transizioneAutomaticaInviata } from "@/lib/cron-utils";

const mockDb = {
  allegato: { findMany: vi.fn() },
  segnalazione: { findMany: vi.fn() },
};

describe("cleanupFileOrfani", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 0 se UPLOADS_ROOT non esiste (readdir throw)", async () => {
    vi.mocked(readdir).mockRejectedValueOnce(new Error("ENOENT"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("rimuove directory orfana (nessuna segnalazione corrispondente)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["orphan-dir"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "other-id" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(1);
    expect(rm).toHaveBeenCalledWith(expect.stringContaining("orphan-dir"), { recursive: true, force: true });
  });

  it("non rimuove directory di segnalazione esistente ma rimuove file orfano al suo interno", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as never) // primo livello: directory
      .mockResolvedValueOnce(["orphan-file.jpg", "valid-file.jpg"] as never); // secondo livello: file
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([{ urlStorage: "seg-id-1/valid-file.jpg" }]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "seg-id-1" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(1);
    // Verifica che rm sia stato chiamato solo per il file orfano
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(expect.stringContaining("orphan-file.jpg"), { force: true });
  });

  it("salta entry non sicure (path traversal)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["../etc", "valid-dir"] as never);
    // Per valid-dir (directory di segnalazione esistente), readdir ritorna vuoto
    vi.mocked(readdir).mockResolvedValueOnce([] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "valid-dir" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    // ../etc è saltato da isSafePathSegment, valid-dir esiste come segnalazione
    expect(result).toBe(0);
    // La root e la sola valid-dir vengono letti: ../etc non viene mai aperto né rimosso.
    expect(readdir).toHaveBeenCalledTimes(2);
    expect(rm).not.toHaveBeenCalled();
  });

  it("salta entry che non sono directory (file regolare al primo livello)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["some-file.txt"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => false } as never);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("gestisce errore stat (catch → continue)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["dir-err"] as never);
    vi.mocked(lstat).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("gestisce errore readdir al secondo livello (catch → continue)", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as never) // primo livello ok
      .mockRejectedValueOnce(new Error("EACCES")); // secondo livello throw
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "seg-id-1" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("gestisce errore rm su directory orfana (catch → continue, non incrementa)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["orphan-dir"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "other-id" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("gestisce errore rm su file orfano (catch → continue, non incrementa)", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as never)
      .mockResolvedValueOnce(["orphan-file.jpg"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "seg-id-1" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("salta file con nome non sicuro dentro directory esistente", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as never)
      .mockResolvedValueOnce(["../escape", "valid-file.jpg"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([{ urlStorage: "seg-id-1/valid-file.jpg" }]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "seg-id-1" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    expect(result).toBe(0);
  });

  it("rimuove più directory orfane e più file orfani", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["orphan-1", "orphan-2", "seg-1"] as never)
      .mockResolvedValueOnce(["orphan-file-1.jpg", "orphan-file-2.jpg", "valid.jpg"] as never);
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([{ urlStorage: "seg-1/valid.jpg" }]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([{ id: "seg-1" }]);

    const result = await cleanupFileOrfani(mockDb as never);
    // 2 directory orfane + 2 file orfani = 4 rimozioni
    expect(result).toBe(4);
  });
});

// -----------------------------------------------------------------------------
// Rami residui di cleanupFileOrfani: ENOENT, urlStorage non parsabile,
// elementi recenti (upload in corso) e stat fallito sui singoli file.
// -----------------------------------------------------------------------------
describe("cleanupFileOrfani - rami residui", () => {
  const ORA = Date.now();

  beforeEach(() => {
    vi.mocked(readdir).mockReset();
    vi.mocked(lstat).mockReset();
    vi.mocked(rm).mockReset();
    mockDb.allegato.findMany.mockReset();
    mockDb.segnalazione.findMany.mockReset();
  });

  it("UPLOADS_ROOT assente (ENOENT) non produce orfani", async () => {
    vi.mocked(readdir).mockRejectedValueOnce(Object.assign(new Error("assente"), { code: "ENOENT" }));
    await expect(cleanupFileOrfani(mockDb as never)).resolves.toBe(0);
    expect(rm).not.toHaveBeenCalled();
  });

  it("un urlStorage non parsabile non protegge il file su disco, che viene rimosso se orfano", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["s1"] as never)
      .mockResolvedValueOnce(["file.jpg"] as never);
    mockDb.allegato.findMany.mockResolvedValue([{ urlStorage: "formato-strano" }]);
    mockDb.segnalazione.findMany.mockResolvedValue([{ id: "s1" }]);
    vi.mocked(lstat)
      .mockResolvedValueOnce({ isDirectory: () => true, mtimeMs: 0 } as never)
      .mockResolvedValueOnce({ mtimeMs: 0 } as never);
    await expect(cleanupFileOrfani(mockDb as never)).resolves.toBe(1);
    expect(rm).toHaveBeenCalledWith(expect.stringContaining("file.jpg"), { force: true });
  });

  it("una directory orfana modificata di recente viene saltata", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["sconosciuta"] as never);
    vi.mocked(lstat).mockResolvedValueOnce({ isDirectory: () => true, mtimeMs: ORA } as never);
    mockDb.allegato.findMany.mockResolvedValue([]);
    mockDb.segnalazione.findMany.mockResolvedValue([]);
    await expect(cleanupFileOrfani(mockDb as never)).resolves.toBe(0);
    expect(rm).not.toHaveBeenCalled();
  });

  it("un file orfano modificato di recente viene saltato", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["s1"] as never)
      .mockResolvedValueOnce(["appena-caricato.jpg"] as never);
    vi.mocked(lstat)
      .mockResolvedValueOnce({ isDirectory: () => true, mtimeMs: 0 } as never)
      .mockResolvedValueOnce({ mtimeMs: ORA } as never);
    mockDb.allegato.findMany.mockResolvedValue([]);
    mockDb.segnalazione.findMany.mockResolvedValue([{ id: "s1" }]);
    await expect(cleanupFileOrfani(mockDb as never)).resolves.toBe(0);
    expect(rm).not.toHaveBeenCalled();
  });

  it("un file orfano il cui stat fallisce viene saltato senza rimozione", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["s1"] as never)
      .mockResolvedValueOnce(["senza-stat.jpg"] as never);
    vi.mocked(lstat)
      .mockResolvedValueOnce({ isDirectory: () => true, mtimeMs: 0 } as never)
      .mockRejectedValueOnce(new Error("stat fallito"));
    mockDb.allegato.findMany.mockResolvedValue([]);
    mockDb.segnalazione.findMany.mockResolvedValue([{ id: "s1" }]);
    await expect(cleanupFileOrfani(mockDb as never)).resolves.toBe(0);
    expect(rm).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Errore su una singola transizione: viene registrato e il cron prosegue.
// -----------------------------------------------------------------------------

describe("transizioneAutomaticaInviata - errore sul singolo record", () => {
  it("una transazione fallita viene saltata e il conteggio non include il record", async () => {
    const db = {
      segnalazione: { findMany: vi.fn().mockResolvedValue([{ id: "s-errata" }]) },
      $transaction: vi.fn().mockRejectedValue(new Error("deadlock")),
    };
    await expect(transizioneAutomaticaInviata(db as never, null)).resolves.toBe(0);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
