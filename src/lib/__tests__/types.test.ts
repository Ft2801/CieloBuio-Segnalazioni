/**
 * Test completi per src/lib/types.ts
 */
import { describe, it, expect } from "vitest";
import {
  STATI_SEGNALAZIONE,
  TRANSIZIONI_LECITE,
  labelStato,
  coloreStato,
  labelRuolo,
} from "@/lib/types";

describe("STATI_SEGNALAZIONE", () => {
  it("ha 7 stati", () => {
    expect(STATI_SEGNALAZIONE).toHaveLength(7);
  });

  it("ogni stato ha value, label, colore, descrizione", () => {
    for (const s of STATI_SEGNALAZIONE) {
      expect(s.value).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.colore).toBeTruthy();
      expect(s.descrizione).toBeTruthy();
    }
  });

  it("contiene tutti gli stati attesi", () => {
    const values = STATI_SEGNALAZIONE.map((s) => s.value);
    expect(values).toContain("bozza");
    expect(values).toContain("in_revisione");
    expect(values).toContain("approvata");
    expect(values).toContain("inviata");
    expect(values).toContain("in_attesa");
    expect(values).toContain("chiusa_positiva");
    expect(values).toContain("chiusa_negativa");
  });
});

describe("TRANSIZIONI_LECITE", () => {
  it("bozza -> solo in_revisione", () => {
    expect(TRANSIZIONI_LECITE["bozza"]).toEqual(["in_revisione"]);
  });

  it("in_revisione -> bozza o approvata", () => {
    expect(TRANSIZIONI_LECITE["in_revisione"]).toEqual(["bozza", "approvata"]);
  });

  it("approvata -> solo in_revisione (inviata richiede endpoint dedicato)", () => {
    expect(TRANSIZIONI_LECITE["approvata"]).toEqual(["in_revisione"]);
  });

  it("inviata -> solo in_attesa", () => {
    expect(TRANSIZIONI_LECITE["inviata"]).toEqual(["in_attesa"]);
  });

  it("in_attesa -> chiusa_positiva, chiusa_negativa (no inviata)", () => {
    expect(TRANSIZIONI_LECITE["in_attesa"]).toEqual(["chiusa_positiva", "chiusa_negativa"]);
  });

  it("chiusa_positiva -> nessuna transizione", () => {
    expect(TRANSIZIONI_LECITE["chiusa_positiva"]).toEqual([]);
  });

  it("chiusa_negativa -> solo in_attesa", () => {
    expect(TRANSIZIONI_LECITE["chiusa_negativa"]).toEqual(["in_attesa"]);
  });
});

describe("labelStato", () => {
  it("ritorna label corretta per stati validi", () => {
    expect(labelStato("bozza")).toBe("Bozza");
    expect(labelStato("in_revisione")).toBe("In revisione");
    expect(labelStato("approvata")).toBe("Approvata");
    expect(labelStato("inviata")).toBe("Inviata");
    expect(labelStato("in_attesa")).toBe("In attesa");
    expect(labelStato("chiusa_positiva")).toBe("Chiusa positiva");
    expect(labelStato("chiusa_negativa")).toBe("Chiusa negativa");
  });

  it("ritorna la stringa originale per stati non validi", () => {
    expect(labelStato("unknown")).toBe("unknown");
    expect(labelStato("")).toBe("");
  });
});

describe("coloreStato", () => {
  it("ritorna colore per stati validi", () => {
    expect(coloreStato("bozza")).toBe("bg-slate-500");
    expect(coloreStato("inviata")).toBe("bg-emerald-600");
  });

  it("ritorna colore default per stati non validi", () => {
    expect(coloreStato("unknown")).toBe("bg-slate-500");
  });
});

describe("labelRuolo", () => {
  it("ritorna label corretta per ruoli validi", () => {
    expect(labelRuolo("volontario")).toBe("Volontario");
    expect(labelRuolo("referente_provinciale")).toBe("Referente provinciale");
    expect(labelRuolo("referente_regionale")).toBe("Referente regionale");
    expect(labelRuolo("admin")).toBe("Amministratore");
  });

  it("ritorna la stringa originale per ruoli non validi", () => {
    expect(labelRuolo("superadmin")).toBe("superadmin");
    expect(labelRuolo("")).toBe("");
  });
});
