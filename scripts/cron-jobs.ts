/**
 * Script di maintenance periodico da eseguire via cron (es. giornalmente).
 *
 * Effettua:
 * - I1: transizione automatica delle pratiche "inviata" più vecchie di
 *   TRANSIZIONE_INVIATA_GIORNI (default 7) allo stato "in_attesa"
 * - I7: pulizia delle sessioni scadute dal DB
 * - GDPR: anonimizzazione delle segnalazioni più vecchie di
 *   RETENTION_SEGNALAZIONI_ANNI (default 10) come da PRIVACY.md.
 *   L'anonimizzazione (non la cancellazione) preserva il valore
 *   statistico/audit della segnalazione rimuovendo i dati personali
 *   del volontario e dell'indirizzo, in conformità all'art. 5.1.e
 *   del GDPR ("limitazione della conservazione").
 *
 * La logica è centralizzata in `src/lib/cron-utils.ts` e condivisa con
 * `POST /api/reminder` (esecuzione manuale admin) per evitare drift.
 *
 * Concurrency safety: acquisiamo un PostgreSQL advisory lock all'inizio
 * per prevenire esecuzioni concorrenti (cron che si sovrappone a trigger
 * manuale admin, o cron che riparte prima che la precedente finisca).
 * Se il lock è già preso, lo script esce silenziosamente con codice 0.
 *
 * Esempio cron (ogni giorno alle 3:00):
 *   0 3 * * * cd /path/to/project && npm run cron:reminder >> logs/cron.log 2>&1
 *
 * Autore: Fabio Tempera (2026)
 */

import { PrismaClient } from "@prisma/client";
import {
  cleanupSessioniScadute,
  transizioneAutomaticaInviata,
  anonimizzaSegnalazioniGdpr,
  cleanupFileOrfani,
  getRetentionAnni,
} from "../src/lib/cron-utils";
import { logger } from "../src/lib/logger";

// Chiave numerica per il PostgreSQL advisory lock. Deve essere stabile
// tra release (non cambiarla senza considerare le esecuzioni concorrenti
// in corso durante il deploy). 0x4349424F = "CIBO" in ASCII (mnemonico
// per CieloBuio).
const CRON_ADVISORY_LOCK_KEY = 0x4349424f;

const db = new PrismaClient();

/**
 * Tenta di acquisire un advisory lock PostgreSQL. Ritorna true se
 * acquisito, false se già preso da un'altra sessione. Usa
 * pg_try_advisory_lock (non blocking) per evitare di attendere.
 */
async function tryAcquireLock(): Promise<boolean> {
  const result = await db.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_lock(${CRON_ADVISORY_LOCK_KEY}::bigint) AS acquired
  `;
  return result[0]?.acquired === true;
}

async function releaseLock(): Promise<void> {
  try {
    await db.$executeRaw`SELECT pg_advisory_unlock(${CRON_ADVISORY_LOCK_KEY}::bigint)`;
  } catch (e) {
    logger.warn({ err: e }, "[cron-jobs] Rilascio advisory lock fallito (sessione chiusa?)");
  }
}

/**
 * Funzione principale esportata per riuso nei test. Esegue la sequenza
 * di maintenance senza side-effects di processo (exit, disconnect):
 * quei side-effects sono gestiti dal wrapper main() sotto.
 */
export async function runCronJobs(): Promise<void> {
  logger.info({ timestamp: new Date().toISOString() }, "Inizio cron jobs...");

  // 1. Pulizia sessioni scadute
  const sessioniPulite = await cleanupSessioniScadute(db);
  logger.info({ count: sessioniPulite }, "Sessioni scadute rimosse");

  // 2. Transizione automatica inviata -> in_attesa dopo N giorni
  const transitate = await transizioneAutomaticaInviata(db, null);
  logger.info({ count: transitate }, "Segnalazioni transitate inviata -> in_attesa");

  // 3. Anonimizzazione GDPR: segnalazioni più vecchie di RETENTION_SEGNALAZIONI_ANNI.
  // L'anonimizzazione rimuove i dati personali del volontario (lat/long,
  // indirizzo, nomeEsercizio, descrizioneLibera, note) mantenendo il record
  // per audit/statistica. Il volontarioId viene posto a null (erasing del
  // legame con l'utente), i campi liberi vengono sovrascritti con un
  // placeholder "[ANONIMIZZATA]" e le coordinate GPS azzerate.
  // Gli allegati fisici (immagini potenzialmente identificative) vengono
  // eliminati da storage/uploads/<id>/ (vedi src/lib/gdpr.ts).
  //
  // La retention è calcolata su `dataChiusura` (campo dedicato, registrato
  // alla chiusura della pratica) e NON su `updatedAt` (che si aggiorna ad
  // ogni modifica), per riflettere fedelmente il "10 anni dalla chiusura"
  // dichiarato in PRIVACY.md.
  const retentionAnni = getRetentionAnni();
  const anonimizzate = await anonimizzaSegnalazioniGdpr(db, null);
  logger.info({ count: anonimizzate, retentionAnni }, "Segnalazioni anonimizzate per GDPR retention");

  // 4. Pulizia file orfani in /storage/uploads
  // I file fisici degli allegati vengono cancellati durante l'anonimizzazione
  // GDPR (vedi src/lib/gdpr.ts) e durante la DELETE di una segnalazione
  // (vedi src/app/api/segnalazioni/[id]/route.ts). Tuttavia, se uno di
  // quei `rm()` asincroni fallisce (es. permessi, crash del processo),
  // i file restano orfani sul filesystem senza un record DB corrispondente.
  // Questo step confronta le directory su filesystem con i record in
  // tabella allegati e rimuove gli orfani.
  const orfaniRimossi = await cleanupFileOrfani(db);
  if (orfaniRimossi > 0) {
    logger.info({ count: orfaniRimossi }, "File orfani rimossi da storage/uploads/");
  }

  logger.info({ timestamp: new Date().toISOString() }, "Cron jobs completati.");
}

async function main(): Promise<void> {
  // Acquisisci advisory lock per prevenire esecuzioni concorrenti.
  // pg_try_advisory_lock ritorna immediatamente false se il lock è già
  // preso: in quel caso usciamo senza errori (la precedente esecuzione
  // sta ancora girando).
  const lockAcquired = await tryAcquireLock();
  if (!lockAcquired) {
    logger.info("[cron-jobs] Un'altra esecuzione è già in corso (advisory lock occupato). Uscita.");
    return;
  }
  try {
    await runCronJobs();
  } finally {
    await releaseLock();
  }
}

async function run() {
  try {
    await main();
  } catch (e) {
    logger.error({ err: e }, "Errore cron jobs");
    await db.$disconnect();
    process.exit(1);
  }
  await db.$disconnect();
}

run();
