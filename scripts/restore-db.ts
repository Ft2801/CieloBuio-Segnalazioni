/**
 * Ripristino del database da un backup cifrato (disaster recovery).
 *
 * Controparte di scripts/backup-db.ts. Lo script svuota e ripopola tutte le
 * tabelle in un'unica transazione, sovrascrivendo i dati esistenti. Se un file
 * manca o è corrotto, oppure la chiave è errata, l'operazione viene annullata
 * senza modifiche al database. Le sessioni attive vengono invalidate.
 *
 * Uso:
 *   BACKUP_ENCRYPTION_KEY=<chiave_base64> npm run db:restore -- backup-20260712-143045 [--force]
 *
 * Fermare l'applicazione durante il ripristino. --force è richiesto se il
 * database contiene già dati in una qualsiasi tabella applicativa.
 *
 * Autore: Fabio Tempera (2026)
 */

import "./load-env";
import path from "path";
import { createPrismaClient } from "../src/lib/prisma-client";
import {
  ErroreBackup,
  eseguiRipristino,
  leggiChiave,
  validaNomeBackup,
  type ClientRipristino,
} from "../src/lib/backup";
import { UPLOADS_ROOT } from "../src/lib/path-guard";

const db = createPrismaClient();

async function eseguiCli(): Promise<number> {
  try {
    const nome = validaNomeBackup(process.argv[2]);
    const chiave = leggiChiave(process.env.BACKUP_ENCRYPTION_KEY);
    const backupDir = path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"));
    const backupPath = path.join(backupDir, nome);
    console.log(`Ripristino da ${backupPath}...`);
    const conteggi = await eseguiRipristino({
      db: db as unknown as ClientRipristino,
      backupPath,
      uploadsDir: UPLOADS_ROOT,
      chiave,
      force: process.argv[3] === "--force",
      log: (messaggio) => console.log(messaggio),
    });
    const totale = Object.values(conteggi).reduce((somma, n) => somma + n, 0);
    console.log(`Ripristino completato: ${totale} record in ${Object.keys(conteggi).length} tabelle.`);
    return 0;
  } catch (e) {
    console.error(e instanceof ErroreBackup ? `Errore: ${e.message}` : e);
    return 1;
  } finally {
    await db.$disconnect();
  }
}

eseguiCli().then((codice) => {
  process.exitCode = codice;
});
