/**
 * Test completi per src/lib/protocollo.ts
 */
import { describe, it, expect } from "vitest";
import { getRegioneCodice, getInizialiSegnalatore, pad2 } from "@/lib/protocollo";

describe("getRegioneCodice", () => {
  it("ritorna codice corretto per tutte le regioni note", () => {
    expect(getRegioneCodice("LOMBARDIA")).toBe("LOM");
    expect(getRegioneCodice("VENETO")).toBe("VEN");
    expect(getRegioneCodice("PIEMONTE")).toBe("PIE");
    expect(getRegioneCodice("TRENTINO")).toBe("TRE");
    expect(getRegioneCodice("ALTO ADIGE")).toBe("AAD");
    expect(getRegioneCodice("VALLE D'AOSTA")).toBe("VDA");
    expect(getRegioneCodice("LIGURIA")).toBe("LIG");
    expect(getRegioneCodice("EMILIA ROMAGNA")).toBe("EMI");
    expect(getRegioneCodice("TOSCANA")).toBe("TOS");
    expect(getRegioneCodice("UMBRIA")).toBe("UMB");
    expect(getRegioneCodice("MARCHE")).toBe("MAR");
    expect(getRegioneCodice("LAZIO")).toBe("LAZ");
    expect(getRegioneCodice("ABRUZZO")).toBe("ABR");
    expect(getRegioneCodice("MOLISE")).toBe("MOL");
    expect(getRegioneCodice("CAMPANIA")).toBe("CAM");
    expect(getRegioneCodice("PUGLIA")).toBe("PUG");
    expect(getRegioneCodice("BASILICATA")).toBe("BAS");
    expect(getRegioneCodice("CALABRIA")).toBe("CAL");
    expect(getRegioneCodice("SICILIA")).toBe("SIC");
    expect(getRegioneCodice("SARDEGNA")).toBe("SAR");
    expect(getRegioneCodice("FRIULI VENEZIA GIULIA")).toBe("FVG");
  });

  it("normalizza underscore in spazi", () => {
    expect(getRegioneCodice("EMILIA_ROMAGNA")).toBe("EMI");
  });

  it("normalizza trattini in spazi", () => {
    expect(getRegioneCodice("EMILIA-ROMAGNA")).toBe("EMI");
  });

  it("case insensitive", () => {
    expect(getRegioneCodice("lombardia")).toBe("LOM");
    expect(getRegioneCodice("Lombardia")).toBe("LOM");
    expect(getRegioneCodice("LoMbArDiA")).toBe("LOM");
  });

  it("ritorna prime 3 lettere per regioni non mappate", () => {
    expect(getRegioneCodice("MOLISE")).toBe("MOL");
    expect(getRegioneCodice("SICILIA")).toBe("SIC");
  });

  it("gestisce stringa vuota", () => {
    expect(getRegioneCodice("")).toBe("XXX");
  });

  it("gestisce stringa con solo spazi", () => {
    expect(getRegioneCodice("   ")).toBe("XXX");
  });
});

describe("getInizialiSegnalatore", () => {
  it("usa inizialiProtocollo se fornito", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "AB")).toBe("AB");
    expect(getInizialiSegnalatore("Mario Rossi", "ab")).toBe("AB");
    expect(getInizialiSegnalatore("Mario Rossi", "XY")).toBe("XY");
  });

  it("ignora inizialiProtocollo troppo corti", () => {
    expect(getInizialiSegnalatore("Mario Rossi", "A")).toBe("MR");
    expect(getInizialiSegnalatore("Mario Rossi", "")).toBe("MR");
  });

  it("ricava da nome e cognome", () => {
    expect(getInizialiSegnalatore("Mario Rossi")).toBe("MR");
    expect(getInizialiSegnalatore("Fabio Tempera")).toBe("FT");
    expect(getInizialiSegnalatore("Giulia Bianchi")).toBe("GB");
  });

  it("gestisce nome con spazi iniziali/finali", () => {
    expect(getInizialiSegnalatore("  Mario Rossi  ")).toBe("MR");
  });

  it("gestisce singola parola con almeno 2 char", () => {
    expect(getInizialiSegnalatore("Mario")).toBe("MA");
  });

  it("gestisce singola parola di 1 char (fallback XX)", () => {
    expect(getInizialiSegnalatore("M")).toBe("MX");
  });

  it("fallback XX per stringa vuota", () => {
    expect(getInizialiSegnalatore("")).toBe("XX");
    expect(getInizialiSegnalatore("   ")).toBe("XX");
  });

  it("usa inizialiProtocollo anche se nome vuoto", () => {
    expect(getInizialiSegnalatore("", "AB")).toBe("AB");
  });

  it("gestisce nomi con multipli spazi tra parole", () => {
    expect(getInizialiSegnalatore("Mario   Rossi")).toBe("MR");
  });
});

describe("pad2", () => {
  it("padding a 2 cifre per numeri a 1 cifra", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(1)).toBe("01");
    expect(pad2(9)).toBe("09");
  });

  it("non modifica numeri a 2 cifre", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(50)).toBe("50");
    expect(pad2(99)).toBe("99");
  });

  it("non tronca numeri a 3+ cifre", () => {
    expect(pad2(100)).toBe("100");
    expect(pad2(999)).toBe("999");
  });
});
