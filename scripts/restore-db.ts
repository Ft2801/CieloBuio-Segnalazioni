/**
 * Script di ripristino del database da un backup cifrato.
 *
 * Controparte di scripts/backup-db.ts: decifra i file .enc con
 * AES-256-GCM (stesso formato: 12-byte IV + ciphertext + 16-byte auth tag)
 * e reimporta i record nelle tabelle corrispondenti.
 *
 * ATTENZIONE: lo script esegue deleteMany + create su ogni tabella,
 * sovrascrivendo i dati esistenti. Va usato solo per disaster recovery
 * su un DB vuoto o da sovrascrivere deliberatamente.
 *
 * Uso:
 *   BACKUP_ENCRYPTION_KEY=<chiave_base64> npm run db:restore -- backup-20260712-143045
 *
 * Autore: Fabio Tempera (2026)
 */

import { PrismaClient } from "@prisma/client";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { createDecipheriv } from "crypto";

const db = new PrismaClient();

const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY;
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");

// Validazione difensiva del nome backup: deve seguire il pattern
// `backup-YYYYMMGG-HHMMSS` generato da backup-db.ts. Questo previene
// path traversal (es. `../../etc/passwd`) tramite argv[2] che potrebbe
// leggere/sovrascrivere file arbitrari fuori da BACKUP_DIR.
const BACKUP_NAME_REGEX = /^backup-\d{8}-\d{6}$/;

// Tabelle nello stesso ordine di backup-db.ts per coerenza. L'ordine
// conta per le FK: insertiamo i padri prima dei figli.
const TABELLE_ORDINE = [
  "regioneLegge",
  "provincia",
  "comune",
  "user",
  "sessione",
  "segnalazione",
  "allegato",
  "storicoStato",
  "logInvioPec",
] as const;

function decryptBuffer(data: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY deve essere Base64 di 32 byte (256 bit), ricevuto ${key.length} byte dopo decode`
    );
  }
  // Formato: [12-byte IV][ciphertext][16-byte auth tag]
  if (data.length < 12 + 16) {
    throw new Error("Backup file troppo corto per essere valido (IV + auth tag mancanti)");
  }
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

async function loadBackupFile(backupPath: string, tabella: string): Promise<unknown[]> {
  const encPath = path.join(backupPath, `${tabella}.json.enc`);
  const plainPath = path.join(backupPath, `${tabella}.json`);
  try {
    const encData = await readFile(encPath);
    if (!ENCRYPTION_KEY) {
      throw new Error(
        `Il file ${tabella}.json.enc è cifrato ma BACKUP_ENCRYPTION_KEY non è impostata`
      );
    }
    const decrypted = decryptBuffer(encData, ENCRYPTION_KEY);
    return JSON.parse(decrypted.toString("utf-8"));
  } catch (e) {
    // Se il file cifrato non esiste, prova la versione in chiaro
    // (backup creato senza BACKUP_ENCRYPTION_KEY, modalità dev).
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const plainData = await readFile(plainPath, "utf-8");
        return JSON.parse(plainData);
      } catch {
        // Tabella non presente in questo backup: skip
        return [];
      }
    }
    throw e;
  }
}

async function main() {
  const backupName = process.argv[2];
  if (!backupName) {
    console.error("Uso: npm run db:restore -- <backup-name>");
    console.error("Esempio: npm run db:restore -- backup-20260712-143045");
    process.exit(1);
  }
  // Validazione difensiva del nome backup: previene path traversal.
  // Accettiamo solo nomi nel formato `backup-YYYYMMGG-HHMMSS`.
  if (!BACKUP_NAME_REGEX.test(backupName)) {
    console.error(`Nome backup non valido: ${backupName}`);
    console.error("Il nome deve seguire il formato backup-YYYYMMGG-HHMMSS (es. backup-20260712-143045).");
    console.error("Sono esclusi caratteri speciali, separatori di percorso o sequenze tipo '..'.");
    process.exit(1);
  }
  const backupPath = path.join(BACKUP_DIR, backupName);
  // Doppio check: il path risolto deve restare dentro BACKUP_DIR.
  // Anche se BACKUP_NAME_REGEX dovrebbe già impedire ogni escape,
  // questo check difensivo copre eventuali edge case su path.join
  // con valori malformati di BACKUP_DIR.
  const risolto = path.resolve(backupPath);
  const risoltoDir = path.resolve(BACKUP_DIR);
  if (!risolto.startsWith(risoltoDir + path.sep) && risolto !== risoltoDir) {
    console.error(`Path risultante fuori da BACKUP_DIR: ${risolto}`);
    process.exit(1);
  }
  try {
    await stat(backupPath);
  } catch {
    console.error(`Backup non trovato: ${backupPath}`);
    console.error(`Backups disponibili in ${BACKUP_DIR}:`);
    try {
      const files = await readdir(BACKUP_DIR);
      const backups = files.filter((f) => BACKUP_NAME_REGEX.test(f));
      for (const b of backups) console.error(`  - ${b}`);
    } catch {
      console.error(`  (impossibile leggere ${BACKUP_DIR})`);
    }
    process.exit(1);
  }

  console.log(`Ripristino da ${backupPath}...`);

  // Safety check: chiedi conferma se il DB non è vuoto
  const userCount = await db.user.count();
  if (userCount > 0) {
    console.warn(
      `ATTENZIONE: il DB contiene già ${userCount} utenti. Il ripristino SOVRASCRIVERÀ i dati esistenti.`
    );
    console.warn("Per confermare, includi --force come terzo argomento.");
    if (process.argv[3] !== "--force") {
      console.error("Operazione annullata. Usa: npm run db:restore -- <backup> --force");
      process.exit(1);
    }
  }

  // Ripristina le tabelle nell'ordine corretto (padri prima dei figli).
  // Per ogni tabella: deleteMany (svuota) + createMany (inserisci).
  // Usiamo una transazione per tabella per coerenza, non una sola grande
  // transazione: se una tabella fallisce, le precedenti restano ripristinate
  // (decisione di trade-off: meglio un ripristino parziale che rollback totale).
  // Ogni coppia deleteMany + createMany è racchiusa in una $transaction
  // interattiva per garantire che la tabella non resti vuota se la createMany
  // fallisce (in quel caso l'intera operazione viene annullata).
  for (const tabella of TABELLE_ORDINE) {
    const records = await loadBackupFile(backupPath, tabella);
    if (records.length === 0) {
      console.log(`- ${tabella}: 0 record (skip)`);
      continue;
    }
    console.log(`- ${tabella}: ${records.length} record...`);
    try {
      await db.$transaction(async (tx) => {
        // @ts-expect-error: accesso dinamico per nome tabella non è tipizzato
        // ma è garantito runtime dall'enum TABELLE_ORDINE.
        await tx[tabella].deleteMany({});
        // @ts-expect-error: idem
        await tx[tabella].createMany({ data: records, skipDuplicates: true });
      });
    } catch (e) {
      console.error(`  ERRORE su ${tabella}:`, e);
      // Continua con la prossima tabella invece di abortire tutto
    }
  }

  console.log(`\nRipristino completato da ${backupPath}`);
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error("Errore ripristino:", e);
    await db.$disconnect();
    process.exit(1);
  }
  await db.$disconnect();
}

run();
