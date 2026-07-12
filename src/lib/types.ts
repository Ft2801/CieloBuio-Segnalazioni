/**
 * Tipi condivisi tra client e server.
 * Autore: Fabio Tempera (2026)
 */

export type RuoloUtente =
  | "volontario"
  | "referente_provinciale"
  | "referente_regionale"
  | "admin";

export type StatoSegnalazione =
  | "bozza"
  | "in_revisione"
  | "approvata"
  | "inviata"
  | "in_attesa"
  | "chiusa_positiva"
  | "chiusa_negativa";

export const STATI_SEGNALAZIONE: { value: StatoSegnalazione; label: string; colore: string; descrizione: string }[] = [
  { value: "bozza", label: "Bozza", colore: "bg-slate-500", descrizione: "Creata dal volontario, non ancora inviata al referente" },
  { value: "in_revisione", label: "In revisione", colore: "bg-amber-500", descrizione: "Inviata al referente territoriale per approvazione" },
  { value: "approvata", label: "Approvata", colore: "bg-blue-500", descrizione: "Approvata dal referente, pronta per l'invio PEC" },
  { value: "inviata", label: "Inviata", colore: "bg-emerald-600", descrizione: "PEC inviata al Comune (e ARPA se richiesto)" },
  { value: "in_attesa", label: "In attesa", colore: "bg-cyan-600", descrizione: "In attesa di risposta dall'amministrazione" },
  { value: "chiusa_positiva", label: "Chiusa positiva", colore: "bg-green-700", descrizione: "Impianto adeguato" },
  { value: "chiusa_negativa", label: "Chiusa negativa", colore: "bg-rose-700", descrizione: "Nessun adeguamento, valutare escalation" },
];

export function labelStato(stato: string): string {
  return STATI_SEGNALAZIONE.find((s) => s.value === stato)?.label ?? stato;
}

/**
 * Matrice delle transizioni lecite tra stati. Definita qui come unica
 * fonte di verità condivisa tra frontend (dettaglio-segnalazione.tsx)
 * e backend (cambia-stato/route.ts). Se modificata qui, entrambi i
 * lati si allineano automaticamente.
 *
 * L'admin può forzare transizioni non lecite via API (?force=1), ma
 * l'UI non espone questa possibilità.
 */
export const TRANSIZIONI_LECITE: Record<string, string[]> = {
  bozza: ["in_revisione"],
  in_revisione: ["bozza", "approvata"],
  // "inviata" NON è inclusa: per passare ad "inviata" si DEVE usare
  // l'endpoint dedicato /invia-pec che genera il numero di protocollo,
  // imposta dataInvio e crea il log PEC. Il cambia-stato generico non
  // deve poter bypassare questo flusso.
  approvata: ["in_revisione"],
  inviata: ["in_attesa"],
  // "inviata" non è inclusa: da in_attesa non si può tornare a inviata.
  // Per re-inviare una PEC si deve creare una nuova segnalazione recidiva
  // (chiudere negativamente e collegare una nuova segnalazione).
  in_attesa: ["chiusa_positiva", "chiusa_negativa"],
  chiusa_positiva: [],
  chiusa_negativa: ["in_attesa"],
};

export function coloreStato(stato: string): string {
  return STATI_SEGNALAZIONE.find((s) => s.value === stato)?.colore ?? "bg-slate-500";
}

/**
 * Limite massimo di allegati per segnalazione. Centralizzato qui come
 * unica fonte di verità condivisa tra frontend (form-segnalazione.tsx
 * per la UI di blocco upload) e backend (upload/route.ts per la
 * validazione server-side). Se modificato qui, entrambi i lati si
 * allineano automaticamente, evitando drift tra client e server.
 */
export const MAX_ALLEGATI_PER_SEGNALAZIONE = 4;

/**
 * Dimensione massima di un singolo allegato in byte (10 MB).
 * Centralizzata per coerenza tra client e server.
 */
export const MAX_ALLEGATO_BYTE = 10 * 1024 * 1024;

export function labelRuolo(ruolo: string): string {
  switch (ruolo) {
    case "volontario":
      return "Volontario";
    case "referente_provinciale":
      return "Referente provinciale";
    case "referente_regionale":
      return "Referente regionale";
    case "admin":
      return "Amministratore";
    default:
      return ruolo;
  }
}

export type SessionUser = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: RuoloUtente;
  provinciaId: number | null;
  regioneId: number | null;
  inizialiProtocollo: string | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  firma: string | null;
};

export type Segnalazione = {
  id: string;
  numeroProtocollo: string | null;
  dataSegnalazione: string;
  stato: StatoSegnalazione;
  volontarioId: string | null; // Nullable per anonimizzazione GDPR
  referenteApprovatoreId: string | null;
  notaRifiuto: string | null;
  indirizzoVia: string;
  comuneId: number | null;
  cap: string | null;
  provinciaId: number | null;
  regioneId: number | null;
  latitudine: number | null;
  longitudine: number | null;
  nomeEsercizio: string | null;
  chkVetroPianoInclinato: boolean;
  chkVetroCurvo: boolean;
  chkAltroTipologia: boolean;
  notaAltroTipologia: string | null;
  chkLuceVersoAlto: boolean;
  chkAbbagliamento: boolean;
  chkLuceIntrusiva: boolean;
  chkAltroProblema: boolean;
  notaAltroProblema: string | null;
  descrizioneLibera: string | null;
  destinatarioNome: string | null;
  includiArpa: boolean;
  pecCcAggiuntive: string | null;
  oggettoPec: string | null;
  testoIntroduttivoPec: string | null;
  mittenteVisibile: boolean;
  dataInvio: string | null;
  dataChiusura: string | null;
  segnalazionePrecedenteId: string | null;
  livelloRecidiva: number;
  createdAt: string;
  updatedAt: string;
  comune?: { id: number; nome: string; pecComune: string; nomeSindaco: string | null } | null;
  provincia?: { id: number; sigla: string; nome: string } | null;
  regione?: { id: number; regione: string; riferimentoLegge: string } | null;
  volontario?: { id: string; nomeCognome: string; email: string };
  referenteApprovatore?: { id: string; nomeCognome: string } | null;
  allegati?: Allegato[];
  // _count è opzionale perché non tutte le query lo includono
  // (es. GET /api/segnalazioni/[id] carica gli allegati completi,
  // mentre GET /api/segnalazioni lista usa _count per efficienza).
  _count?: { allegati: number };
  storicoStati?: StoricoStato[];
};

export type Allegato = {
  id: string;
  segnalazioneId: string;
  tipo: string;
  /**
   * Identificatore logico interno usato SOLO lato server per risolvere il
   * file su /storage/uploads/. NON è un URL pubblico: non usarlo mai come
   * href/src nei componenti React. Per mostrare o scaricare l'allegato usa
   * sempre `/api/allegati/${allegato.id}/download`, che verifica i permessi
   * prima di servire il file.
   */
  urlStorage: string;
  nomeOriginale: string;
  createdAt: string;
};

export type StoricoStato = {
  id: string;
  segnalazioneId: string;
  statoPrecedente: string | null;
  statoNuovo: string | null; // Nullable per eventi non-transizione (es. anonimizzazione GDPR)
  // userId nullable per supportare eventi automatici (cron job,
  // transizioni di sistema) senza attribuirli a un utente reale.
  userId: string | null;
  timestamp: string;
  nota: string | null;
  user?: { id: string; nomeCognome: string; ruolo: string } | null;
};
