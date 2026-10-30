/**
 * Backup e ripristino cifrati del database e degli allegati.
 *
 * Formato:
 * - ogni tabella è esportata in `<tabella>.json.enc`
 * - ogni allegato fisico è copiato in `uploads/<percorso>.enc`
 * - ogni file è cifrato con AES-256-GCM: [12 byte IV][ciphertext][16 byte auth tag]
 * - la chiave `BACKUP_ENCRYPTION_KEY` è obbligatoria (Base64 di 32 byte):
 *   senza chiave non si crea né si ripristina alcun backup
 *
 * Il backup contiene tutti i dati necessari al ripristino, comprese le
 * credenziali degli utenti (passwordHash, segreti TOTP). Le sessioni attive
 * non vengono esportate: sono effimere e il ripristino le invalida.
 */

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile, lstat } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { parseUrlStorageSicuro, isSafePathSegment } from "./path-guard";

const RETENTION_GIORNI = 30;
export const MAX_ALLEGATO_BACKUP_BYTE = 500 * 1024 * 1024;
const TIMEOUT_RIPRISTINO_MS = 10 * 60 * 1000;
const BACKUP_NAME_REGEX = /^backup-\d{8}-\d{6}$/;

/** Tabelle esportate, nell'ordine in cui vanno reinserite (padri prima dei figli). */
export const TABELLE_BACKUP = [
  "regioneLegge",
  "provincia",
  "comune",
  "user",
  "segnalazione",
  "allegato",
  "storicoStato",
  "logInvioPec",
  "auditLog",
] as const;

export type NomeTabella = (typeof TABELLE_BACKUP)[number];

/** Operazioni di lettura usate dal backup. */
export type DelegatoLettura = {
  findMany(): Promise<Record<string, unknown>[]>;
};

/** Operazioni di scrittura usate dal ripristino. */
export type DelegatoScrittura = {
  deleteMany(args: Record<string, never>): Promise<unknown>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
  update(args: { where: { id: string }; data: { segnalazionePrecedenteId: string } }): Promise<unknown>;
};

export type DelegatiLettura = Record<NomeTabella, DelegatoLettura>;

type TransazioneRipristino = Record<NomeTabella | "sessione", DelegatoScrittura> & {
  $queryRawUnsafe(query: string): Promise<unknown>;
};

export type ClientRipristino = Record<NomeTabella, { count(): Promise<number> }> & {
  $transaction(
    fn: (tx: TransazioneRipristino) => Promise<unknown>,
    opzioni: { timeout: number; maxWait: number },
  ): Promise<unknown>;
};

type Log = (messaggio: string) => void;

/** Errore di validazione dell'operazione: il messaggio è destinato all'operatore. */
export class ErroreBackup extends Error {}

/**
 * Legge e valida la chiave di cifratura. Senza chiave l'operazione è rifiutata.
 */
export function leggiChiave(raw: string | undefined): Buffer {
  if (!raw) {
    throw new ErroreBackup(
      "BACKUP_ENCRYPTION_KEY non impostata: la chiave è obbligatoria per creare e ripristinare i backup.",
    );
  }
  const chiave = Buffer.from(raw.trim(), "base64");
  if (chiave.length !== 32 || chiave.toString("base64") !== raw.trim()) {
    throw new ErroreBackup(
      `BACKUP_ENCRYPTION_KEY deve essere una stringa Base64 di 32 byte (256 bit), ricevuti ${chiave.length} byte.`,
    );
  }
  return chiave;
}

/** Cifra un buffer con AES-256-GCM. */
export function cifra(dati: Buffer, chiave: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chiave, iv);
  const cifrato = Buffer.concat([cipher.update(dati), cipher.final()]);
  return Buffer.concat([iv, cifrato, cipher.getAuthTag()]);
}

/** Decifra un buffer prodotto da `cifra`. Lancia se la chiave è errata o il file alterato. */
export function decifra(dati: Buffer, chiave: Buffer): Buffer {
  if (dati.length < 12 + 16) {
    throw new ErroreBackup("File cifrato non valido: più corto di IV e auth tag.");
  }
  const iv = dati.subarray(0, 12);
  const authTag = dati.subarray(dati.length - 16);
  const corpo = dati.subarray(12, dati.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", chiave, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(corpo), decipher.final()]);
}

/** Nome della directory di backup, in UTC: `backup-YYYYMMDD-HHMMSS`. */
export function generaNomeBackup(ora: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const data = `${ora.getUTCFullYear()}${pad(ora.getUTCMonth() + 1)}${pad(ora.getUTCDate())}`;
  const orario = `${pad(ora.getUTCHours())}${pad(ora.getUTCMinutes())}${pad(ora.getUTCSeconds())}`;
  return `backup-${data}-${orario}`;
}

/** Ricava la data UTC dal nome di backup, oppure null se il nome non è valido. */
export function dataDaNomeBackup(nome: string): Date | null {
  const m = nome.match(/^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [anno, mese, giorno, ore, minuti, secondi] = m.slice(1).map(Number);
  const data = new Date(Date.UTC(anno, mese - 1, giorno, ore, minuti, secondi));
  // Date.UTC fa scorrere le date non valide (es. mese 13): il nome deve tornare identico.
  return generaNomeBackup(data) === nome ? data : null;
}

/** Valida il nome di backup passato in input: previene path traversal. */
export function validaNomeBackup(nome: string | undefined): string {
  if (!nome) {
    throw new ErroreBackup("Nome backup mancante. Esempio: backup-20260712-143045");
  }
  if (!BACKUP_NAME_REGEX.test(nome)) {
    throw new ErroreBackup(
      `Nome backup non valido: ${nome}. Formato atteso backup-YYYYMMDD-HHMMSS, senza separatori di percorso.`,
    );
  }
  return nome;
}

async function scriviCifrato(file: string, dati: Buffer, chiave: Buffer): Promise<void> {
  // La cifratura non sostituisce i permessi del filesystem: un backup
  // contiene anche hash delle password e segreti TOTP. Non sovrascrivere
  // file già presenti, neppure se sono collegamenti simbolici.
  await writeFile(file, cifra(dati, chiave), { flag: "wx", mode: 0o600 });
}

/**
 * Copia ricorsivamente la directory degli allegati cifrando ogni file.
 * - Le directory mancanti danno esito vuoto (installazione nuova).
 * - I symlink e le voci speciali (socket, fifo) vengono saltati: non devono
 *   mai far uscire il backup dalla directory degli allegati.
 * - I file oltre MAX_ALLEGATO_BACKUP_BYTE e quelli non leggibili vengono
 *   conteggiati come saltati. Il chiamante rifiuta l'archivio incompleto.
 */
export async function copiaAllegatiCifrati(
  sorgente: string,
  destinazione: string,
  chiave: Buffer,
  log: Log,
): Promise<{ copiati: number; saltati: number }> {
  let voci: Dirent[];
  try {
    voci = await readdir(sorgente, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { copiati: 0, saltati: 0 };
    throw e;
  }
  await mkdir(destinazione, { recursive: true, mode: 0o700 });

  let copiati = 0;
  let saltati = 0;
  for (const voce of voci) {
    const src = path.join(sorgente, voce.name);
    const dst = path.join(destinazione, voce.name);
    if (voce.isSymbolicLink()) {
      log(`[SECURITY] Symlink saltato durante il backup: ${src}`);
      saltati++;
    } else if (voce.isDirectory()) {
      const esito = await copiaAllegatiCifrati(src, dst, chiave, log);
      copiati += esito.copiati;
      saltati += esito.saltati;
    } else if (!voce.isFile()) {
      log(`[SECURITY] Voce non regolare saltata durante il backup: ${src}`);
      saltati++;
    } else {
      const { size } = await lstat(src);
      if (size > MAX_ALLEGATO_BACKUP_BYTE) {
        log(`[BACKUP] File troppo grande saltato (${(size / 1024 / 1024).toFixed(2)} MB): ${src}`);
        saltati++;
        continue;
      }
      let dati: Buffer;
      try {
        dati = await readFile(src);
      } catch (e) {
        log(`[BACKUP] File non leggibile saltato: ${src} (${(e as Error).message})`);
        saltati++;
        continue;
      }
      await scriviCifrato(`${dst}.enc`, dati, chiave);
      copiati++;
    }
  }
  return { copiati, saltati };
}

/** Rimuove i backup più vecchi di RETENTION_GIORNI. Ignora le voci con nome non previsto. */
export async function applicaRetention(backupDir: string, ora: Date, log: Log): Promise<number> {
  const limite = ora.getTime() - RETENTION_GIORNI * 24 * 60 * 60 * 1000;
  let rimossi = 0;
  for (const nome of await readdir(backupDir)) {
    const data = dataDaNomeBackup(nome);
    if (!data || data.getTime() >= limite) continue;
    await rm(path.join(backupDir, nome), { recursive: true, force: true });
    rimossi++;
    log(`Retention: backup ${nome} rimosso (più vecchio di ${RETENTION_GIORNI} giorni)`);
  }
  return rimossi;
}

type OpzioniBackup = {
  delegati: DelegatiLettura;
  backupDir: string;
  uploadsDir: string;
  chiave: Buffer;
  ora: Date;
  log: Log;
};

type EsitoBackup = {
  backupPath: string;
  record: Partial<Record<NomeTabella, number>>;
  allegatiCopiati: number;
  allegatiSaltati: number;
  backupRimossi: number;
};

/**
 * Prepara una copia completa in una directory temporanea. Il nome definitivo
 * compare solo quando tabelle e allegati sono stati cifrati e verificati:
 * un backup parziale non può essere scambiato per uno ripristinabile.
 */
export async function eseguiBackup(o: OpzioniBackup): Promise<EsitoBackup> {
  const nome = generaNomeBackup(o.ora);
  const backupPath = path.join(o.backupDir, nome);
  await mkdir(o.backupDir, { recursive: true, mode: 0o700 });
  const directoryBackup = await lstat(o.backupDir);
  if (!directoryBackup.isDirectory() || directoryBackup.isSymbolicLink()) {
    throw new ErroreBackup("La directory dei backup non è una directory regolare.");
  }
  // mkdir non cambia la modalità delle directory già presenti: proteggere
  // anche i backup esistenti e impedire l'elencazione da altri utenti locali.
  await chmod(o.backupDir, 0o700);
  const temporanea = await mkdtemp(path.join(o.backupDir, ".cielobuio-backup-"));

  try {
    const record: Partial<Record<NomeTabella, number>> = {};
    let riferimentiAllegati: Record<string, unknown>[] = [];
    for (const tabella of TABELLE_BACKUP) {
      const righe = await o.delegati[tabella].findMany();
      await scriviCifrato(
        path.join(temporanea, `${tabella}.json.enc`),
        Buffer.from(JSON.stringify(righe, null, 2), "utf-8"),
        o.chiave,
      );
      if (tabella === "allegato") riferimentiAllegati = righe;
      record[tabella] = righe.length;
      o.log(`- ${tabella}: ${righe.length} record esportati (cifrato)`);
    }

    const metadati = {
      formato: "cieloBuio-backup",
      versioneFormato: 2,
      tabelle: TABELLE_BACKUP,
      cifratura: "AES-256-GCM",
    };
    await scriviCifrato(
      path.join(temporanea, "_metadata.json.enc"),
      Buffer.from(JSON.stringify(metadati, null, 2), "utf-8"),
      o.chiave,
    );

    const uploadsBackup = path.join(temporanea, "uploads");
    await mkdir(uploadsBackup, { mode: 0o700 });
    const allegati = await copiaAllegatiCifrati(o.uploadsDir, uploadsBackup, o.chiave, o.log);
    if (allegati.saltati > 0) {
      throw new ErroreBackup(`Backup incompleto: ${allegati.saltati} allegati non copiati. Controllare i log.`);
    }
    // La copia può includere file orfani presenti nello storage. Anche questi
    // devono rispettare il formato accettato dal ripristino: non pubblicare
    // mai un archivio che la stessa applicazione poi rifiuterebbe.
    for (const dir of await readdir(uploadsBackup, { withFileTypes: true })) {
      if (!dir.isDirectory() || !isSafePathSegment(dir.name)) {
        throw new ErroreBackup("Backup incompleto: directory allegati non compatibile con il ripristino.");
      }
      for (const file of await readdir(path.join(uploadsBackup, dir.name), { withFileTypes: true })) {
        const nome = file.name.endsWith(".enc") ? file.name.slice(0, -4) : "";
        if (!file.isFile() || !isSafePathSegment(nome) || !/\.(?:jpe?g|png|webp|pdf)$/i.test(nome)) {
          throw new ErroreBackup("Backup incompleto: allegato non compatibile con il ripristino.");
        }
      }
    }
    for (const riga of riferimentiAllegati) {
      const riferimento = parseUrlStorageSicuro(riga.urlStorage as string);
      if (!riferimento || riga.segnalazioneId !== riferimento.segnalazioneId) {
        throw new ErroreBackup("Backup incompleto: un allegato ha un percorso non valido.");
      }
      const fileCifrato = path.join(uploadsBackup, riferimento.segnalazioneId, `${riferimento.filename}.enc`);
      try {
        if (!(await stat(fileCifrato)).isFile()) throw new Error("Non è un file");
      } catch {
        throw new ErroreBackup(`Backup incompleto: allegato ${riga.id} non presente sul disco.`);
      }
    }
    await rename(temporanea, backupPath);
    const backupRimossi = await applicaRetention(o.backupDir, o.ora, o.log);
    return {
      backupPath,
      record,
      allegatiCopiati: allegati.copiati,
      allegatiSaltati: allegati.saltati,
      backupRimossi,
    };
  } catch (e) {
    await rm(temporanea, { recursive: true, force: true });
    throw e;
  }
}

/** Carica e decifra una tabella. Un file mancante rende il backup incompleto. */
export async function caricaTabella(
  backupPath: string,
  tabella: NomeTabella,
  chiave: Buffer,
): Promise<Record<string, unknown>[]> {
  const file = path.join(backupPath, `${tabella}.json.enc`);
  let cifrato: Buffer;
  try {
    cifrato = await readFile(file);
  } catch (e) {
    throw new ErroreBackup(`Backup incompleto: ${file} mancante o non leggibile (${(e as Error).message})`);
  }
  let righe: unknown;
  try {
    righe = JSON.parse(decifra(cifrato, chiave).toString("utf-8"));
  } catch {
    throw new ErroreBackup(`File ${file} non decifrabile: chiave di cifratura errata o file corrotto.`);
  }
  if (!Array.isArray(righe) || righe.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
    throw new ErroreBackup(`Formato non valido in ${file}: atteso un array di record.`);
  }
  return righe as Record<string, unknown>[];
}

type OpzioniRipristino = {
  db: ClientRipristino;
  backupPath: string;
  uploadsDir: string;
  chiave: Buffer;
  force: boolean;
  log: Log;
};

/** Decifra gli allegati in una directory temporanea senza seguire symlink. */
async function preparaAllegatiRipristino(
  backupPath: string,
  destinazione: string,
  chiave: Buffer,
): Promise<Set<string>> {
  const sorgente = path.join(backupPath, "uploads");
  let directory: Dirent[];
  try {
    const tipo = await lstat(sorgente);
    if (!tipo.isDirectory() || tipo.isSymbolicLink()) {
      throw new ErroreBackup("Backup non valido: la directory uploads non è una directory regolare.");
    }
    directory = await readdir(sorgente, { withFileTypes: true });
  } catch (e) {
    if (e instanceof ErroreBackup) throw e;
    throw new ErroreBackup("Backup incompleto: directory cifrata uploads mancante o non leggibile.");
  }

  const ripristinati = new Set<string>();
  for (const dir of directory) {
    if (!dir.isDirectory() || !isSafePathSegment(dir.name)) {
      throw new ErroreBackup("Backup non valido: directory allegati non sicura.");
    }
    const cartella = path.join(destinazione, dir.name);
    await mkdir(cartella, { mode: 0o700 });
    for (const file of await readdir(path.join(sorgente, dir.name), { withFileTypes: true })) {
      const nome = file.name.endsWith(".enc") ? file.name.slice(0, -4) : "";
      if (!file.isFile() || !isSafePathSegment(nome) || !/\.(?:jpe?g|png|webp|pdf)$/i.test(nome)) {
        throw new ErroreBackup("Backup non valido: nome o tipo di allegato non sicuro.");
      }
      // Il formato GCM aggiunge esattamente 12 byte di IV e 16 byte di tag.
      // Controllare prima di readFile evita di allocare un file arbitrario
      // (o una copia alterata enorme) nella memoria del processo.
      const filePath = path.join(sorgente, dir.name, file.name);
      if ((await lstat(filePath)).size > MAX_ALLEGATO_BACKUP_BYTE + 28) {
        throw new ErroreBackup(`Allegato ${dir.name}/${nome} troppo grande per il ripristino.`);
      }
      const cifrato = await readFile(filePath);
      let chiaro: Buffer;
      try {
        chiaro = decifra(cifrato, chiave);
      } catch {
        throw new ErroreBackup(`Allegato ${dir.name}/${nome} non decifrabile: chiave errata o file corrotto.`);
      }
      await writeFile(path.join(cartella, nome), chiaro, { flag: "wx", mode: 0o600 });
      ripristinati.add(`${dir.name}/${nome}`);
    }
  }
  return ripristinati;
}

/**
 * Ripristina allegati e database da un backup completo. Prima di cambiare
 * qualsiasi dato verifica metadati, tabelle e cifratura di tutti gli allegati.
 * L'applicazione va fermata durante il ripristino: file e database non possono
 * condividere una transazione atomica con operazioni concorrenti esterne.
 */
export async function eseguiRipristino(o: OpzioniRipristino): Promise<Record<NomeTabella, number>> {
  let metadati: unknown;
  try {
    metadati = JSON.parse(decifra(await readFile(path.join(o.backupPath, "_metadata.json.enc")), o.chiave).toString());
  } catch {
    throw new ErroreBackup("Metadati del backup mancanti, corrotti o cifrati con una chiave diversa.");
  }
  if (
    !metadati ||
    typeof metadati !== "object" ||
    (metadati as Record<string, unknown>).formato !== "cieloBuio-backup" ||
    (metadati as Record<string, unknown>).versioneFormato !== 2 ||
    (metadati as Record<string, unknown>).cifratura !== "AES-256-GCM" ||
    JSON.stringify((metadati as Record<string, unknown>).tabelle) !== JSON.stringify(TABELLE_BACKUP)
  ) {
    throw new ErroreBackup("Metadati del backup non validi o versione del formato non supportata.");
  }

  const dati = {} as Record<NomeTabella, Record<string, unknown>[]>;
  for (const tabella of TABELLE_BACKUP) {
    dati[tabella] = await caricaTabella(o.backupPath, tabella, o.chiave);
  }
  const segnalazioniId = new Set(dati.segnalazione.map((s) => s.id));
  const collegamenti = dati.segnalazione.flatMap((s) => {
    const precedente = s.segnalazionePrecedenteId;
    if (precedente == null) return [];
    if (typeof s.id !== "string" || typeof precedente !== "string" || !segnalazioniId.has(precedente)) {
      throw new ErroreBackup("Backup non valido: collegamento di recidiva senza segnalazione precedente.");
    }
    return [{ id: s.id, precedente }];
  });

  if (!o.force) {
    // La sola assenza di utenti non basta: una banca dati può contenere
    // configurazioni, pratiche già anonimizzate o audit indipendenti.
    const conteggiEsistenti = await Promise.all(
      TABELLE_BACKUP.map(async (tabella) => ({ tabella, count: await o.db[tabella].count() })),
    );
    const popolate = conteggiEsistenti.filter((voce) => voce.count > 0);
    if (popolate.length > 0) {
      throw new ErroreBackup(
        `Il database contiene già dati (${popolate.map((v) => `${v.tabella}: ${v.count}`).join(", ")}). Il ripristino sovrascriverà i dati esistenti: ripetere il comando con --force.`,
      );
    }
  }

  const parent = path.dirname(o.uploadsDir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporanea = await mkdtemp(path.join(parent, ".cielobuio-restore-"));
  let precedente: string | null = null;
  let nuoviFileAttivi = false;
  let databaseRipristinato = false;
  try {
    const ripristinati = await preparaAllegatiRipristino(o.backupPath, temporanea, o.chiave);
    for (const riga of dati.allegato) {
      const url = riga.urlStorage;
      if (typeof url !== "string" || !ripristinati.has(url)) {
        throw new ErroreBackup(`Backup incompleto: file dell'allegato ${riga.id} mancante.`);
      }
    }
    const live = await lstat(o.uploadsDir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (live) {
      if (!live.isDirectory() || live.isSymbolicLink()) {
        throw new ErroreBackup("La directory degli allegati non è una directory regolare.");
      }
      precedente = path.join(parent, `.cielobuio-previous-${randomUUID()}`);
      await rename(o.uploadsDir, precedente);
    }
    try {
      await rename(temporanea, o.uploadsDir);
      nuoviFileAttivi = true;
      const conteggi = {} as Record<NomeTabella, number>;
      await o.db.$transaction(
        async (tx) => {
          // Figli prima dei padri; poi inserimento inverso. Le relazioni di
          // recidiva sono impostate solo dopo che tutte le righe esistono.
          const ordineEliminazione: (NomeTabella | "sessione")[] = [...TABELLE_BACKUP, "sessione"];
          for (const tabella of ordineEliminazione.reverse()) {
            await tx[tabella].deleteMany({});
          }
          for (const tabella of TABELLE_BACKUP) {
            const righe =
              tabella === "segnalazione"
                ? dati.segnalazione.map((s) =>
                    s.segnalazionePrecedenteId ? { ...s, segnalazionePrecedenteId: null } : s,
                  )
                : dati[tabella];
            await tx[tabella].createMany({ data: righe });
            conteggi[tabella] = righe.length;
            o.log(`- ${tabella}: ${righe.length} record ripristinati`);
          }
          for (const { id, precedente: segnalazionePrecedenteId } of collegamenti) {
            await tx.segnalazione.update({ where: { id }, data: { segnalazionePrecedenteId } });
          }
          // Gli ID espliciti non avanzano le sequenze SERIAL. ALTER SEQUENCE
          // RESTART è transazionale, mentre setval non viene annullato se la
          // transazione fallisce: il riallineamento resta nel medesimo rollback.
          for (const tabella of ["regioni_leggi", "province", "comuni"]) {
            await tx.$queryRawUnsafe(`
              DO $$
              DECLARE sequenza text;
                      prossimo bigint;
              BEGIN
                SELECT pg_get_serial_sequence('${tabella}', 'id') INTO sequenza;
                SELECT COALESCE(MAX(id)::bigint, 0) + 1 INTO prossimo FROM ${tabella};
                EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s', sequenza, prossimo);
              END $$
            `);
          }
        },
        { timeout: TIMEOUT_RIPRISTINO_MS, maxWait: 10_000 },
      );
      databaseRipristinato = true;
      if (precedente) {
        await rm(precedente, { recursive: true, force: true }).catch((e: unknown) => {
          o.log(`Attenzione: directory precedente conservata in ${precedente}: ${String(e)}`);
        });
      }
      o.log(`- Allegati fisici: ${ripristinati.size} file ripristinati`);
      return conteggi;
    } catch (e) {
      // Dopo il commit database e nuovi file sono già coerenti. Un errore
      // della pulizia o dell'output non deve ripristinare solo lo storage.
      if (databaseRipristinato) throw e;
      if (nuoviFileAttivi) await rm(o.uploadsDir, { recursive: true, force: true });
      if (precedente) await rename(precedente, o.uploadsDir);
      throw e;
    }
  } finally {
    await rm(temporanea, { recursive: true, force: true });
  }
}
