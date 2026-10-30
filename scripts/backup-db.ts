/**
 * Backup cifrato del database e degli allegati fisici.
 *
 * Esporta le tabelle e copia storage/uploads/ in backups/backup-YYYYMMDD-HHMMSS.
 * Ogni file è cifrato con AES-256-GCM. La variabile BACKUP_ENCRYPTION_KEY è
 * obbligatoria: senza chiave lo script termina senza creare alcun file.
 *
 * Variabili d'ambiente:
 *   BACKUP_ENCRYPTION_KEY  chiave Base64 di 32 byte (obbligatoria)
 *   BACKUP_DIR             directory di destinazione (default: ./backups)
 *
 * Retention: i backup più vecchi di 30 giorni vengono rimossi a ogni esecuzione.
 *
 * Eseguire in una finestra di manutenzione senza scritture concorrenti su
 * database e storage: l'esportazione delle tabelle e dei file non è atomica.
 *
 * Autore: Fabio Tempera (2026)
 */

import "./load-env";
import path from "path";
import { createPrismaClient } from "../src/lib/prisma-client";
import { ErroreBackup, eseguiBackup, leggiChiave, type DelegatiLettura } from "../src/lib/backup";
import { UPLOADS_ROOT } from "../src/lib/path-guard";

const db = createPrismaClient();

async function eseguiCli(): Promise<number> {
  try {
    const chiave = leggiChiave(process.env.BACKUP_ENCRYPTION_KEY);
    const root = process.cwd();
    const esito = await eseguiBackup({
      delegati: db as unknown as DelegatiLettura,
      backupDir: path.resolve(process.env.BACKUP_DIR ?? path.join(root, "backups")),
      uploadsDir: UPLOADS_ROOT,
      chiave,
      ora: new Date(),
      log: (messaggio) => console.log(messaggio),
    });
    console.log(`Backup salvato in ${esito.backupPath}`);
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
