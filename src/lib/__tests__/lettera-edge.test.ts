/**
 * Test per i rami residui di lettera.ts:
 * - checkbox function diretta (rami true e false)
 * - generaTestoLettera con tutti flag false (rami "nessuna tipologia")
 * - buildLetteraContextFromSegnalazione con comune = null
 * - buildLetteraContextFromSegnalazione con tutti i campi opzionali null
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkbox, generaTestoLettera, generaHtmlLettera, type LetteraContext } from "@/lib/lettera";

describe("checkbox - rami diretti", () => {
  it("ritorna [X] per true", () => {
    expect(checkbox(true)).toBe("[X]");
  });

  it("ritorna [ ] per false", () => {
    expect(checkbox(false)).toBe("[ ]");
  });
});

const ctxBase: LetteraContext = {
  mittenteNome: "Mario Rossi",
  mittenteIndirizzo: "Via Roma 1",
  mittenteEmail: "mario@pec.it",
  destinatarioNome: "Sindaco",
  comuneNome: "Verdello",
  pecComune: "comune@pec.it",
  indirizzoVia: "Via Tigli 5",
  cap: "24040",
  provinciaSigla: "BG",
  regione: "LOMBARDIA",
  riferimentoLegge: "L.R. 31/15",
  titoloLegge: "Titolo",
  testoProgettoIlluminotecnico: "art 5",
  testoDeroghe: "art 5.4",
  testoDatiFotometrici: "art 5b",
  testoApprovazione: "art 6",
  testoInstallazione: "art 7",
  testoControllo: "art 10",
  testoSanzioni: "art 13",
  numeroProtocollo: "20260115-LOM-BG-MR01",
  oggettoPec: "Oggetto",
  chkVetroPianoInclinato: true,
  chkVetroCurvo: false,
  chkAltroTipologia: false,
  notaAltroTipologia: undefined,
  chkLuceVersoAlto: false,
  chkAbbagliamento: false,
  chkLuceIntrusiva: false,
  chkAltroProblema: false,
  notaAltroProblema: undefined,
  descrizioneLibera: undefined,
  includiArpa: false,
  luogoData: "Verdello, 15 gennaio 2026",
};

describe("generaTestoLettera - rami flag false e ARPA", () => {
  it("con tutti i flag false, mostra placeholder 'nessuna tipologià e 'nessun problema'", () => {
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
    expect(testo).toContain("(nessuna tipologia specificata)");
    expect(testo).toContain("(nessun problema specificato)");
  });

  it("con chkAltroTipologia true ma notaAltroTipologia vuota: non aggiunge riga Altro", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      chkAltroTipologia: true,
      notaAltroTipologia: "",
    };
    const testo = generaTestoLettera(ctx);
    // chkAltroTipologia && notaAltroTipologia: false perché stringa vuota
    expect(testo).not.toContain("Altro:");
  });

  it("con chkAltroProblema true e notaAltroProblema: aggiunge riga Altro", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      chkAltroProblema: true,
      notaAltroProblema: "Luce lampeggiante",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Altro: Luce lampeggiante");
  });

  it("con includiArpa=true e pecArpaRegionale: HTML contiene sezione ARPA", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      includiArpa: true,
      pecArpaRegionale: "arpa@pec.it",
    };
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("arpa-note");
    expect(html).toContain("ARPA regionale (arpa@pec.it)");
  });

  it("con includiArpa=true ma pecArpaRegionale undefined: HTML senza sezione ARPA nel body", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      includiArpa: true,
      pecArpaRegionale: undefined,
    };
    const html = generaHtmlLettera(ctx);
    // Il CSS contiene sempre ".arpa-note", ma il body non deve avere la nota
    expect(html).not.toContain("Per conoscenza:");
    expect(html).not.toContain("ARPA regionale (");
  });

  it("con testoIntroduttivoPec vuoto: non aggiunge riga", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      testoIntroduttivoPec: "   ",
    };
    const testo = generaTestoLettera(ctx);
    // testoIntroduttivoPec.trim() è vuoto, non viene inserito
    expect(testo).not.toContain("   \n");
  });

  it("con descrizioneLibera: aggiunge la descrizione", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      descrizioneLibera: "Descrizione personalizzata",
    };
    const testo = generaTestoLettera(ctx);
    expect(testo).toContain("Descrizione personalizzata");
  });

  it("escapea caratteri HTML nel testo", () => {
    const ctx: LetteraContext = {
      ...ctxBase,
      mittenteNome: "Mario <script>alert(1)</script>",
    };
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

// Test per buildLetteraContextFromSegnalazione con comune = null
vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { buildLetteraContextFromSegnalazione } from "@/lib/lettera";

describe("buildLetteraContextFromSegnalazione - comune null", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gestisce comune null: usa placeholder vuoti", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Mario",
        indirizzo: "Via 1",
        pec: "m@pec.it",
        emailOrdinaria: null,
        email: "m@t.it",
      },
      comune: null,
      provincia: {
        sigla: "BG",
        regione: {
          regione: "LOMBARDIA",
          riferimentoLegge: "L.R.",
          titoloLegge: "T",
          testoProgettoIlluminotecnico: "a",
          testoDeroghe: "b",
          testoDatiFotometrici: "c",
          testoApprovazione: "d",
          testoInstallazione: "e",
          testoControllo: "f",
          testoSanzioni: "g",
          pecArpaRegionale: "a@p.it",
        },
      },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1",
      cap: "24040",
      numeroProtocollo: "P1",
      oggettoPec: "O",
      testoIntroduttivoPec: null,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
      notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: "Sindaco",
      includiArpa: false,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s1");
    expect(ctx.comuneNome).toBe("");
    expect(ctx.pecComune).toBe("");
    expect(ctx.destinatarioNome).toBe("Sindaco");
  });

  it("comune null e destinatarioNome null: usa placeholder Sindaco vuoto", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s2",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Mario",
        indirizzo: "Via 1",
        pec: "m@pec.it",
        emailOrdinaria: null,
        email: "m@t.it",
      },
      comune: null,
      provincia: {
        sigla: "BG",
        regione: {
          regione: "LOMBARDIA",
          riferimentoLegge: "L.R.",
          titoloLegge: "T",
          testoProgettoIlluminotecnico: "a",
          testoDeroghe: "b",
          testoDatiFotometrici: "c",
          testoApprovazione: "d",
          testoInstallazione: "e",
          testoControllo: "f",
          testoSanzioni: "g",
          pecArpaRegionale: "a@p.it",
        },
      },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1",
      cap: "24040",
      numeroProtocollo: "P1",
      oggettoPec: "O",
      testoIntroduttivoPec: null,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
      notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: null,
      includiArpa: false,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s2");
    // destinatarioNome null e comune null -> "Sindaco" (con nomeSindaco vuoto)
    expect(ctx.destinatarioNome).toBe("Sindaco");
  });

  it("provincia null: provinciaSigla è stringa vuota (ramo ??)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s3",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Mario",
        indirizzo: "Via 1",
        pec: "m@pec.it",
        emailOrdinaria: null,
        email: "m@t.it",
      },
      comune: { nome: "Verdello", pecComune: "p@pec.it", nomeSindaco: "Sindaco" },
      provincia: null, // provincia null -> provinciaSigla = ""
      regione: {
        regione: "LOMBARDIA",
        riferimentoLegge: "L.R.",
        titoloLegge: "T",
        testoProgettoIlluminotecnico: "a",
        testoDeroghe: "b",
        testoDatiFotometrici: "c",
        testoApprovazione: "d",
        testoInstallazione: "e",
        testoControllo: "f",
        testoSanzioni: "g",
        pecArpaRegionale: "a@p.it",
      },
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1",
      cap: "24040",
      numeroProtocollo: "P1",
      oggettoPec: "O",
      testoIntroduttivoPec: null,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
      notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: "Sindaco",
      includiArpa: false,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s3");
    expect(ctx.provinciaSigla).toBe("");
    expect(ctx.regione).toBe("LOMBARDIA");
  });
});
