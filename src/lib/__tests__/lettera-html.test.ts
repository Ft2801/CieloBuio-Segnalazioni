/**
 * Test per generaHtmlLettera in src/lib/lettera.ts
 */
import { describe, it, expect } from "vitest";
import { generaHtmlLettera, generaTestoLettera, type LetteraContext } from "@/lib/lettera";

const ctx: LetteraContext = {
  mittenteNome: "Mario Rossi",
  mittenteIndirizzo: "Via Roma 1",
  mittenteEmail: "mario@pec.it",
  destinatarioNome: "Sindaco Rossi",
  comuneNome: "Verdello",
  pecComune: "protocollo@pec.it",
  indirizzoVia: "Via Tigli 5",
  cap: "24049",
  provinciaSigla: "BG",
  regione: "LOMBARDIA",
  riferimentoLegge: "L.R. 31/15",
  titoloLegge: "Titolo legge",
  testoProgettoIlluminotecnico: "art. 5",
  testoDeroghe: "art. 5.4",
  testoDatiFotometrici: "art. 5.b",
  testoApprovazione: "art. 6",
  testoInstallazione: "art. 7",
  testoControllo: "art. 10",
  testoSanzioni: "art. 13",
  numeroProtocollo: "20260115-LOM-BG-MR01",
  oggettoPec: "Segnalazione",
  chkVetroPianoInclinato: true,
  chkVetroCurvo: true,
  chkAltroTipologia: false,
  chkLuceVersoAlto: true,
  chkAbbagliamento: true,
  chkLuceIntrusiva: true,
  chkAltroProblema: false,
  includiArpa: true,
  pecArpaRegionale: "arpa@pec.it",
  luogoData: "Verdello, 15 gennaio 2026",
};

describe("generaHtmlLettera", () => {
  it("produce un documento HTML completo con DOCTYPE", () => {
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("contiene mittente, destinatario e numero di protocollo", () => {
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("Mario Rossi");
    expect(html).toContain("Sindaco Rossi");
    expect(html).toContain("20260115-LOM-BG-MR01");
  });

  it("include nota ARPA se includiArpa=true", () => {
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("Per conoscenza");
    expect(html).toContain("arpa@pec.it");
  });

  it("non include nota ARPA se includiArpa=false", () => {
    const html = generaHtmlLettera({ ...ctx, includiArpa: false });
    expect(html).not.toContain("Per conoscenza");
  });

  it("escapa caratteri HTML nel testo", () => {
    const ctxSpecial: LetteraContext = {
      ...ctx,
      mittenteNome: "Mario <script>alert(1)</script>",
    };
    const html = generaHtmlLettera(ctxSpecial);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("contiene stili CSS per stampa", () => {
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("<style>");
    expect(html).toContain("@page");
    expect(html).toContain("@media print");
  });
});

describe("generaTestoLettera - edge cases", () => {
  it("gestisce tutto falso (nessuna checkbox)", () => {
    const testo = generaTestoLettera({
      ...ctx,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
    });
    expect(testo).toContain("nessuna tipologia specificata");
    expect(testo).toContain("nessun problema specificato");
  });

  it("include notaAltroTipologia solo se chkAltroTipologia=true", () => {
    const testo = generaTestoLettera({
      ...ctx,
      chkAltroTipologia: true,
      notaAltroTipologia: "LED non schermati",
    });
    expect(testo).toContain("LED non schermati");
  });

  it("non include notaAltroTipologia se chkAltroTipologia=false", () => {
    const testo = generaTestoLettera({
      ...ctx,
      chkAltroTipologia: false,
      notaAltroTipologia: "LED non schermati",
    });
    expect(testo).not.toContain("LED non schermati");
  });

  it("include notaAltroProblema solo se chkAltroProblema=true", () => {
    const testo = generaTestoLettera({
      ...ctx,
      chkAltroProblema: true,
      notaAltroProblema: "Accensione notturna",
    });
    expect(testo).toContain("Accensione notturna");
  });

  it("include descrizioneLibera se presente", () => {
    const testo = generaTestoLettera({
      ...ctx,
      descrizioneLibera: "Descrizione libera del volontario",
    });
    expect(testo).toContain("Descrizione libera del volontario");
  });

  it("non include descrizioneLibera se assente", () => {
    const testo = generaTestoLettera(ctx);
    // Senza descrizione libera il testo non contiene segnaposto o stringhe "undefined"
    // e prosegue con la formula di chiusura.
    expect(testo).not.toContain("undefined");
    expect(testo).toContain("Tutto ci");
  });

  it("include testo introduttivo PEC se presente", () => {
    const testo = generaTestoLettera({
      ...ctx,
      testoIntroduttivoPec: "Testo introduttivo custom",
    });
    expect(testo).toContain("Testo introduttivo custom");
  });

  it("contiene il riferimento alla legge nel testo", () => {
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("L.R. 31/15");
    expect(testo).toContain("Titolo legge");
  });
});
