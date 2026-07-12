/**
 * Test dedicati per cleanupFileOrfani in src/lib/cron-utils.ts.
 * Copre tutti i rami: directory orfana, file orfano, segmenti non sicuri,
 * stat che fallisce, readdir che fallisce, rm che fallisce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
}));

// Mock path-guard per controllare UPLOADS_ROOT
vi.mock("@/lib/path-guard", () => ({
  UPLOADS_ROOT: "/fake/uploads",
  isSafePathSegment: (v: string) =>
    !!v && typeof v === "string" && !v.includes("..") && !v.includes("/") && !v.includes("\\") && !v.includes("\0"),
}));

// Mock gdpr per evitare chain
vi.mock("@/lib/gdpr", () => ({
  anonimizzaSegnalazione: vi.fn(),
}));

import { readdir, stat, rm } from "fs/promises";
import { cleanupFileOrfani } from "@/lib/cron-utils";

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

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("rimuove directory orfana (nessuna segnalazione corrispondente)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["orphan-dir"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "other-id" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(1);
    expect(rm).toHaveBeenCalledWith(
      expect.stringContaining("orphan-dir"),
      { recursive: true, force: true }
    );
  });

  it("non rimuove directory di segnalazione esistente ma rimuove file orfano al suo interno", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as any) // primo livello: directory
      .mockResolvedValueOnce(["orphan-file.jpg", "valid-file.jpg"] as any); // secondo livello: file
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([
      { urlStorage: "seg-id-1/valid-file.jpg" },
    ]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "seg-id-1" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(1);
    // Verifica che rm sia stato chiamato solo per il file orfano
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(
      expect.stringContaining("orphan-file.jpg"),
      { force: true }
    );
  });

  it("salta entry non sicure (path traversal)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["../etc", "valid-dir"] as any);
    // Per valid-dir (directory di segnalazione esistente), readdir ritorna vuoto
    vi.mocked(readdir).mockResolvedValueOnce([] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "valid-dir" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    // ../etc è saltato da isSafePathSegment, valid-dir esiste come segnalazione
    expect(result).toBe(0);
  });

  it("salta entry che non sono directory (file regolare al primo livello)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["some-file.txt"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("gestisce errore stat (catch → continue)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["dir-err"] as any);
    vi.mocked(stat).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("gestisce errore readdir al secondo livello (catch → continue)", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as any) // primo livello ok
      .mockRejectedValueOnce(new Error("EACCES")); // secondo livello throw
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "seg-id-1" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("gestisce errore rm su directory orfana (catch → continue, non incrementa)", async () => {
    vi.mocked(readdir).mockResolvedValueOnce(["orphan-dir"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "other-id" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("gestisce errore rm su file orfano (catch → continue, non incrementa)", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as any)
      .mockResolvedValueOnce(["orphan-file.jpg"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES"));
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "seg-id-1" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("salta file con nome non sicuro dentro directory esistente", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["seg-id-1"] as any)
      .mockResolvedValueOnce(["../escape", "valid-file.jpg"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([
      { urlStorage: "seg-id-1/valid-file.jpg" },
    ]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "seg-id-1" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    expect(result).toBe(0);
  });

  it("rimuove più directory orfane e più file orfani", async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce(["orphan-1", "orphan-2", "seg-1"] as any)
      .mockResolvedValueOnce(["orphan-file-1.jpg", "orphan-file-2.jpg", "valid.jpg"] as any);
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(mockDb.allegato.findMany).mockResolvedValue([
      { urlStorage: "seg-1/valid.jpg" },
    ]);
    vi.mocked(mockDb.segnalazione.findMany).mockResolvedValue([
      { id: "seg-1" },
    ]);

    const result = await cleanupFileOrfani(mockDb as any);
    // 2 directory orfane + 2 file orfani = 4 rimozioni
    expect(result).toBe(4);
  });
});
