/**
 * Tipi condivisi tra client e server.
 * Autore: Fabio Tempera (2026)
 */

export type RuoloUtente = "volontario" | "referente_provinciale" | "referente_regionale" | "admin";

export type StatoSegnalazione =
  "bozza" | "in_revisione" | "approvata" | "inviata" | "in_attesa" | "chiusa_positiva" | "chiusa_negativa";

/**
 * Stati della segnalazione. Ogni stato ha:
 * - `badge`: classi per l'etichetta di stato (testo scuro su sfondo chiaro,
 *   contrasto >= 4.5:1 secondo WCAG 2.2 AA; il colore non è l'unico
 *   indicatore perché l'etichetta è sempre scritta per esteso);
 * - `punto`: colore pieno per i piccoli indicatori grafici (contrasto >= 3:1
 *   su bianco, WCAG 1.4.11 per i componenti non testuali).
 */
export const STATI_SEGNALAZIONE: {
  value: StatoSegnalazione;
  label: string;
  badge: string;
  punto: string;
  descrizione: string;
}[] = [
  {
    value: "bozza",
    label: "Bozza",
    badge: "bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600",
    punto: "bg-slate-500",
    descrizione: "Creata dal volontario, non ancora inviata al referente",
  },
  {
    value: "in_revisione",
    label: "In revisione",
    badge: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800",
    punto: "bg-amber-600",
    descrizione: "Inviata al referente territoriale per approvazione",
  },
  {
    value: "approvata",
    label: "Approvata",
    badge: "bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-800",
    punto: "bg-blue-700",
    descrizione: "Approvata dal referente, pronta per l'invio PEC",
  },
  {
    value: "inviata",
    label: "Inviata",
    badge:
      "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800",
    punto: "bg-emerald-700",
    descrizione: "PEC inviata al Comune (e ARPA se richiesto)",
  },
  {
    value: "in_attesa",
    label: "In attesa",
    badge: "bg-cyan-100 text-cyan-900 ring-cyan-300 dark:bg-cyan-950 dark:text-cyan-100 dark:ring-cyan-800",
    punto: "bg-cyan-700",
    descrizione: "In attesa di risposta dall'amministrazione",
  },
  {
    value: "chiusa_positiva",
    label: "Chiusa con esito positivo",
    badge: "bg-green-100 text-green-900 ring-green-300 dark:bg-green-950 dark:text-green-100 dark:ring-green-800",
    punto: "bg-green-700",
    descrizione: "Impianto adeguato",
  },
  {
    value: "chiusa_negativa",
    label: "Chiusa con esito negativo",
    badge: "bg-rose-100 text-rose-900 ring-rose-300 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-800",
    punto: "bg-rose-700",
    descrizione: "Nessun adeguamento: è possibile creare una segnalazione collegata per recidiva",
  },
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
 * l'UI non espone questa possibilità. Lo stato "inviata" non è mai
 * forzabile via cambia-stato: è raggiungibile solo tramite /invia-pec
 * che genera il numero di protocollo, imposta dataInvio e crea il
 * log PEC.
 */
export const TRANSIZIONI_LECITE: Record<StatoSegnalazione, StatoSegnalazione[]> = {
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

/** Classi Tailwind per l'etichetta di stato (testo e sfondo a contrasto AA). */
export function coloreStato(stato: string): string {
  return (
    STATI_SEGNALAZIONE.find((s) => s.value === stato)?.badge ??
    "bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600"
  );
}

/** Classe del punto colorato che accompagna lo stato nei grafici e nelle timeline. */
export function puntoStato(stato: string): string {
  return STATI_SEGNALAZIONE.find((s) => s.value === stato)?.punto ?? "bg-slate-500";
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
  // Le date sono stringhe ISO 8601 quando trasmesse via API (JSON non
  // ha tipo Date nativo). Le route API convertono Date Prisma in stringa
  // prima di restituire il JSON. Il codice server-side che lavora con
  // il tipo Prisma direttamente (es. lettera.ts) accede al campo come
  // Date: la conversione esplicita `new Date(s.dataSegnalazione)` è
  // sicura in entrambi i casi (Date passato a new Date ritorna un Date
  // equivalente, stringa ISO viene parsata).
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
  comune?: { id: number; nome: string; cap?: string; pecComune: string; nomeSindaco: string | null } | null;
  provincia?: { id: number; sigla: string; nome: string } | null;
  regione?: { id: number; regione: string; riferimentoLegge: string } | null;
  // volontario è nullable per supportare le segnalazioni anonimizzate
  // (volontarioId=null dopo GDPR retention). Il `| null` esplicito
  // previene accessi `volontario.email` senza null check.
  volontario?: { id: string; nomeCognome: string; email: string } | null;
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
