/**
 * Routing a query string: lettura, costruzione degli href e consenso per ruolo.
 */
import { describe, it, expect } from "vitest";
import { hrefDaVista, vistaConsentita, vistaDaQuery, type Vista } from "@/lib/rotta";

const ID_LUNGO = "a".repeat(64);

describe("vistaDaQuery", () => {
  it("senza parametri apre la dashboard", () => {
    expect(vistaDaQuery("")).toEqual({ name: "dashboard" });
    expect(vistaDaQuery("?")).toEqual({ name: "dashboard" });
  });

  it("una vista sconosciuta ricade sulla dashboard", () => {
    expect(vistaDaQuery("?v=inesistente")).toEqual({ name: "dashboard" });
    expect(vistaDaQuery("?v=__proto__")).toEqual({ name: "dashboard" });
  });

  it("legge la lista con il filtro di stato e ricade su 'tutti' per valori sconosciuti", () => {
    expect(vistaDaQuery("?v=lista")).toEqual({ name: "lista", stato: "all" });
    expect(vistaDaQuery("?v=lista&stato=bozza")).toEqual({ name: "lista", stato: "bozza" });
    expect(vistaDaQuery("?v=lista&stato=valore-errato")).toEqual({ name: "lista", stato: "all" });
  });

  it("la nuova segnalazione accetta un precedente valido e ignora quello non valido", () => {
    expect(vistaDaQuery("?v=nuova-segnalazione")).toEqual({ name: "nuova-segnalazione" });
    expect(vistaDaQuery("?v=nuova-segnalazione&precedente=s-1_A")).toEqual({
      name: "nuova-segnalazione",
      segnalazionePrecedenteId: "s-1_A",
    });
    expect(vistaDaQuery("?v=nuova-segnalazione&precedente=../etc")).toEqual({ name: "nuova-segnalazione" });
  });

  it("dettaglio e modifica richiedono un id valido, altrimenti ricadono sulla dashboard", () => {
    expect(vistaDaQuery("?v=dettaglio&id=abc")).toEqual({ name: "dettaglio", id: "abc" });
    expect(vistaDaQuery("?v=modifica-segnalazione&id=abc")).toEqual({ name: "modifica-segnalazione", id: "abc" });
    expect(vistaDaQuery("?v=dettaglio")).toEqual({ name: "dashboard" });
    expect(vistaDaQuery("?v=modifica-segnalazione&id=con%20spazio")).toEqual({ name: "dashboard" });
    expect(vistaDaQuery(`?v=dettaglio&id=${"a".repeat(65)}`)).toEqual({ name: "dashboard" });
    expect(vistaDaQuery(`?v=dettaglio&id=${ID_LUNGO}`)).toEqual({ name: "dettaglio", id: ID_LUNGO });
  });

  it("riconosce le viste senza parametri aggiuntivi", () => {
    expect(vistaDaQuery("?v=admin")).toEqual({ name: "admin" });
    expect(vistaDaQuery("?v=reminder")).toEqual({ name: "reminder" });
    expect(vistaDaQuery("?v=guida")).toEqual({ name: "guida" });
  });
});

describe("hrefDaVista", () => {
  it("costruisce href relativi alla pagina corrente", () => {
    expect(hrefDaVista({ name: "dashboard" })).toBe("./");
    expect(hrefDaVista({ name: "lista", stato: "all" })).toBe("?v=lista");
    expect(hrefDaVista({ name: "lista", stato: "inviata" })).toBe("?v=lista&stato=inviata");
    expect(hrefDaVista({ name: "nuova-segnalazione" })).toBe("?v=nuova-segnalazione");
    expect(hrefDaVista({ name: "nuova-segnalazione", segnalazionePrecedenteId: "s-1" })).toBe(
      "?v=nuova-segnalazione&precedente=s-1",
    );
    expect(hrefDaVista({ name: "modifica-segnalazione", id: "s-1" })).toBe("?v=modifica-segnalazione&id=s-1");
    expect(hrefDaVista({ name: "dettaglio", id: "s-1" })).toBe("?v=dettaglio&id=s-1");
    expect(hrefDaVista({ name: "admin" })).toBe("?v=admin");
    expect(hrefDaVista({ name: "reminder" })).toBe("?v=reminder");
    expect(hrefDaVista({ name: "guida" })).toBe("?v=guida");
  });

  it("l'href letto di nuovo dà la stessa vista", () => {
    const viste: Vista[] = [
      { name: "dashboard" },
      { name: "lista", stato: "bozza" },
      { name: "nuova-segnalazione", segnalazionePrecedenteId: "x-9" },
      { name: "modifica-segnalazione", id: "m-1" },
      { name: "dettaglio", id: "d_2" },
      { name: "admin" },
      { name: "reminder" },
      { name: "guida" },
    ];
    for (const vista of viste) {
      expect(vistaDaQuery(hrefDaVista(vista))).toEqual(vista);
    }
  });
});

describe("vistaConsentita", () => {
  it("l'amministrazione è solo per l'admin", () => {
    expect(vistaConsentita({ name: "admin" }, "admin")).toBe(true);
    expect(vistaConsentita({ name: "admin" }, "referente_provinciale")).toBe(false);
    expect(vistaConsentita({ name: "admin" }, "volontario")).toBe(false);
  });

  it("i promemoria sono esclusi per il volontario", () => {
    expect(vistaConsentita({ name: "reminder" }, "volontario")).toBe(false);
    expect(vistaConsentita({ name: "reminder" }, "referente_provinciale")).toBe(true);
  });

  it("le altre viste sono sempre consentite", () => {
    expect(vistaConsentita({ name: "dashboard" }, "volontario")).toBe(true);
    expect(vistaConsentita({ name: "guida" }, "volontario")).toBe(true);
    expect(vistaConsentita({ name: "dettaglio", id: "x" }, "volontario")).toBe(true);
  });
});
