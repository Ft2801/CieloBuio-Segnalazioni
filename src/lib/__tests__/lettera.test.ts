/**
 * Test completi per src/lib/lettera.ts
 */
import { describe, it, expect } from "vitest";
import { generaTestoLettera, type LetteraContext } from "@/lib/lettera";

const ctxBase: LetteraContext = {
  mittenteNome: "Mario Rossi",
  mittenteIndirizzo: "Via Roma 1, Bergamo",
  mittenteEmail: "mario@pec.it",
  destinatarioNome: "Sindaco Luca Bianchi",
  comuneNome: "Verdello",
  pecComune: "protocollo@pec.comune.verdello.it",
  indirizzoVia: "Via dei Tigli 5",
  cap: "24040",
  provinciaSigla: "BG",
  regione: "LOMBARDIA",
  riferimentoLegge: "L.R. 31/15",
  titoloLegge: "Disposizioni per il contenimento dell'inquinamento luminoso",
  testoProgettoIlluminotecnico: "art. 5, comma 1, lettera a)",
  testoDeroghe: "art. 5, comma 4",
  testoDatiFotometrici: "art. 5, comma 1, lettera b)",
  testoApprovazione: "art. 6",
  testoInstallazione: "art. 7",
  testoControllo: "art. 10",
  testoSanzioni: "art. 13",
  pecArpaRegionale: "arpa@pec.regione.it",
  numeroProtocollo: "20260115-LOM-BG-MR01",
  oggettoPec: "Segnalazione impianto non conforme",
  chkVetroPianoInclinato: true,
  chkVetroCurvo: false,
  chkAltroTipologia: false,
  chkLuceVersoAlto: true,
  chkAbbagliamento: false,
  chkLuceIntrusiva: false,
  chkAltroProblema: false,
  includiArpa: false,
  luogoData: "Verdello, 15 gennaio 2026",
};

describe("generaTestoLettera", () => {
  it("contiene il mittente", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("Mario Rossi");
    expect(testo).toContain("Via Roma 1, Bergamo");
    expect(testo).toContain("mario@pec.it");
  });

  it("contiene il destinatario", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("Sindaco Luca Bianchi");
    expect(testo).toContain("Verdello");
    expect(testo).toContain("protocollo@pec.comune.verdello.it");
  });

  it("contiene il numero di protocollo", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("20260115-LOM-BG-MR01");
  });

  it("contiene la legge regionale", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("L.R. 31/15");
  });

  it("contiene le checkbox selezionate come [X]", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("[X]");
    expect(testo).toContain("piana inclinata");
    expect(testo).toContain("Emissione di luce verso l'alto");
  });

  it("include il testo introduttivo se presente", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      testoIntroduttivoPec: "Si segnala la presenza di un impianto non conforme.",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Si segnala la presenza di un impianto non conforme.");
  });

  it("non include il testo introduttivo se assente", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).not.toContain("Si segnala");
  });

  it("contiene i link a cielobuio.org", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("https://cielobuio.org/articolo-1110/");
    expect(testo).toContain("https://cielobuio.org/articolo-874/");
  });

  it("contiene il luogo e la data", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("Verdello, 15 gennaio 2026");
  });

  it("contiene l'indirizzo della segnalazione", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("Via dei Tigli 5");
    expect(testo).toContain("24040");
  });

  it("contiene il CAP e la provincia", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("24040");
    expect(testo).toContain("BG");
  });

  it("include nota altro tipologia se selezionato", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      chkAltroTipologia: true,
      notaAltroTipologia: "Lampade LED non schermate",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Lampade LED non schermate");
  });

  it("include nota altro problema se selezionato", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      chkAltroProblema: true,
      notaAltroProblema: "Illuminazione attiva di notte",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Illuminazione attiva di notte");
  });

  it("include descrizione libera se presente", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      descrizioneLibera: "Note aggiuntive del volontario",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Note aggiuntive del volontario");
  });

  it("contiene riferimento agli artt. 9 e 10 della L. 241/1990", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("artt. 9 e 10");
    expect(testo).toContain("241");
  });

  it("contiene 'In Fede' alla fine", () => {
    const testo = generaTestoLettera(ctxBase);
    expect(testo).toContain("In Fede");
    expect(testo).toContain("Mario Rossi");
  });

  it("gestisce tutte le checkbox false", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("nessuna tipologia specificata");
    expect(testo).toContain("nessun problema specificato");
  });
});
