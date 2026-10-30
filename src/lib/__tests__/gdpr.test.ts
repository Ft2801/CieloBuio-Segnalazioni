/**
 * Test per src/lib/gdpr.ts.
 * Copre: anonimizzazione con successo, pulizia dei campi liberi e dei log PEC,
 * errore filesystem (non bloccante), protezione del path per id non sicuri.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const mockDb = {
    allegato: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    segnalazione: {
      updateMany: vi.fn(),
    },
    storicoStato: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    logInvioPec: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return cb(mockDb);
    return Promise.all(cb as Promise<unknown>[]);
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

function mockOperazioniComuni() {
  vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
  vi.mocked(db.storicoStato.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.logInvioPec.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 0 } as never);
}

describe("anonimizzaSegnalazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anonimizza correttamente: elimina allegati DB, file fisici, aggiorna segnalazione, crea storico", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([{ id: "a1" }] as never);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(db.storicoStato.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.logInvioPec.updateMany).mockResolvedValue({ count: 0 } as never);

    await anonimizzaSegnalazione(db, "s1", 10, "admin-1");

    expect(db.allegato.deleteMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1" },
    });
    expect(rm).toHaveBeenCalled();
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "s1", volontarioId: { not: null } }),
        data: expect.objectContaining({
          volontarioId: null,
          indirizzoVia: "[ANONIMIZZATA]",
          latitudine: null,
          longitudine: null,
          notaRifiuto: null,
          destinatarioNome: null,
          oggettoPec: null,
          testoIntroduttivoPec: null,
          pecCcAggiuntive: null,
          cap: null,
        }),
      }),
    );
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          segnalazioneId: "s1",
          userId: "admin-1",
        }),
      }),
    );
    expect(logger.info).toHaveBeenCalled();
  });

  it("non anonimizza una pratica riaperta o già anonimizzata dopo la selezione del cron", async () => {
    mockOperazioniComuni();
    vi.mocked(db.segnalazione.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const esito = await anonimizzaSegnalazione(db, "s1", 10, null);
    expect(esito).toBe(false);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "s1",
          volontarioId: { not: null },
          stato: { in: ["chiusa_positiva", "chiusa_negativa"] },
          OR: expect.any(Array),
        }),
      }),
    );
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
    expect(db.storicoStato.create).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it("rimuove le note libere dello storico e i dati personali dei log PEC", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "s1", 10, null);

    expect(db.storicoStato.updateMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1" },
      data: { nota: null },
    });
    expect(db.logInvioPec.updateMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1", tipo: "simula" },
      data: { destinatari: "[ANONIMIZZATA]", oggetto: "[ANONIMIZZATA]", messaggioErrore: null },
    });
    expect(db.logInvioPec.updateMany).toHaveBeenCalledWith({
      where: { segnalazioneId: "s1", tipo: { not: "simula" } },
      data: { oggetto: "[ANONIMIZZATA]", messaggioErrore: null },
    });
  });

  it("esegue tutte le operazioni in un'unica transazione", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "s1", 10, null);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const operazioni = vi.mocked(db.$transaction).mock.calls[0]?.[0];
    expect(typeof operazioni).toBe("function");
    expect(db.segnalazione.updateMany).toHaveBeenCalledTimes(1);
  });

  it("gestisce errore filesystem senza bloccare l'anonimizzazione (catch non bloccante)", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([{ id: "a1" }] as never);
    vi.mocked(rm).mockRejectedValue(new Error("EACCES permission denied"));
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "s1", 10, null);

    expect(db.segnalazione.updateMany).toHaveBeenCalled();
    expect(db.storicoStato.create).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ segnalazioneId: "s1" }),
      expect.stringContaining("Impossibile eliminare file fisici"),
    );
  });

  it("funziona con userId null (evento automatico cron)", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "s-auto", 10);

    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
        }),
      }),
    );
  });

  it("non tenta rm se l'id non è un segmento di path sicuro (path traversal protection)", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "../fuori", 10, null);

    expect(rm).not.toHaveBeenCalled();
    expect(db.segnalazione.updateMany).toHaveBeenCalled();
  });

  it("con un id normale rimuove la directory degli allegati", async () => {
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(rm).mockResolvedValue(undefined);
    mockOperazioniComuni();

    await anonimizzaSegnalazione(db, "normal-cuid-id", 10);

    expect(rm).toHaveBeenCalledWith(expect.stringContaining("normal-cuid-id"), { recursive: true, force: true });
  });
});
