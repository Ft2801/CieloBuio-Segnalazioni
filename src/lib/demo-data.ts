/**
 * Dati statici usati dagli account di accesso dimostrativi (vedi demo-mode.ts).
 *
 * Sono incorporati nel bundle JavaScript: non provengono dal database e
 * non richiedono alcuna connessione di rete. Servono solo a dare un'idea
 * concreta dell'interfaccia (dashboard, lista, dettaglio) quando si
 * naviga con un account dimostrativo, anche a server spento.
 *
 * Non rappresentano segnalazioni reali: nomi di comuni, indirizzi e
 * persone sono di fantasia.
 */

import type { Segnalazione, StatoSegnalazione } from "@/lib/types";

export const DEMO_STATS = {
  sogliaGiorni: 30,
  totali: 5,
  bozze: 1,
  inRevisione: 1,
  approvate: 1,
  inviate: 1,
  inAttesa: 1,
  chiusePositive: 0,
  chiuseNegative: 0,
  recidive: 0,
  inAttesaOverdue: 1,
};

function creaSegnalazioneDemo(
  overrides: Partial<Segnalazione> & { id: string; stato: StatoSegnalazione },
): Segnalazione {
  const base: Segnalazione = {
    id: overrides.id,
    numeroProtocollo: null,
    dataSegnalazione: "2026-05-10T09:00:00.000Z",
    stato: overrides.stato,
    volontarioId: "demo-volontario",
    referenteApprovatoreId: null,
    notaRifiuto: null,
    indirizzoVia: "Via Roma 12",
    comuneId: 1,
    cap: "24049",
    provinciaId: 1,
    regioneId: 1,
    latitudine: null,
    longitudine: null,
    nomeEsercizio: null,
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
    pecCcAggiuntive: null,
    oggettoPec: null,
    testoIntroduttivoPec: null,
    mittenteVisibile: true,
    dataInvio: null,
    dataChiusura: null,
    segnalazionePrecedenteId: null,
    livelloRecidiva: 1,
    createdAt: "2026-05-10T09:00:00.000Z",
    updatedAt: "2026-05-10T09:00:00.000Z",
    comune: {
      id: 1,
      nome: "Castelvetro Lombardo",
      pecComune: "protocollo@pec.castelvetro-lombardo.it",
      nomeSindaco: "Marta Rossi",
    },
    provincia: { id: 1, sigla: "BG", nome: "Bergamo" },
    regione: {
      id: 1,
      regione: "LOMBARDIA",
      riferimentoLegge:
        "Legge Regionale della Lombardia n.31/2015 (art. 11, comma 2: disposizioni transitorie della L.R. 17/2000)",
    },
    volontario: {
      id: "demo-volontario",
      nomeCognome: "Giulia Ferri",
      email: "volontario@demo.cielobuio-segnalazioni.local",
    },
    allegati: [],
    storicoStati: [],
  };
  return { ...base, ...overrides };
}

export const DEMO_SEGNALAZIONI: Segnalazione[] = [
  creaSegnalazioneDemo({
    id: "demo-1",
    stato: "bozza",
    indirizzoVia: "Via dei Platani 4",
    nomeEsercizio: "Capannone dismesso",
    chkLuceVersoAlto: true,
    descrizioneLibera: "Bozza non ancora inviata al referente.",
  }),
  creaSegnalazioneDemo({
    id: "demo-2",
    stato: "in_revisione",
    indirizzoVia: "Via Garibaldi 22",
    chkVetroPianoInclinato: true,
    chkLuceIntrusiva: true,
    descrizioneLibera: "Segnalazione in attesa di revisione da parte del referente territoriale.",
  }),
  creaSegnalazioneDemo({
    id: "demo-3",
    stato: "approvata",
    indirizzoVia: "Piazza Roma 3",
    chkVetroCurvo: true,
    chkAbbagliamento: true,
    referenteApprovatoreId: "demo-referente",
    destinatarioNome: "Sindaco di Castelvetro Lombardo",
  }),
  creaSegnalazioneDemo({
    id: "demo-4",
    stato: "inviata",
    // Formato YYYYMMGG a 8 cifre (12 maggio 2026, coerente con dataSegnalazione).
    numeroProtocollo: "20260512-LOM-BG-GF01",
    dataSegnalazione: "2026-05-12T08:00:00.000Z",
    indirizzoVia: "Via dell'Industria 5",
    chkLuceVersoAlto: true,
    chkAbbagliamento: true,
    referenteApprovatoreId: "demo-referente",
    destinatarioNome: "Sindaco di Castelvetro Lombardo",
    dataInvio: "2026-05-12T10:30:00.000Z",
  }),
  creaSegnalazioneDemo({
    id: "demo-5",
    stato: "in_attesa",
    // Formato YYYYMMGG a 8 cifre (5 maggio 2026, coerente con dataSegnalazione).
    numeroProtocollo: "20260505-LOM-BG-GF01",
    dataSegnalazione: "2026-05-05T07:00:00.000Z",
    indirizzoVia: "Via del Porto 9",
    chkLuceIntrusiva: true,
    referenteApprovatoreId: "demo-referente",
    destinatarioNome: "Sindaco di Castelvetro Lombardo",
    dataInvio: "2026-05-05T08:15:00.000Z",
  }),
];

export function getDemoSegnalazione(id: string): Segnalazione | null {
  return DEMO_SEGNALAZIONI.find((s) => s.id === id) ?? null;
}
