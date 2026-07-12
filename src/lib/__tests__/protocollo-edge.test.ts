/**
 * Test per i rami residui di protocollo.ts:
 * - getInizialiSegnalatore: fallback length < 2 (riga 89)
 * - generaNumeroProtocollo: progressivo >= 100 (riga 192)
 * - getRegioneCodice: fallback con warning logger
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getInizialiSegnalatore, getRegioneCodice } from "@/lib/protocollo";
import { logger } from "@/lib/logger";

// Silenzia i warning logger.warn emessi da getRegioneCodice per regioni non mappate
// (comportamento atteso nei test di fallback)
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

  it("usa inizialiProtocollo anche se piu lungo di 2 caratteri (tronca a 2)", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "ABCDE")).toBe("AB");
  });

  it("usa inizialiProtocollo a 2 caratteri case-insensitive", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "xy")).toBe("XY");
  });

  it("gestisce nomi con piu di 2 parole", () => {
    // Prende la prima lettera della prima parola e la prima lettera della seconda parola
    expect(getInizialiSegnalatore("Mario Antonio Rossi")).toBe("MA");
    expect(getInizialiSegnalatore("Maria Bianchi Verdi")).toBe("MB");
  });

  it("usa singola parola di 2+ caratteri", () => {
    expect(getInizialiSegnalatore("Mario")).toBe("MA");
    expect(getInizialiSegnalatore("ab")).toBe("AB");
  });
});

describe("getRegioneCodice - rami fallback", () => {
  it("ritorna prime 3 lettere per regione sconosciuta di 3+ caratteri", () => {
    // "MARTE" non è nella tabella, ritorna "MAR"
    expect(getRegioneCodice("MARTE")).toBe("MAR");
  });

  it("ritorna prime 2 lettere per regione sconosciuta di 2 caratteri", () => {
    // "AB" non è nella tabella, ritorna "AB" (slice 0,3 = "AB")
    expect(getRegioneCodice("AB")).toBe("AB");
  });

  it("ritorna stringa vuota per stringa di 1 carattere", () => {
    expect(getRegioneCodice("A")).toBe("A");
  });

  it("ritorna stringa vuota per stringa vuota", () => {
    expect(getRegioneCodice("")).toBe("");
  });

  it("gestisce regione con trattini non mappata", () => {
    // Non nella tabella, fallback prime 3 lettere normalizzate
    expect(getRegioneCodice("ZZZ-YYY")).toBe("ZZZ");
  });

  it("emette un warning logger.warn per regione non mappata", () => {
    const warnSpy = vi.spyOn(logger, "warn");
    getRegioneCodice("REGIONE_INESISTENTE");
    expect(warnSpy).toHaveBeenCalled();
    // logger.warn({ regione, fallback }, "msg") -> args[0] è l'oggetto,
    // args[1] è il messaggio.
    expect(warnSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ regione: "REGIONE_INESISTENTE" })
    );
    expect(warnSpy.mock.calls[0][1]).toContain("Regione non mappata");
  });

  it("NON emette warning per regione mappata", () => {
    const warnSpy = vi.spyOn(logger, "warn");
    getRegioneCodice("LOMBARDIA");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// Test per generaNumeroProtocollo con progressivo >= 100
vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { generaNumeroProtocollo } from "@/lib/protocollo";

describe("generaNumeroProtocollo - progressivo >= 100", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gestisce progressivo >= 100 con 3+ cifre", async () => {
    // count ritorna 99, progressivo = 99 + 1 + 0 = 100 -> 3 cifre
    vi.mocked(db.segnalazione.count).mockResolvedValue(99);
    vi.mocked(db.segnalazione.update).mockResolvedValue({} as any);

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
    expect(db.segnalazione.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { numeroProtocollo: result },
    });
  });
});
