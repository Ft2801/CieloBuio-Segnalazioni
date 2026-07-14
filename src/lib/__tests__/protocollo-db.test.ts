/**
 * Test per generaNumeroProtocollo e calcolaProtocolloPrevisionale
 * con mock del database e di @prisma/client
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock di @prisma/client - la classe deve essere definita dentro la factory
// perché vi.mock è hoisted
vi.mock("@prisma/client", () => {
  class MockPrismaError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = code;
    }
  }
  return {
    Prisma: {
      PrismaClientKnownRequestError: MockPrismaError,
    },
    PrismaClient: vi.fn(),
  };
});

// Mock del modulo db
vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === "function") return fn();
      return fn;
    }),
  },
}));

import { db } from "@/lib/db";
import { generaNumeroProtocollo, calcolaProtocolloPrevisionale } from "@/lib/protocollo";
import { Prisma } from "@prisma/client";

describe("calcolaProtocolloPrevisionale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcola il protocollo previsionale correttamente", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    const result = await calcolaProtocolloPrevisionale({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      inizialiProtocollo: "MR",
    });
    expect(result).toBe("20260115-LOM-BG-MR01");
  });

  it("incrementa il progressivo se esistono già segnalazioni", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(2);
    const result = await calcolaProtocolloPrevisionale({
      data: new Date(2026, 0, 15),
      regione: "VENETO",
      provinciaSigla: "TV",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Luca Bianchi",
    });
    expect(result).toBe("20260115-VEN-TV-LB03");
  });

  it("usa inizialiProtocollo se fornito", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    const result = await calcolaProtocolloPrevisionale({
      data: new Date(2026, 5, 10),
      regione: "PIEMONTE",
      provinciaSigla: "TO",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      inizialiProtocollo: "XY",
    });
    expect(result).toBe("20260610-PIE-TO-XY01");
  });
});

describe("generaNumeroProtocollo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("genera e persiste il protocollo con successo", async () => {
    vi.mocked(db.$transaction).mockResolvedValue(0);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
    const result = await generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      inizialiProtocollo: "MR",
      segnalazioneId: "seg-1",
    });
    expect(result).toBe("20260115-LOM-BG-MR01");
    expect(db.segnalazione.updateMany).toHaveBeenCalled();
  });

  it("ritenta su collisione P2002 e ha successo", async () => {
    vi.mocked(db.$transaction).mockResolvedValue(0);
    const p2002Error = new (Prisma.PrismaClientKnownRequestError as unknown as new (msg: string, code: string) => Error)("Unique constraint", "P2002");
    vi.mocked(db.segnalazione.updateMany)
      .mockRejectedValueOnce(p2002Error)
      .mockResolvedValueOnce({ count: 1 } as any);

    const result = await generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      segnalazioneId: "seg-1",
    });
    expect(result).toBe("20260115-LOM-BG-MR02");
    expect(db.segnalazione.updateMany).toHaveBeenCalledTimes(2);
  });

  it("lancia errore dopo 10 tentativi falliti", async () => {
    vi.mocked(db.$transaction).mockResolvedValue(0);
    const p2002Error = new (Prisma.PrismaClientKnownRequestError as unknown as new (msg: string, code: string) => Error)("Unique constraint", "P2002");
    vi.mocked(db.segnalazione.updateMany).mockRejectedValue(p2002Error);

    await expect(generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      segnalazioneId: "seg-1",
    })).rejects.toThrow("Impossibile generare un numero di protocollo");
  });

  it("propaga errori non P2002", async () => {
    vi.mocked(db.$transaction).mockResolvedValue(0);
    vi.mocked(db.segnalazione.updateMany).mockRejectedValue(new Error("Connection lost"));

    await expect(generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      segnalazioneId: "seg-1",
    })).rejects.toThrow("Connection lost");
  });
});
