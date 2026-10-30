/**
 * Test per i rami residui di protocollo.ts:
 * - getInizialiSegnalatore: fallback per iniziali troppo corte o assenti
 * - generaNumeroProtocollo: progressivo a tre cifre quando il conteggio supera 99
 * - getRegioneCodice: errore esplicito per regioni vuote o non mappate
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErroreProtocollo, getInizialiSegnalatore, getRegioneCodice, generaNumeroProtocollo } from "@/lib/protocollo";
import { logger } from "@/lib/logger";

// Silenzia i warning logger.warn emessi dal retry del progressivo
beforeEach(() => {
  vi.spyOn(logger, "warn").mockImplementation(() => {});
});

describe("getInizialiSegnalatore - rami fallback", () => {
  it("ritorna XX per stringa di 1 carattere (fallback < 2)", () => {
    expect(getInizialiSegnalatore("X")).toBe("XX");
  });

  it("ritorna XX per stringa vuota con solo whitespace", () => {
    expect(getInizialiSegnalatore("   ")).toBe("XX");
  });

  it("ritorna XX per tab/newline only", () => {
    expect(getInizialiSegnalatore("\t\n")).toBe("XX");
  });

  it("usa inizialiProtocollo anche se più lungo di 2 caratteri (tronca a 2)", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "ABCDE")).toBe("AB");
  });

  it("usa inizialiProtocollo a 2 caratteri case-insensitive", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "xy")).toBe("XY");
  });

  it("gestisce nomi con più di 2 parole", () => {
    // Prende la prima lettera della prima parola e la prima lettera della seconda parola
    expect(getInizialiSegnalatore("Mario Antonio Rossi")).toBe("MA");
    expect(getInizialiSegnalatore("Maria Bianchi Verdi")).toBe("MB");
  });

  it("usa singola parola di 2+ caratteri", () => {
    expect(getInizialiSegnalatore("Mario")).toBe("MA");
    expect(getInizialiSegnalatore("ab")).toBe("AB");
  });
});

describe("getRegioneCodice - regioni non valide", () => {
  it("lancia ErroreProtocollo per regione vuota", () => {
    expect(() => getRegioneCodice("")).toThrow(ErroreProtocollo);
  });

  it("lancia ErroreProtocollo per regione di soli spazi", () => {
    expect(() => getRegioneCodice("   ")).toThrow(ErroreProtocollo);
  });

  it("lancia ErroreProtocollo per regione non mappata, senza fallback", () => {
    expect(() => getRegioneCodice("MARTE")).toThrow(ErroreProtocollo);
    expect(() => getRegioneCodice("A")).toThrow(ErroreProtocollo);
  });

  it("il messaggio indica la regione non riconosciuta", () => {
    expect(() => getRegioneCodice("ZZZ-YYY")).toThrow(/ZZZ-YYY/);
  });

  it("riporta il nome della classe per il controllo nelle route", () => {
    try {
      getRegioneCodice("REGIONE_INESISTENTE");
      throw new Error("atteso errore");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroreProtocollo);
      expect((e as Error).name).toBe("ErroreProtocollo");
    }
  });
});

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";

describe("generaNumeroProtocollo - progressivo >= 100", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gestisce progressivo >= 100 con 3+ cifre", async () => {
    // count ritorna 99, progressivo = 99 + 1 + 0 = 100 -> 3 cifre
    vi.mocked(db.segnalazione.count).mockResolvedValue(99);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "bg",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      inizialiProtocollo: null,
      segnalazioneId: "s1",
    });

    // Il progressivo deve essere 100 (3 cifre, non pad2)
    expect(result).toMatch(/-MR100$/);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", numeroProtocollo: null },
      data: { numeroProtocollo: result },
    });
  });
});
