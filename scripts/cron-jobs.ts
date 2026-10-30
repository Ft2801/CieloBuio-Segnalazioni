/**
 * Script di maintenance periodico da eseguire via cron (es. giornalmente).
 *
 * Effettua:
 * - transizione automatica delle pratiche "inviata" più vecchie di
 *   TRANSIZIONE_INVIATA_GIORNI (default 7) allo stato "in_attesa";
 * - pulizia delle sessioni scadute dal database;
 * - anonimizzazione GDPR delle segnalazioni più vecchie di
 *   RETENTION_SEGNALAZIONI_ANNI (default 10), come da PRIVACY.md.
 *   L'anonimizzazione (non la cancellazione) preserva il valore
 *   statistico e l'audit della segnalazione rimuovendo i dati personali
 *   del volontario e dell'indirizzo, in conformità all'art. 5.1.e del GDPR
 *   ("limitazione della conservazione").
 *
 * La logica è centralizzata in `src/lib/cron-utils.ts` e condivisa con
 * `POST /api/reminder` (esecuzione manuale admin) per evitare drift.
 *
 * Concorrenza: una transazione acquisisce un PostgreSQL advisory lock
 * transazionale (pg_try_advisory_xact_lock) e la sequenza di maintenance viene
 * eseguita mentre la transazione è aperta. Il lock è legato alla transazione,
 * quindi viene rilasciato automaticamente al commit o al rollback, anche in
 * caso di crash. Se il lock è già preso, lo script esce con codice 0 senza
 * eseguire nulla.
 *
 * Esempio cron (ogni giorno alle 3:00, con TZ=Europe/Rome):
 *   0 3 * * * cd /path/to/project && npm run cron:reminder >> logs/cron.log 2>&1
 *
 * Autore: Fabio Tempera (2026)
 */

import { db } from "../src/lib/db";
import {
  cleanupSessioniScadute,
  transizioneAutomaticaInviata,
  anonimizzaSegnalazioniGdpr,
  cleanupFileOrfani,
  getRetentionAnni,
} from "../src/lib/cron-utils";
import { logger } from "../src/lib/logger";

// Chiave numerica per il PostgreSQL advisory lock. Deve restare stabile tra
// release: cambiarla durante un deploy non impedirebbe le esecuzioni
// concorrenti. 0x4349424F = "CIBO" in ASCII (mnemonico per CieloBuio).
const CRON_ADVISORY_LOCK_KEY = 0x4349424f;

// Durata massima della transazione che tiene il lock. Le transazioni
// interattive di Prisma hanno un timeout di 5 secondi di default, troppo
// breve per l'intera maintenance.
const TIMEOUT_LOCK_MS = 60 * 60 * 1000;

/**
 * Esegue la maintenance solo se il lock è libero. Ritorna false se un'altra
 * esecuzione tiene già il lock. Il lock di transazione viene rilasciato al
 * termine della transazione.
 */
async function eseguiConLock(): Promise<boolean> {
  return db.$transaction(
    async (tx) => {
      const righe = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${CRON_ADVISORY_LOCK_KEY}::bigint) AS acquired
      `;
      if (righe[0]?.acquired !== true) {
        return false;
      }
      await runCronJobs();
      return true;
    },
    { timeout: TIMEOUT_LOCK_MS, maxWait: 10_000 },
  );
}

/**
 * Funzione principale esportata per riuso nei test. Esegue la sequenza
 * di maintenance senza side-effects di processo (exit, disconnect):
 * quei side-effects sono gestiti dal wrapper run().
 */
async function runCronJobs(): Promise<void> {
  logger.info({ timestamp: new Date().toISOString() }, "Inizio cron jobs...");

  // 1. Pulizia sessioni scadute
  const sessioniPulite = await cleanupSessioniScadute(db);
  logger.info({ count: sessioniPulite }, "Sessioni scadute rimosse");

  // 2. Transizione automatica inviata -> in_attesa dopo N giorni
  const transitate = await transizioneAutomaticaInviata(db, null);
  logger.info({ count: transitate }, "Segnalazioni transitate inviata -> in_attesa");

  // 3. Anonimizzazione GDPR: segnalazioni più vecchie di RETENTION_SEGNALAZIONI_ANNI.
  // L'anonimizzazione rimuove i dati personali (coordinate, indirizzo, CAP,
  // nome dell'esercizio, testi liberi e note) e scollega il volontario,
  // mantenendo il record per audit e statistica. Gli allegati fisici
  // (immagini potenzialmente identificative) vengono eliminati da
  // storage/uploads/<id>/ (vedi src/lib/gdpr.ts).
  //
  // La retention è calcolata su `dataChiusura` (campo dedicato, registrato
  // alla chiusura della pratica) e NON su `updatedAt` (che si aggiorna ad
  // ogni modifica), per riflettere fedelmente il "10 anni dalla chiusura"
  // dichiarato in PRIVACY.md.
  const retentionAnni = getRetentionAnni();
  const anonimizzate = await anonimizzaSegnalazioniGdpr(db, null);
  logger.info({ count: anonimizzate, retentionAnni }, "Segnalazioni anonimizzate per GDPR retention");

  // 4. Pulizia file orfani in storage/uploads.
  // I file fisici vengono rimossi durante l'anonimizzazione GDPR (vedi
  // src/lib/gdpr.ts) e durante la DELETE di una segnalazione (vedi
  // src/app/api/segnalazioni/[id]/route.ts). Se una di queste rimozioni
  // fallisce (permessi, crash del processo), i file restano sul filesystem
  // senza un record DB corrispondente. Questo step confronta le directory
  // con i record della tabella allegati e rimuove gli orfani.
  const orfaniRimossi = await cleanupFileOrfani(db);
  if (orfaniRimossi > 0) {
    logger.info({ count: orfaniRimossi }, "File orfani rimossi da storage/uploads/");
  }

  logger.info({ timestamp: new Date().toISOString() }, "Cron jobs completati.");
}

async function main(): Promise<void> {
  const eseguito = await eseguiConLock();
  if (!eseguito) {
    logger.info("[cron-jobs] Un'altra esecuzione è già in corso (advisory lock occupato). Uscita.");
  }
}

/**
 * Punto d'ingresso dello script: esegue la maintenance e gestisce uscita e
 * chiusura della connessione. Esportata per i test.
 */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (e) {
    logger.error({ err: e }, "Errore cron jobs");
    await db.$disconnect();
    process.exit(1);
  }
  await db.$disconnect();
}
