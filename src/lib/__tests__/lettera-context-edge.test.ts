/**
 * Test per i rami residui di lettera.ts in buildLetteraContextFromSegnalazione.
 * Copre:
 * - mittenteVisibile=true con volontario.indirizzo=null (riga 325)
 * - mittenteVisibile=true con volontario.pec=null, emailOrdinaria=null, email valida (riga 330-333)
 * - mittenteVisibile=false con comune.nomeSindaco=null + destinatarioNome=null (riga 344-345)
 * - regione derivata solo da provincia.regione (riga 320, ramo s.regione=null)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { buildLetteraContextFromSegnalazione } from "@/lib/lettera";

describe("buildLetteraContextFromSegnalazione - rami residui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mittenteVisibile=true con indirizzo null -> 'non disponibile'", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Mario",
        indirizzo: null,
        pec: null,
        emailOrdinaria: null,
        email: "mario@example.com",
      },
      comune: { nome: "Verdello", pecComune: "p@pec.it", nomeSindaco: "Sindaco" },
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
    expect(ctx.mittenteIndirizzo).toBe("non disponibile");
    // Con pec=null, emailOrdinaria=null, usa email come fallback
    expect(ctx.mittenteEmail).toBe("mario@example.com");
  });

  it("mittenteVisibile=true con pec=null, emailOrdinaria non-null", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s2",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Luigi",
        indirizzo: "Via 2",
        pec: null,
        emailOrdinaria: "luigi@ord.it",
        email: "luigi@example.com",
      },
      comune: { nome: "Bergamo", pecComune: "comune@pec.it", nomeSindaco: "Sindaco" },
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
          pecArpaRegionale: null,
        },
      },
      regione: null,
      dataSegnalazione: new Date(2026, 5, 10),
      indirizzoVia: "Via 2",
      cap: "24100",
      numeroProtocollo: "P2",
      oggettoPec: "O2",
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

    const ctx = await buildLetteraContextFromSegnalazione("s2");
    expect(ctx.mittenteEmail).toBe("luigi@ord.it");
    expect(ctx.pecArpaRegionale).toBeNull();
  });

  it("mittenteVisibile=false: usa placeholder per nome, indirizzo, email", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s3",
      mittenteVisibile: false,
      volontario: {
        nomeCognome: "Segreto",
        indirizzo: "Via Segreta",
        pec: "segreto@pec.it",
        emailOrdinaria: "s@ord.it",
        email: "s@example.com",
      },
      comune: { nome: "Milano", pecComune: "milano@pec.it", nomeSindaco: null },
      provincia: {
        sigla: "MI",
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
          pecArpaRegionale: "arpa@pec.it",
        },
      },
      regione: null,
      dataSegnalazione: new Date(2026, 2, 20),
      indirizzoVia: "Via 3",
      cap: "20100",
      numeroProtocollo: null,
      oggettoPec: null,
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
      includiArpa: true,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s3");
    expect(ctx.mittenteNome).toBe("Referente CieloBuio");
    expect(ctx.mittenteIndirizzo).toBe(
      "CieloBuio, Coordinamento per la protezione del cielo notturno"
    );
    expect(ctx.mittenteEmail).toContain("da configurare nel pannello amministrazione");
    expect(ctx.destinatarioNome).toContain("Sindaco");
    // numeroProtocollo null -> "(da assegnare)"
    expect(ctx.numeroProtocollo).toBe("(da assegnare)");
    // oggettoPec null -> default
    expect(ctx.oggettoPec).toBe("Segnalazione impianto di illuminazione non conforme");
  });

  it("usa regione diretta (s.regione) quando presente (non provincia.regione)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s4",
      mittenteVisibile: true,
      volontario: {
        nomeCognome: "Mario",
        indirizzo: "Via 1",
        pec: "m@pec.it",
        emailOrdinaria: null,
        email: "m@t.it",
      },
      comune: { nome: "Roma", pecComune: "r@pec.it", nomeSindaco: "Sindaco" },
      provincia: { sigla: "RM", regione: null },
      regione: {
        regione: "LAZIO",
        riferimentoLegge: "L.R. 25/23",
        titoloLegge: "T",
        testoProgettoIlluminotecnico: "a",
        testoDeroghe: "b",
        testoDatiFotometrici: "c",
        testoApprovazione: "d",
        testoInstallazione: "e",
        testoControllo: "f",
        testoSanzioni: "g",
        pecArpaRegionale: "arpa@pec.it",
      },
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1",
      cap: "00100",
      numeroProtocollo: "P4",
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

    const ctx = await buildLetteraContextFromSegnalazione("s4");
    expect(ctx.regione).toBe("LAZIO");
    expect(ctx.riferimentoLegge).toBe("L.R. 25/23");
  });

  it("volontario null (anonimizzazione GDPR): mittenteVisibile=true usa placeholder ANONIMIZZATA", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-anon",
      mittenteVisibile: true,
      volontario: null, // Anonimizzato
      comune: { nome: "Roma", pecComune: "r@pec.it", nomeSindaco: "Sindaco" },
      provincia: {
        sigla: "RM",
        regione: {
          regione: "LAZIO", riferimentoLegge: "L.R.",
          titoloLegge: "T", testoProgettoIlluminotecnico: "a", testoDeroghe: "b",
          testoDatiFotometrici: "c", testoApprovazione: "d", testoInstallazione: "e",
          testoControllo: "f", testoSanzioni: "g", pecArpaRegionale: "a@p.it",
        },
      },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1",
      cap: "00100",
      numeroProtocollo: "P-anon",
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

    const ctx = await buildLetteraContextFromSegnalazione("s-anon");
    // Tutti i campi del mittente devono cadere nel fallback "[ANONIMIZZATA]"
    expect(ctx.mittenteNome).toBe("[ANONIMIZZATA]");
    expect(ctx.mittenteIndirizzo).toBe("non disponibile");
    expect(ctx.mittenteEmail).toBe("[ANONIMIZZATA]");
  });
});
