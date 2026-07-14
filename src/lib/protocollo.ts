/**
 * Generazione del numero di protocollo nel formato
 * YYYYMMGG-REG-PV-NCXX
 * - YYYY = anno (4 cifre)
 * - MM = mese (2 cifre)
 * - GG = giorno (2 cifre)
 * - REG = sigla regione (3 lettere maiuscole, es. LOM)
 * - PV = sigla provincia (2 lettere maiuscole, es. BG)
 * - NC = iniziali nome e cognome del segnalatore (2 lettere)
 * - XX = progressivo giornaliero dell'utente (2 cifre)
 *
 * Casi speciali gestiti nella mappa REGIONE_PROTOCOLLO:
 * - Provincia di Trento -> regione TRENTINO
 * - Provincia di Bolzano -> regione ALTO ADIGE
 * - Provincia di Aosta -> regione VALLE D'AOSTA
 *
 * Autore: Fabio Tempera (2026)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

// Mappatura sigla regione -> codice di 3 lettere per il protocollo.
// Accetta varianti con spazio, underscore o trattino (es. "EMILIA ROMAGNA",
// "EMILIA_ROMAGNA", "EMILIA-ROMAGNA") per robustezza rispetto alla
// convenzione usata nel DB.
const REGIONE_PROTOCOLLO: Record<string, string> = {
  LOMBARDIA: "LOM",
  VENETO: "VEN",
  PIEMONTE: "PIE",
  TRENTINO: "TRE",
  "ALTO ADIGE": "AAD",
  "VALLE D'AOSTA": "VDA",
  LIGURIA: "LIG",
  "EMILIA ROMAGNA": "EMI",
  TOSCANA: "TOS",
  UMBRIA: "UMB",
  MARCHE: "MAR",
  LAZIO: "LAZ",
  ABRUZZO: "ABR",
  MOLISE: "MOL",
  CAMPANIA: "CAM",
  PUGLIA: "PUG",
  BASILICATA: "BAS",
  CALABRIA: "CAL",
  SICILIA: "SIC",
  SARDEGNA: "SAR",
  "FRIULI VENEZIA GIULIA": "FVG",
};

export function getRegioneCodice(regione: string): string {
  // Normalizza: prova prima la chiave diretta, poi con underscore/trattino
  // convertiti in spazi, per gestire qualsiasi convenzione salvata nel DB.
  const normalized = regione.trim().toUpperCase();
  if (!normalized) {
    // Regione vuota: logga e ritorna un placeholder esplicito, evitando
    // di produrre un numero di protocollo con doppi trattini.
    logger.error({ regione }, "[protocollo] Regione vuota passata a getRegioneCodice");
    return "XXX";
  }
  if (REGIONE_PROTOCOLLO[normalized]) return REGIONE_PROTOCOLLO[normalized];
  const withSpaces = normalized.replace(/[_-]/g, " ");
  if (REGIONE_PROTOCOLLO[withSpaces]) return REGIONE_PROTOCOLLO[withSpaces];
  // Fallback: prime 3 lettere. Questo caso si verifica quando l'admin
  // inserisce una regione non presente nella mappa REGIONE_PROTOCOLLO
  // (es. refuso, regione nuova non ancora mappata). Il numero di
  // protocollo verrà generato con un codice potenzialmente ambiguo,
  // quindi emettiamo un warning strutturato nel log del server per
  // permettere all'admin di correggere il dato o aggiornare la mappa.
  const fallback = normalized.slice(0, 3).toUpperCase();
  logger.warn(
    { regione, fallback },
    "[protocollo] Regione non mappata in REGIONE_PROTOCOLLO. " +
      "Uso del fallback per il numero di protocollo. " +
      "Verificare il dato nel pannello admin o aggiornare la mappa in src/lib/protocollo.ts."
  );
  return fallback;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
// Esportata per riuso nella simulazione PEC (preview previsionale)
export { pad2 };

/**
 * Calcola le iniziali di un nome cognome (2 lettere maiuscole).
 * Se il nome o il cognome ha più parole, prende la prima lettera della
 * prima parola e della seconda. Gestisce nomi malformati (spazi iniziali,
 * singola parola, stringa vuota) con fallback a "XX".
 *
 * Lo slicing è code-point-safe: usa `[...str]` per iterare per code point
 * Unicode invece che per code unit UTF-16, gestendo correttamente
 * caratteri multibyte (emoji, caratteri outside BMP).
 */
export function getInizialiSegnalatore(
  nomeCognome: string,
  inizialiProtocollo?: string | null
): string {
  if (inizialiProtocollo && inizialiProtocollo.length >= 2) {
    return inizialiProtocollo.slice(0, 2).toUpperCase();
  }
  const parts = nomeCognome.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length >= 2) {
    const a = [...parts[0]][0];
    const b = [...parts[1]][0];
    if (a && b) return (a + b).toUpperCase();
  }
  if (parts.length === 1) {
    const chars = [...parts[0]];
    if (chars.length >= 2) return (chars[0] + chars[1]).toUpperCase();
    if (chars.length === 1) return (chars[0] + "X").toUpperCase();
  }
  // Fallback per input malformati (stringa vuota, singolo carattere,
  // o solo whitespace): ritorna un placeholder fisso.
  return "XX";
}

/**
 * Calcola l'inizio e la fine (esclusiva) della giornata locale per la
 * data passata. Usiamo un bound superiore esclusivo (mezzanotte del
 * giorno successivo) per includere correttamente eventuali record con
 * timestamp sub-secondo tra 23:59:59.000 e 23:59:59.999.
 */
function getGiornataBounds(data: Date): { inizioGiornata: Date; fineGiornataEsclusiva: Date } {
  const yyyy = data.getFullYear();
  const month = data.getMonth();
  const day = data.getDate();
  const inizioGiornata = new Date(yyyy, month, day, 0, 0, 0, 0);
  const fineGiornataEsclusiva = new Date(yyyy, month, day + 1, 0, 0, 0, 0);
  return { inizioGiornata, fineGiornataEsclusiva };
}

/**
 * Calcola un numero di protocollo previsionale (senza persistarlo).
 * Usato da simula-pec per mostrare l'anteprima del protocollo senza
 * assegnarlo definitivamente. Condivide la stessa logica di calcolo
 * di generaNumeroProtocollo per garantire coerenza.
 *
 * Il conteggio è basato sul prefisso del numero di protocollo
 * (data + regione + provincia + iniziali) e NON sul volontarioId:
 * questo garantisce coerenza anche dopo anonimizzazione GDPR, quando
 * il volontarioId viene posto a null ma il numero di protocollo resta.
 */
export async function calcolaProtocolloPrevisionale(params: {
  data: Date;
  regione: string;
  provinciaSigla: string;
  segnalatoreId: string;
  segnalatoreNomeCognome: string;
  inizialiProtocollo?: string | null;
}): Promise<string | null> {
  const {
    data,
    regione,
    provinciaSigla,
    segnalatoreNomeCognome,
    inizialiProtocollo,
  } = params;

  const yyyy = data.getFullYear();
  const mm = pad2(data.getMonth() + 1);
  const gg = pad2(data.getDate());
  const reg = getRegioneCodice(regione);
  const pv = provinciaSigla.toUpperCase();
  const nc = getInizialiSegnalatore(segnalatoreNomeCognome, inizialiProtocollo);

  const { inizioGiornata, fineGiornataEsclusiva } = getGiornataBounds(data);

  // Conta i protocolli già assegnati oggi con lo stesso prefisso.
  // Il filtro su `numeroProtocollo startsWith` trova tutti i record
  // che iniziano con il prefisso calcolato, indipendentemente dal
  // volontarioId (che potrebbe essere null dopo anonimizzazione GDPR).
  const prefisso = `${yyyy}${mm}${gg}-${reg}-${pv}-${nc}`;
  const count = await db.segnalazione.count({
    where: {
      numeroProtocollo: { startsWith: prefisso },
      dataSegnalazione: { gte: inizioGiornata, lt: fineGiornataEsclusiva },
    },
  });
  const xx = pad2(count + 1);
  return `${prefisso}${xx}`;
}

/**
 * Genera il numero di protocollo in modo atomico.
 *
 * Il count delle segnalazioni con protocollo già assegnato nella giornata
 * NON è atomico rispetto a un secondo processo concorrente (PostgreSQL non
 * supporta SELECT FOR UPDATE in modo diretto su count). La protezione
 * contro le race condition si affida al vincolo unique su numeroProtocollo
 * (P2002): se due richieste concorrenti calcolano lo stesso progressivo,
 * la seconda fallisce con P2002 e viene ritentata con progressivo+1,
 * fino a 10 tentativi.
 *
 * Il conteggio è basato sul prefisso del numero di protocollo
 * (YYYYMMGG-REG-PV-NC) e NON sul volontarioId, per garantire coerenza
 * anche dopo anonimizzazione GDPR (quando volontarioId diventa null).
 *
 * Protezione anti-sovrascrittura: la UPDATE usa una clausola WHERE che
 * richiede `numeroProtocollo: null`, così una segnalazione che ha già
 * un protocollo assegnato non viene sovrascritta (updateMany count=0
 * viene interpretato come "protocollo già assegnato").
 */
export async function generaNumeroProtocollo(params: {
  data: Date;
  regione: string;
  provinciaSigla: string;
  segnalatoreId: string;
  segnalatoreNomeCognome: string;
  inizialiProtocollo?: string | null;
  segnalazioneId: string;
}): Promise<string> {
  const {
    data,
    regione,
    provinciaSigla,
    segnalatoreNomeCognome,
    inizialiProtocollo,
    segnalazioneId,
  } = params;

  const yyyy = data.getFullYear();
  const mm = pad2(data.getMonth() + 1);
  const gg = pad2(data.getDate());
  const reg = getRegioneCodice(regione);
  const pv = provinciaSigla.toUpperCase();
  const nc = getInizialiSegnalatore(segnalatoreNomeCognome, inizialiProtocollo);

  const { inizioGiornata, fineGiornataEsclusiva } = getGiornataBounds(data);
  const prefisso = `${yyyy}${mm}${gg}-${reg}-${pv}-${nc}`;

  // Query iniziale: conta i protocolli odierni con questo prefisso.
  // Non viene ripetuta nel loop: usiamo countBase + tentativo come
  // progressivo candidato, evitando di saltare valori intermedi se
  // una richiesta concorrente prende lo stesso progressivo.
  const countBase = await db.segnalazione.count({
    where: {
      numeroProtocollo: { startsWith: prefisso },
      dataSegnalazione: { gte: inizioGiornata, lt: fineGiornataEsclusiva },
    },
  });

  // Tenta fino a 10 volte per gestire collisioni sul unique.
  // Il vincolo unique su numeroProtocollo garantisce che al massimo una
  // richiesta riesce per ogni progressivo: la seconda fallisce con P2002
  // e ritenta col progressivo successivo. Se countBase + tentativo
  // supera 99, estendiamo a 3+ cifre (NCXXX) per gestire volumi
  // giornalieri molto alti per un singolo utente (caso estremo).
  for (let tentativo = 0; tentativo < 10; tentativo++) {
    const progressivo = countBase + 1 + tentativo;
    // pad2 gestisce correttamente solo valori 0-99; per valori maggiori
    // il numero di protocollo cresce a 3+ cifre.
    const xx = progressivo < 100 ? pad2(progressivo) : String(progressivo);
    const candidato = `${prefisso}${xx}`;

    try {
      // Tenta di assegnare il protocollo alla segnalazione.
      // La clausola WHERE numeroProtocollo: null previene la
      // sovrascrittura di un protocollo già assegnato (caso di retry
      // dell'API dopo una partial success, o doppio invio PEC).
      // updateMany ritorna count=0 se il record ha già un protocollo:
      // in quel caso consideriamo l'operazione riuscita e ritorniamo
      // il protocollo esistente (che dobbiamo leggere dal DB).
      const result = await db.segnalazione.updateMany({
        where: { id: segnalazioneId, numeroProtocollo: null },
        data: { numeroProtocollo: candidato },
      });
      if (result.count > 0) {
        return candidato;
      }
      // count=0: la segnalazione ha già un protocollo. Recuperiamolo
      // per ritornarlo al chiamante, evitando di generare un duplicato.
      const existing = await db.segnalazione.findUnique({
        where: { id: segnalazioneId },
        select: { numeroProtocollo: true },
      });
      if (existing?.numeroProtocollo) {
        logger.warn(
          { segnalazioneId, existing: existing.numeroProtocollo, candidato },
          "[protocollo] Segnalazione aveva già un numero di protocollo assegnato, restituito quello esistente"
        );
        return existing.numeroProtocollo;
      }
      // Il record non esiste più (DELETE concorrente?): non possiamo
      // assegnare il protocollo. Esci con errore.
      throw new Error(`Segnalazione ${segnalazioneId} non trovata durante assegnazione protocollo`);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // Collisione: riprova con il prossimo progressivo
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    "Impossibile generare un numero di protocollo univoco dopo 10 tentativi"
  );
}
