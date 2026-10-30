/**
 * Test completi per src/lib/utils.ts e src/lib/demo-data.ts
 */
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";
import { DEMO_SEGNALAZIONI, DEMO_STATS, getDemoSegnalazione } from "@/lib/demo-data";

describe("cn (className utility)", () => {
  it("combina classi multiple", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("gestisce classi condizionali false", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("gestisce classi condizionali true", () => {
    expect(cn("foo", true && "bar", "baz")).toBe("foo bar baz");
  });

  it("gestisce undefined è null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("risolve conflitti Tailwind con twMerge", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("gestisce stringa vuota", () => {
    expect(cn("", "foo")).toBe("foo");
  });

  it("gestisce nessun argomento", () => {
    expect(cn()).toBe("");
  });
});

describe("DEMO_STATS", () => {
  it("ha tutte le proprietà attese", () => {
    expect(DEMO_STATS).toHaveProperty("totali");
    expect(DEMO_STATS).toHaveProperty("bozze");
    expect(DEMO_STATS).toHaveProperty("inRevisione");
    expect(DEMO_STATS).toHaveProperty("approvate");
    expect(DEMO_STATS).toHaveProperty("inviate");
    expect(DEMO_STATS).toHaveProperty("inAttesa");
    expect(DEMO_STATS).toHaveProperty("chiusePositive");
    expect(DEMO_STATS).toHaveProperty("chiuseNegative");
    expect(DEMO_STATS).toHaveProperty("recidive");
    expect(DEMO_STATS).toHaveProperty("inAttesaOverdue");
  });

  it("i conteggi coincidono con le segnalazioni demo (la dashboard usa DEMO_STATS)", () => {
    const conta = (stato: string) => DEMO_SEGNALAZIONI.filter((s) => s.stato === stato).length;
    expect(DEMO_STATS.totali).toBe(DEMO_SEGNALAZIONI.length);
    expect(DEMO_STATS.bozze).toBe(conta("bozza"));
    expect(DEMO_STATS.inRevisione).toBe(conta("in_revisione"));
    expect(DEMO_STATS.approvate).toBe(conta("approvata"));
    expect(DEMO_STATS.inviate).toBe(conta("inviata"));
    expect(DEMO_STATS.inAttesa).toBe(conta("in_attesa"));
    expect(DEMO_STATS.chiusePositive).toBe(conta("chiusa_positiva"));
    expect(DEMO_STATS.chiuseNegative).toBe(conta("chiusa_negativa"));
    expect(DEMO_STATS.recidive).toBe(DEMO_SEGNALAZIONI.filter((s) => s.livelloRecidiva >= 2).length);
  });

  it("i valori sono numeri", () => {
    for (const val of Object.values(DEMO_STATS)) {
      expect(typeof val).toBe("number");
    }
  });
});

describe("DEMO_SEGNALAZIONI", () => {
  it("ha 5 segnalazioni demo", () => {
    expect(DEMO_SEGNALAZIONI).toHaveLength(5);
  });

  it("ogni segnalazione ha id è stato", () => {
    for (const s of DEMO_SEGNALAZIONI) {
      expect(s.id).toBeTruthy();
      expect(s.stato).toBeTruthy();
    }
  });

  it("contiene almeno una segnalazione per ogni stato principale", () => {
    const stati = DEMO_SEGNALAZIONI.map((s) => s.stato);
    expect(stati).toContain("bozza");
    expect(stati).toContain("in_revisione");
    expect(stati).toContain("approvata");
    expect(stati).toContain("inviata");
    expect(stati).toContain("in_attesa");
  });

  it("le segnalazioni hanno comune e provincia", () => {
    for (const s of DEMO_SEGNALAZIONI) {
      expect(s.comune).toBeTruthy();
      expect(s.provincia).toBeTruthy();
    }
  });
});

describe("getDemoSegnalazione", () => {
  it("ritorna la segnalazione per id valido", () => {
    const s = getDemoSegnalazione("demo-1");
    expect(s).not.toBeNull();
    expect(s?.id).toBe("demo-1");
  });

  it("ritorna null per id non esistente", () => {
    expect(getDemoSegnalazione("non-existent")).toBeNull();
  });

  it("ritorna null per stringa vuota", () => {
    expect(getDemoSegnalazione("")).toBeNull();
  });
});
