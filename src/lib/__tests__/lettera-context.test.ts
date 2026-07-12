/**
 * Test per buildLetteraContextFromSegnalazione con mock DB
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

describe("buildLetteraContextFromSegnalazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lancia errore se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    await expect(buildLetteraContextFromSegnalazione("fake-id")).rejects.toThrow("Segnalazione non trovata");
  });

  it("lancia errore se regione non determinabile", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", mittenteVisibile: true,
      volontario: { nomeCognome: "Mario", indirizzo: "Via 1", pec: "m@pec.it", emailOrdinaria: null, email: "m@t.it" },
      comune: { nome: "Verdello", pecComune: "p@pec.it", nomeSindaco: "Sindaco" },
      provincia: { sigla: "BG", regione: null },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1", cap: "24040",
      numeroProtocollo: "P1", oggettoPec: "Oggetto",
      testoIntroduttivoPec: "Intro",
      chkVetroPianoInclinato: true, chkVetroCurvo: false, chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false, chkAbbagliamento: false, chkLuceIntrusiva: false,
      chkAltroProblema: false, notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: "Sindaco",
      includiArpa: false,
    } as any);

    await expect(buildLetteraContextFromSegnalazione("s1")).rejects.toThrow("Regione non determinabile");
  });

  it("costruisce il context correttamente con mittenteVisibile=true", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", mittenteVisibile: true,
      volontario: { nomeCognome: "Mario Rossi", indirizzo: "Via Roma 1", pec: "mario@pec.it", emailOrdinaria: "m@t.it", email: "m@t.it" },
      comune: { nome: "Verdello", pecComune: "protocollo@pec.it", nomeSindaco: "Sindaco Test" },
      provincia: { sigla: "BG", regione: { regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", titoloLegge: "Titolo",
        testoProgettoIlluminotecnico: "art 5", testoDeroghe: "art 5.4", testoDatiFotometrici: "art 5b",
        testoApprovazione: "art 6", testoInstallazione: "art 7", testoControllo: "art 10",
        testoSanzioni: "art 13", pecArpaRegionale: "arpa@pec.it" } },
      regione: { regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", titoloLegge: "Titolo",
        testoProgettoIlluminotecnico: "art 5", testoDeroghe: "art 5.4", testoDatiFotometrici: "art 5b",
        testoApprovazione: "art 6", testoInstallazione: "art 7", testoControllo: "art 10",
        testoSanzioni: "art 13", pecArpaRegionale: "arpa@pec.it" },
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via Tigli 5", cap: "24040",
      numeroProtocollo: "20260115-LOM-BG-MR01", oggettoPec: "Oggetto PEC",
      testoIntroduttivoPec: "Testo introduttivo",
      chkVetroPianoInclinato: true, chkVetroCurvo: false, chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: true, chkAbbagliamento: false, chkLuceIntrusiva: false,
      chkAltroProblema: false, notaAltroProblema: null,
      descrizioneLibera: "Descrizione",
      destinatarioNome: "Sindaco Test",
      includiArpa: true,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s1");
    expect(ctx.mittenteNome).toBe("Mario Rossi");
    expect(ctx.mittenteEmail).toBe("mario@pec.it");
    expect(ctx.destinatarioNome).toBe("Sindaco Test");
    expect(ctx.regione).toBe("LOMBARDIA");
    expect(ctx.numeroProtocollo).toBe("20260115-LOM-BG-MR01");
    expect(ctx.includiArpa).toBe(true);
  });

  it("costruisce il context con mittenteVisibile=false (usa placeholder)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s2", mittenteVisibile: false,
      volontario: { nomeCognome: "Mario", indirizzo: "Via 1", pec: null, emailOrdinaria: null, email: "m@t.it" },
      comune: { nome: "Verdello", pecComune: "p@pec.it", nomeSindaco: null },
      provincia: { sigla: "BG", regione: { regione: "LOMBARDIA", riferimentoLegge: "L.R.",
        titoloLegge: "T", testoProgettoIlluminotecnico: "a", testoDeroghe: "b", testoDatiFotometrici: "c",
        testoApprovazione: "d", testoInstallazione: "e", testoControllo: "f",
        testoSanzioni: "g", pecArpaRegionale: "a@p.it" } },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "Via 1", cap: "24040",
      numeroProtocollo: null, oggettoPec: null,
      testoIntroduttivoPec: null,
      chkVetroPianoInclinato: false, chkVetroCurvo: false, chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false, chkAbbagliamento: false, chkLuceIntrusiva: false,
      chkAltroProblema: false, notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: null,
      includiArpa: false,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s2");
    expect(ctx.mittenteNome).toBe("Referente CieloBuio");
    expect(ctx.mittenteEmail).toContain("PEC dell'associazione");
    expect(ctx.numeroProtocollo).toBe("(da assegnare)");
    expect(ctx.destinatarioNome).toContain("Sindaco");
  });

  it("gestisce cap null (es. segnalazione anonimizzata GDPR) restituendo stringa vuota", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s3", mittenteVisibile: true,
      volontario: { nomeCognome: "Mario", indirizzo: "Via 1", pec: "m@pec.it", emailOrdinaria: null, email: "m@t.it" },
      comune: { nome: "Verdello", pecComune: "p@pec.it", nomeSindaco: "Sindaco" },
      provincia: { sigla: "BG", regione: { regione: "LOMBARDIA", riferimentoLegge: "L.R.",
        titoloLegge: "T", testoProgettoIlluminotecnico: "a", testoDeroghe: "b", testoDatiFotometrici: "c",
        testoApprovazione: "d", testoInstallazione: "e", testoControllo: "f",
        testoSanzioni: "g", pecArpaRegionale: "a@p.it" } },
      regione: null,
      dataSegnalazione: new Date(2026, 0, 15),
      indirizzoVia: "[ANONIMIZZATA]", cap: null,
      numeroProtocollo: "P3", oggettoPec: "Oggetto",
      testoIntroduttivoPec: null,
      chkVetroPianoInclinato: false, chkVetroCurvo: false, chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false, chkAbbagliamento: false, chkLuceIntrusiva: false,
      chkAltroProblema: false, notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: "Sindaco",
      includiArpa: false,
    } as any);

    const ctx = await buildLetteraContextFromSegnalazione("s3");
    expect(ctx.cap).toBe("");
    expect(ctx.indirizzoVia).toBe("[ANONIMIZZATA]");
  });
});
