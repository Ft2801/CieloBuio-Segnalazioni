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
 * Casi speciali già gestiti nel sistema Excel:
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
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  // Fallback per input malformati (stringa vuota, singolo carattere,
  // o solo whitespace): ritorna un placeholder fisso.
  return "XX";
}

/**
 * Calcola un numero di protocollo previsionale (senza persistarlo).
 * Usato da simula-pec per mostrare l'anteprima del protocollo senza
 * assegnarlo definitivamente. Condivide la stessa logica di calcolo
 * di generaNumeroProtocollo per garantire coerenza.
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
    segnalatoreId,
    segnalatoreNomeCognome,
    inizialiProtocollo,
  } = params;

  const yyyy = data.getFullYear();
  const mm = pad2(data.getMonth() + 1);
  const gg = pad2(data.getDate());
  const reg = getRegioneCodice(regione);
  const pv = provinciaSigla.toUpperCase();
  const nc = getInizialiSegnalatore(segnalatoreNomeCognome, inizialiProtocollo);

  const inizioGiornata = new Date(yyyy, data.getMonth(), data.getDate(), 0, 0, 0);
  const fineGiornata = new Date(yyyy, data.getMonth(), data.getDate(), 23, 59, 59);

  const count = await db.segnalazione.count({
    where: {
      volontarioId: segnalatoreId,
      dataSegnalazione: { gte: inizioGiornata, lte: fineGiornata },
      NOT: { numeroProtocollo: null },
    },
  });
  const xx = pad2(count + 1);
  return `${yyyy}${mm}${gg}-${reg}-${pv}-${nc}${xx}`;
}

/**
 * Genera il numero di protocollo in modo atomico.
 *
 * Il count delle segnalazioni con protocollo già assegnato nella giornata
 * NON è atomico rispetto a un secondo processo concorrente (PostgreSQL non
 * supporta SELECT FOR UPDATE). La protezione contro le race condition si
 * affida al vincolo unique su numeroProtocollo (P2002): se due richieste
 * concorrenti calcolano lo stesso progressivo, la seconda fallisce con
 * P2002 e viene ritentata con progressivo+1, fino a 10 tentativi.
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
    segnalatoreId,
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

  const inizioGiornata = new Date(yyyy, data.getMonth(), data.getDate(), 0, 0, 0);
  const fineGiornata = new Date(yyyy, data.getMonth(), data.getDate(), 23, 59, 59);

  // Tenta fino a 10 volte per gestire collisioni sul unique.
  // Il count NON è atomico (vedi commento JSDoc sopra), ma il vincolo
  // unique su numeroProtocollo garantisce che al massimo una richiesta
  // riesce per ogni progressivo: la seconda fallisce con P2002 e ritenta.
  // Se count + 1 + tentativo supera 99, estendiamo a 3+ cifre (NCXXX)
  // per gestire volumi giornalieri molto alti per un singolo utente (caso estremo).
  for (let tentativo = 0; tentativo < 10; tentativo++) {
    const count = await db.segnalazione.count({
      where: {
        volontarioId: segnalatoreId,
        dataSegnalazione: { gte: inizioGiornata, lte: fineGiornata },
        NOT: { numeroProtocollo: null },
      },
    });
    const progressivo = count + 1 + tentativo;
    // pad2 gestisce correttamente solo valori 0-99; per valori maggiori
    // il numero di protocollo cresce a 3+ cifre.
    const xx = progressivo < 100 ? pad2(progressivo) : String(progressivo);
    const candidato = `${yyyy}${mm}${gg}-${reg}-${pv}-${nc}${xx}`;

    try {
      // Tenta di assegnare il protocollo alla segnalazione.
      // Se unique fallisce (P2002), una richiesta concorrente ha preso lo
      // stesso numero: riprova col progressivo successivo.
      await db.segnalazione.update({
        where: { id: segnalazioneId },
        data: { numeroProtocollo: candidato },
      });
      return candidato;
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
