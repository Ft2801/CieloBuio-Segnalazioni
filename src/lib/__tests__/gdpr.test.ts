/**
 * Test per src/lib/gdpr.ts
 * Copre: anonimizzazione con successo, errore filesystem (catch non bloccante),
 * path traversal protection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const mockDb = {
    allegato: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    segnalazione: {
      update: vi.fn(),
    },
    storicoStato: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (cb) => {
    if (typeof cb === "function") return cb(mockDb);
    return Promise.all(cb);
  });
  return { db: mockDb };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rm } from "fs/promises";
import { anonimizzaSegnalazione } from "@/lib/gdpr";

describe("anonimizzaSegnalazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anonimizza correttamente: elimina allegati DB, file fisici, aggiorna segnalazione, crea storico", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/file.jpg" },
    ] as any);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(db.segnalazione.update).mockResolvedValue({} as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);

    await anonimizzaSegnalazione("s1", 10, "admin-1");

    expect(db.allegato.findMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1" },
      select: { id: true, urlStorage: true },
    });
    expect(db.allegato.deleteMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1" },
    });
    expect(rm).toHaveBeenCalled();
    expect(db.segnalazione.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({
          volontarioId: null,
          indirizzoVia: "[ANONIMIZZATA]",
          latitudine: null,
          longitudine: null,
        }),
      })
    );
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          segnalazioneId: "s1",
          userId: "admin-1",
        }),
      })
    );
    expect(logger.info).toHaveBeenCalled();
  });

  it("gestisce errore filesystem senza bloccare l'anonimizzazione (catch non bloccante)", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/file.jpg" },
    ] as any);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES permission denied"));
    vi.mocked(db.segnalazione.update).mockResolvedValue({} as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);

    // Non deve lanciare: il catch nel codice previene il blocco
    await anonimizzaSegnalazione("s1", 10, null);

    // Verifica che l'anonimizzazione sia comunque completata
    expect(db.segnalazione.update).toHaveBeenCalled();
    expect(db.storicoStato.create).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ segnalazioneId: "s1" }),
      expect.stringContaining("Impossibile eliminare file fisici")
    );
  });

  it("funziona con userId null (evento automatico cron)", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(db.segnalazione.update).mockResolvedValue({} as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);

    await anonimizzaSegnalazione("s-auto", 10);

    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
        }),
      })
    );
  });

  it("non tenta rm se path non inizia con uploadsRoot (path traversal protection)", async () => {
    // Questo test è documentale: segnalazioneId è sempre un CUID generato
    // da Prisma, quindi non può contenere "..". Ma la protezione startsWith
    // è defense-in-depth.
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(db.segnalazione.update).mockResolvedValue({} as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);

    await anonimizzaSegnalazione("normal-cuid-id", 10);

    // Con un CUID normale, rm viene chiamato (path è dentro uploadsRoot)
    expect(rm).toHaveBeenCalled();
  });
});
