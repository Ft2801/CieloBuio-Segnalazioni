/**
 * Script di backup del database con cifratura at-rest.
 *
 * Esporta tutte le tabelle in formato JSON in una directory di backup
 * con retention a 30 giorni. I backup vengono cifrati con AES-256-GCM
 * se la variabile d'ambiente BACKUP_ENCRYPTION_KEY è impostata.
 *
 * Sicurezza:
 * - passwordHash è escluso dal backup (resta solo nel DB attivo)
 * - token di sessione è troncato a 8 caratteri con suffisso ...REDACTED
 * - Se BACKUP_ENCRYPTION_KEY è impostata, ogni file JSON viene cifrato
 *   con AES-256-GCM e salvato con estensione .enc
 * - La chiave deve essere una stringa Base64 di 32 byte (256 bit)
 * - Anche gli allegati fisici in storage/uploads/ vengono copiati nel
 *   backup e cifrati sezione per sezione con AES-256-GCM (ciascun file
 *   diventa un file .enc separato), per garantire cifratura at-rest
 *   completa (non solo dei metadati DB).
 *
 * Esempio cron (ogni giorno alle 2:00):
 *   0 2 * * * cd /path/to/project && npm run db:backup >> logs/backup.log 2>&1
 *
 * Autore: Fabio Tempera (2026)
 */

import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile, readFile, readdir, rm, stat, lstat, realpath } from "fs/promises";
import path from "path";
import { createCipheriv, randomBytes } from "crypto";

const db = new PrismaClient();
// BACKUP_DIR risolta in modo assoluto rispetto alla cwd del progetto per
// coerenza con scripts/restore-db.ts: in caso di esecuzione da directory
// diverse (es. cron vs CLI), entrambi gli script usano lo stesso percorso.
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"));
const RETENTION_DAYS = 30;
const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY ?? null;

/**
 * Cifra un buffer con AES-256-GCM.
 * Ritorna un buffer nel formato: [12 byte IV][ciphertext][16 byte auth tag].
 */
function encryptBuffer(data: Buffer, keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY deve essere una stringa Base64 di 32 byte (256 bit)");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]);
}

/**
 * Salva un file, cifrandolo se la chiave di cifratura è configurata.
 */
async function saveFile(filePath: string, data: string, encrypt: boolean): Promise<void> {
  if (encrypt && ENCRYPTION_KEY) {
    const encrypted = encryptBuffer(Buffer.from(data, "utf-8"), ENCRYPTION_KEY);
    await writeFile(filePath + ".enc", encrypted);
  } else {
    await writeFile(filePath, data);
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Inizio backup database...`);
  if (ENCRYPTION_KEY) {
    console.log("[SECURITY] Cifratura at-rest abilitata (AES-256-GCM)");
  } else {
    console.log("[WARNING] Cifratura at-rest NON abilitata: impostare BACKUP_ENCRYPTION_KEY");
  }

  await mkdir(BACKUP_DIR, { recursive: true });

  // Formato del timestamp nel nome directory: YYYYMMDD-HHMMSS
  // (es. backup-20260712-143045). È sia leggibile dall'umano sia
  // facilmente parseable dalla pulizia retention sottostante.
  // Importante: NON usare new Date().toISOString() con `:` e `.`
  // sostituiti da `-` (es. 2026-07-12T14-30-45-123Z) perché
  // `new Date("2026-07-12T14-30-45-123Z")` restituisce Invalid Date
  // in Node.js (i separatori `-` non sono validi nel formato ISO 8601).
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);

  await mkdir(backupPath, { recursive: true });

  // Esporta ogni tabella in un file JSON separato.
  // Sicurezza: `user.passwordHash` (bcrypt) e `sessione.token` (sessioni
  // attive in chiaro) sono dati sensibili che non devono finire nei backup
  // su disco non cifrati. Un attaccante con accesso ai file di backup
  // potrebbe dirottare sessioni attive (token valido fino a 8 ore) o
  // tentare offline il crack degli hash bcrypt. Pertanto:
  // - `passwordHash` è escluso del tutto dal backup (resta nel DB attivo)
  // - `token` è troncato a 8 caratteri con suffisso `...REDACTED`
  //   (sufficiente per audit trail, non per riutilizzo)
  const tabelle = [
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

  for (const tabella of tabelle) {
    // @ts-expect-error - tabella dinamica
    const records = await db[tabella].findMany();
    let recordsSanitizzati = records;

    if (tabella === "user") {
      // Rimuovi passwordHash, totpSecret e totpVerifiedAt dai backup:
      // passwordHash permette il crack offline delle password,
      // totpSecret permette di generare codici 2FA validi,
      // totpVerifiedAt rivela lo stato di configurazione 2FA.
      // Tutti questi dati devono restare solo nel DB attivo, mai nei dump.
      recordsSanitizzati = records.map((r: Record<string, unknown>) => {
        const { passwordHash: _ph, totpSecret: _ts, totpVerifiedAt: _tva, ...rest } = r;
        return rest;
      });
    } else if (tabella === "sessione") {
      // Tronca il token: tieni solo i primi 8 caratteri per audit trail
      // (sufficiente a identificare la sessione nei log, non a riutilizzarla)
      recordsSanitizzati = records.map((r: Record<string, unknown>) => ({
        ...r,
        token: typeof r.token === "string" ? `${r.token.slice(0, 8)}...REDACTED` : r.token,
      }));
    }

    const filePath = path.join(backupPath, `${tabella}.json`);
    await saveFile(filePath, JSON.stringify(recordsSanitizzati, null, 2), true);
    console.log(`- ${tabella}: ${recordsSanitizzati.length} record esportati${ENCRYPTION_KEY ? " (cifrato)" : ""}`);
  }

  // Salva anche un metadata con la data del backup
  await saveFile(
    path.join(backupPath, "_metadata.json"),
    JSON.stringify(
      {
        timestamp,
        version: "1.0.0",
        tabelle: tabelle,
        encrypted: !!ENCRYPTION_KEY,
      },
      null,
      2
    ),
    true
  );

  console.log(`Backup database salvato in: ${backupPath}`);

  // Copia anche i file fisici degli allegati da storage/uploads/
  // al backup, per un ripristino completo in caso di disastro.
  // Se ENCRYPTION_KEY è impostata, ogni file viene cifrato singolarmente
  // con AES-256-GCM (file .enc), garantendo cifratura at-rest completa
  // anche per gli allegati binari (foto, PDF) e non solo per i metadati
  // JSON del DB. La struttura directory è preservata.
  const storageUploadsPath = path.join(process.cwd(), "storage", "uploads");
  const backupUploadsPath = path.join(backupPath, "uploads");

  /**
   * Copia ricorsivamente cifrando ogni file se ENCRYPTION_KEY è impostata.
   * Se ENCRYPTION_KEY non è impostata, copia in chiaro (modalità dev/test).
   *
   * Security:
   *  - Usa lstat invece di stat per NON seguire i symlink: un symlink
   *    malevolo in storage/uploads/ potrebbe altrimenti puntare a file
   *    fuori dalla directory (es. /etc/passwd) e finire nel backup.
   *  - Verifica che il realpath del file sia dentro storage/uploads/
   *    come defense-in-depth.
   *  - Salta file più grandi di 500 MB per evitare OOM del processo
   *    di backup (logga un warning per il file saltato).
   */
  async function copyAndMaybeEncrypt(src: string, dst: string): Promise<number> {
    let count = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(src);
    } catch {
      return 0;
    }
    await mkdir(dst, { recursive: true });
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const dstPath = path.join(dst, entry);
      // lstat NON segue i symlink: se entry è un symlink, lstat ritorna
      // le info del link stesso, non del target. Questo previene path
      // traversal via symlink malevoli nel storage.
      // Tipo esplicito: senza annotation, `let s;` è implicitamente `any`,
      // disabilitando il type checking sugli accessi successivi (.isSymbolicLink,
      // .isDirectory, .size, ...). Dichiariamo il tipo corretto Stats.
      let s: import("fs").Stats;
      try {
        s = await lstat(srcPath);
      } catch {
        continue;
      }
      if (s.isSymbolicLink()) {
        // Salta i symlink: non dovrebbero essercene in storage/uploads/,
        // la loro presenza è sospetta. Logga e continua.
        console.warn(`[SECURITY] Symlink saltato durante backup: ${srcPath}`);
        continue;
      }
      if (s.isDirectory()) {
        count += await copyAndMaybeEncrypt(srcPath, dstPath);
      } else if (s.isFile()) {
        // Verifica dimensione: file troppo grandi sono sospetti o
        // causerebbero OOM nel processo di backup.
        if (s.size > MAX_FILE_SIZE) {
          console.warn(`[BACKUP] File troppo grande saltato (${(s.size / 1024 / 1024).toFixed(2)} MB): ${srcPath}`);
          continue;
        }
        // Defense-in-depth: verifica che il realpath del file sia
        // dentro src. Anche se abbiamo saltato i symlink, questo check
        // protegge in caso di hardlink o altri edge case FS.
        // Wrap in try/catch: realpath può reject se il file viene eliminato
        // concorrentemente tra lstat e realpath (TOCTOU). In tal caso skip
        // il file invece di abortire l'intero backup.
        let realPath: string;
        let srcResolved: string;
        try {
          realPath = await realpath(srcPath);
          srcResolved = await realpath(src);
        } catch (e) {
          console.warn(`[BACKUP] realpath fallito (file rimosso concorrentemente?), skip: ${srcPath}`);
          continue;
        }
        if (!realPath.startsWith(srcResolved + path.sep) && realPath !== srcResolved) {
          console.warn(`[SECURITY] File fuori dal path di storage saltato: ${srcPath} -> ${realPath}`);
          continue;
        }
        const data = await readFile(srcPath);
        if (ENCRYPTION_KEY) {
          const encrypted = encryptBuffer(data, ENCRYPTION_KEY);
          await writeFile(dstPath + ".enc", encrypted);
        } else {
          await writeFile(dstPath, data);
        }
        count++;
      }
    }
    return count;
  }

  const fileCount = await copyAndMaybeEncrypt(storageUploadsPath, backupUploadsPath);
  if (fileCount > 0) {
    console.log(`- Allegati fisici: ${fileCount} file copiati in uploads/${ENCRYPTION_KEY ? " (cifrati AES-256-GCM)" : " (in chiaro - impostare BACKUP_ENCRYPTION_KEY)"}`);
  } else {
    console.log("- Allegati fisici: directory storage/uploads/ non trovata o vuota (ok per setup fresco)");
  }

  // Pulizia backup vecchi (retention).
  // Usa rm({ recursive: true, force: true }) che gestisce le directory:
  // i backup sono directory (una per esecuzione), non file singoli.
  //
  // Estrazione del timestamp dal nome directory: il formato è
  // `backup-YYYYMMDD-HHMMSS` (es. `backup-20260712-143045`). Parseiamo
  // i componenti manualmente perché `new Date("20260712-143045")` non
  // è un formato ISO 8601 valido. Questo è più affidabile di `mtime`
  // (che può non aggiornarsi su filesystem NFS/SMB).
  const files = await readdir(BACKUP_DIR);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let rimossi = 0;
  for (const f of files) {
    if (!f.startsWith("backup-")) continue;
    const fullPath = path.join(BACKUP_DIR, f);
    const s = await stat(fullPath);
    // Estrai il timestamp dal nome directory (formato YYYYMMDD-HHMMSS)
    // e parsa in modo robusto. Regex con gruppi nominati per chiarezza.
    const m = f.match(/^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    let dirTime: number | null = null;
    if (m) {
      const [, yyyy, mm, dd, hh, mi, ss] = m;
      // UTC per coerenza con la generazione del timestamp (vedi sopra)
      const d = new Date(Date.UTC(
        Number(yyyy), Number(mm) - 1, Number(dd),
        Number(hh), Number(mi), Number(ss)
      ));
      if (!isNaN(d.getTime())) dirTime = d.getTime();
    }
    if (dirTime !== null && dirTime < cutoff) {
      await rm(fullPath, { recursive: true, force: true });
      rimossi++;
    } else if (dirTime === null && s.mtimeMs < cutoff) {
      // Fallback su mtime solo se il parsing del nome fallisce
      // (es. backup creati con vecchio formato timestamp).
      await rm(fullPath, { recursive: true, force: true });
      rimossi++;
    }
  }
  if (rimossi > 0) {
    console.log(`Pulizia retention: ${rimossi} backup vecchi rimossi`);
  }

  console.log(`[${new Date().toISOString()}] Backup completato.`);
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error("Errore backup:", e);
    await db.$disconnect();
    process.exit(1);
  }
  await db.$disconnect();
}

run();
