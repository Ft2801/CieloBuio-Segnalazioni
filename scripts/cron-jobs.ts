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

const db = new PrismaClient();

async function main() {
  console.log(`[${new Date().toISOString()}] Inizio cron jobs...`);

  // 1. Pulizia sessioni scadute
  const sessioniPulite = await cleanupSessioniScadute(db);
  console.log(`- Sessioni scadute rimosse: ${sessioniPulite}`);

  // 2. Transizione automatica inviata -> in_attesa dopo N giorni
  const transitate = await transizioneAutomaticaInviata(db, null);
  console.log(`- Segnalazioni transitate inviata -> in_attesa: ${transitate}`);

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
  console.log(`- Segnalazioni anonimizzate (retention ${retentionAnni} anni): ${anonimizzate}`);

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
    console.log(`- File orfani rimossi da storage/uploads/: ${orfaniRimossi}`);
  }

  console.log(`[${new Date().toISOString()}] Cron jobs completati.`);
}

main()
  .catch((e) => {
    console.error("Errore cron jobs:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
