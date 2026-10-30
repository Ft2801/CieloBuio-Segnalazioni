import { describe, it, expect } from "vitest";
import { messaggioDaErrore } from "@/lib/errori";
import { statoFiltroDaParametro } from "@/lib/filtro-stato";

describe("messaggioDaErrore", () => {
  it("restituisce il messaggio di un Error", () => {
    expect(messaggioDaErrore(new Error("guasto"))).toBe("guasto");
  });

  it("converte in stringa qualsiasi altro valore lanciato", () => {
    expect(messaggioDaErrore("testo grezzo")).toBe("testo grezzo");
    expect(messaggioDaErrore(42)).toBe("42");
  });
});

describe("statoFiltroDaParametro", () => {
  it("accetta gli stati validi e il valore all", () => {
    expect(statoFiltroDaParametro("inviata")).toBe("inviata");
    expect(statoFiltroDaParametro("all")).toBe("all");
  });

  it("un valore non riconosciuto ricade su all", () => {
    expect(statoFiltroDaParametro("stato-inventato")).toBe("all");
    expect(statoFiltroDaParametro("")).toBe("all");
  });
});
