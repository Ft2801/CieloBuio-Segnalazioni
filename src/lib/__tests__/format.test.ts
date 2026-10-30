import { describe, it, expect } from "vitest";
import { formatData, formatDataOra, giorniTrascorsi, nomeTerritorio, plurale } from "@/lib/format";

describe("formatData", () => {
  it("formatta una data ISO in gg/mm/aaaa", () => {
    expect(formatData("2026-05-12T10:00:00.000Z")).toBe("12/05/2026");
  });

  it("accetta anche un oggetto Date", () => {
    expect(formatData(new Date("2026-05-12T10:00:00.000Z"))).toBe("12/05/2026");
  });

  it("ritorna n/d per valori assenti o non validi", () => {
    expect(formatData(null)).toBe("n/d");
    expect(formatData(undefined)).toBe("n/d");
    expect(formatData("")).toBe("n/d");
    expect(formatData("non-una-data")).toBe("n/d");
  });
});

describe("formatDataOra", () => {
  it("formatta data e ora", () => {
    expect(formatDataOra(new Date("2026-05-12T10:30:00.000Z"))).toMatch(/12\/05\/2026.*\d{2}:\d{2}/);
  });

  it("ritorna n/d per valori assenti o non validi", () => {
    expect(formatDataOra(null)).toBe("n/d");
    expect(formatDataOra("non-una-data")).toBe("n/d");
  });
});

describe("giorniTrascorsi", () => {
  const adesso = Date.parse("2026-10-28T12:00:00.000Z");

  it("conta i giorni interi trascorsi", () => {
    expect(giorniTrascorsi("2026-10-18T12:00:00.000Z", adesso)).toBe(10);
  });

  it("ritorna 0 per date assenti, non valide o future", () => {
    expect(giorniTrascorsi(null, adesso)).toBe(0);
    expect(giorniTrascorsi("non-una-data", adesso)).toBe(0);
    expect(giorniTrascorsi("2026-10-30T00:00:00.000Z", adesso)).toBe(0);
  });
});

describe("plurale", () => {
  it("sceglie la forma singolare o plurale", () => {
    expect(plurale(1, "giorno", "giorni")).toBe("1 giorno");
    expect(plurale(2, "giorno", "giorni")).toBe("2 giorni");
  });
});

describe("nomeTerritorio", () => {
  it("riporta i nomi in maiuscolo alla forma di lettura", () => {
    expect(nomeTerritorio("LOMBARDIA")).toBe("Lombardia");
    expect(nomeTerritorio("ALTO ADIGE")).toBe("Alto Adige");
    expect(nomeTerritorio("VALLE D'AOSTA")).toBe("Valle d'Aosta");
    expect(nomeTerritorio("FRIULI-VENEZIA GIULIA")).toBe("Friuli-Venezia Giulia");
  });
});
