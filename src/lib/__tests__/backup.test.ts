/**
 * Test della libreria di backup cifrato: chiave, cifratura, nomi, copia degli
 * allegati, retention, esecuzione del backup e del ripristino.
 * Usa directory temporanee reali: nessun mock del file system.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, truncate, writeFile, chmod } from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import {
  ErroreBackup,
  MAX_ALLEGATO_BACKUP_BYTE,
  TABELLE_BACKUP,
  applicaRetention,
  caricaTabella,
  cifra,
  copiaAllegatiCifrati,
  dataDaNomeBackup,
  decifra,
  eseguiBackup,
  eseguiRipristino,
  generaNomeBackup,
  leggiChiave,
  validaNomeBackup,
  type ClientRipristino,
  type DelegatiLettura,
  type DelegatoScrittura,
  type NomeTabella,
} from "@/lib/backup";

const CHIAVE = Buffer.alloc(32, 7);
const CHIAVE_B64 = CHIAVE.toString("base64");

let tmp: string;
let logMessaggi: string[];
const log = (m: string) => {
  logMessaggi.push(m);
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cb-backup-"));
  logMessaggi = [];
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function delegatiLettura(righe: Partial<Record<NomeTabella, Record<string, unknown>[]>> = {}): DelegatiLettura {
  const out = {} as DelegatiLettura;
  for (const t of TABELLE_BACKUP) {
    const dati = righe[t] ?? [];
    out[t] = { findMany: vi.fn().mockResolvedValue(dati) };
  }
  return out;
}

function delegatiScrittura(): Record<NomeTabella | "sessione", DelegatoScrittura> {
  const out = {} as Record<NomeTabella | "sessione", DelegatoScrittura>;
  for (const t of [...TABELLE_BACKUP, "sessione" as const]) {
    out[t] = {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    };
  }
  return out;
}

describe("leggiChiave", () => {
  it("rifiuta una chiave assente", () => {
    expect(() => leggiChiave(undefined)).toThrow(ErroreBackup);
    expect(() => leggiChiave("")).toThrow("BACKUP_ENCRYPTION_KEY non impostata");
  });

  it("rifiuta una chiave di lunghezza errata", () => {
    expect(() => leggiChiave(Buffer.alloc(16).toString("base64"))).toThrow("32 byte");
  });

  it("rifiuta una stringa che non è Base64 canonica", () => {
    expect(() => leggiChiave("non-base64!!")).toThrow(ErroreBackup);
  });

  it("accetta una chiave valida (con spazi ai bordi tollerati)", () => {
    expect(leggiChiave(`  ${CHIAVE_B64}  `).equals(CHIAVE)).toBe(true);
  });
});

describe("cifra / decifra", () => {
  it("decifra il contenuto cifrato con la stessa chiave", () => {
    const dati = Buffer.from("segnalazione di prova", "utf-8");
    const cifrato = cifra(dati, CHIAVE);
    expect(cifrato.equals(dati)).toBe(false);
    expect(decifra(cifrato, CHIAVE).toString("utf-8")).toBe("segnalazione di prova");
  });

  it("usa un IV casuale: due cifrature dello stesso testo differiscono", () => {
    const dati = Buffer.from("stesso testo");
    expect(cifra(dati, CHIAVE).equals(cifra(dati, CHIAVE))).toBe(false);
  });

  it("rifiuta un file più corto di IV e auth tag", () => {
    expect(() => decifra(Buffer.alloc(10), CHIAVE)).toThrow("più corto di IV e auth tag");
  });

  it("rileva una chiave errata o un file alterato", () => {
    const cifrato = cifra(Buffer.from("dati"), CHIAVE);
    expect(() => decifra(cifrato, Buffer.alloc(32, 9))).toThrow();
    const alterato = Buffer.from(cifrato);
    alterato[14] ^= 0xff;
    expect(() => decifra(alterato, CHIAVE)).toThrow();
  });
});

describe("nomi di backup", () => {
  it("genera il nome in UTC nel formato backup-YYYYMMDD-HHMMSS", () => {
    expect(generaNomeBackup(new Date("2026-07-12T14:30:45Z"))).toBe("backup-20260712-143045");
  });

  it("ricava la data dal nome, o null se il nome non è valido", () => {
    expect(dataDaNomeBackup("backup-20260712-143045")?.toISOString()).toBe("2026-07-12T14:30:45.000Z");
    expect(dataDaNomeBackup("altro-nome")).toBeNull();
    expect(dataDaNomeBackup("backup-20261345-143045")).toBeNull(); // mese 13
  });

  it("valida il nome in ingresso e blocca il path traversal", () => {
    expect(validaNomeBackup("backup-20260712-143045")).toBe("backup-20260712-143045");
    expect(() => validaNomeBackup(undefined)).toThrow("Nome backup mancante");
    expect(() => validaNomeBackup("../../etc/passwd")).toThrow("Nome backup non valido");
  });
});

describe("copiaAllegatiCifrati", () => {
  it("una directory degli allegati mancante dà esito vuoto (installazione nuova)", async () => {
    const esito = await copiaAllegatiCifrati(path.join(tmp, "non-esiste"), path.join(tmp, "dst"), CHIAVE, log);
    expect(esito).toEqual({ copiati: 0, saltati: 0 });
    expect(existsSync(path.join(tmp, "dst"))).toBe(false);
  });

  it("propaga errori diversi da ENOENT (es. sorgente che non è una directory)", async () => {
    const file = path.join(tmp, "non-una-dir");
    await writeFile(file, "x");
    await expect(copiaAllegatiCifrati(file, path.join(tmp, "dst"), CHIAVE, log)).rejects.toThrow();
  });

  it("cifra i file, ricorre nelle sottodirectory e preserva la struttura", async () => {
    const src = path.join(tmp, "src");
    await mkdir(path.join(src, "seg1"), { recursive: true });
    await writeFile(path.join(src, "seg1", "foto.jpg"), "contenuto-foto");
    await writeFile(path.join(src, "radice.pdf"), "pdf");
    const dst = path.join(tmp, "dst");
    const esito = await copiaAllegatiCifrati(src, dst, CHIAVE, log);
    expect(esito).toEqual({ copiati: 2, saltati: 0 });
    const cifrato = await readFile(path.join(dst, "seg1", "foto.jpg.enc"));
    expect(decifra(cifrato, CHIAVE).toString()).toBe("contenuto-foto");
    expect(existsSync(path.join(dst, "radice.pdf.enc"))).toBe(true);
  });

  it("salta i symlink e segnala la voce nel log", async () => {
    const src = path.join(tmp, "src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(tmp, "segreto.txt"), "fuori");
    await symlink(path.join(tmp, "segreto.txt"), path.join(src, "link.txt"));
    const esito = await copiaAllegatiCifrati(src, path.join(tmp, "dst"), CHIAVE, log);
    expect(esito).toEqual({ copiati: 0, saltati: 1 });
    expect(logMessaggi.join("\n")).toContain("Symlink saltato");
  });

  it("salta le voci non regolari (fifo)", async () => {
    const src = path.join(tmp, "src");
    await mkdir(src, { recursive: true });
    execFileSync("mkfifo", [path.join(src, "pipe")]);
    const esito = await copiaAllegatiCifrati(src, path.join(tmp, "dst"), CHIAVE, log);
    expect(esito).toEqual({ copiati: 0, saltati: 1 });
    expect(logMessaggi.join("\n")).toContain("Voce non regolare saltata");
  });

  it("salta i file oltre il limite di dimensione senza leggerli", async () => {
    const src = path.join(tmp, "src");
    await mkdir(src, { recursive: true });
    const grande = path.join(src, "grande.bin");
    await writeFile(grande, "");
    await truncate(grande, MAX_ALLEGATO_BACKUP_BYTE + 1);
    const esito = await copiaAllegatiCifrati(src, path.join(tmp, "dst"), CHIAVE, log);
    expect(esito).toEqual({ copiati: 0, saltati: 1 });
    expect(logMessaggi.join("\n")).toContain("File troppo grande saltato");
  });

  // Come root i permessi non limitano la lettura: il caso viene dichiarato saltato, non superato.
  it.skipIf(process.getuid?.() === 0)("salta i file non leggibili senza interrompere il backup", async () => {
    const src = path.join(tmp, "src");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "chiuso.txt"), "x");
    await writeFile(path.join(src, "aperto.txt"), "y");
    await chmod(path.join(src, "chiuso.txt"), 0o000);
    const esito = await copiaAllegatiCifrati(src, path.join(tmp, "dst"), CHIAVE, log);
    expect(esito).toEqual({ copiati: 1, saltati: 1 });
    expect(logMessaggi.join("\n")).toContain("File non leggibile saltato");
    await chmod(path.join(src, "chiuso.txt"), 0o600);
  });
});

describe("applicaRetention", () => {
  it("rimuove i backup oltre la retention e conserva quelli recenti e le voci estranee", async () => {
    const ora = new Date("2026-10-28T12:00:00Z");
    await mkdir(path.join(tmp, "backup-20260101-000000"));
    await mkdir(path.join(tmp, "backup-20261020-000000"));
    await mkdir(path.join(tmp, "cartella-estranea"));
    const rimossi = await applicaRetention(tmp, ora, log);
    expect(rimossi).toBe(1);
    const restanti = (await readdir(tmp)).sort();
    expect(restanti).toEqual(["backup-20261020-000000", "cartella-estranea"]);
    expect(logMessaggi.join("\n")).toContain("backup-20260101-000000 rimosso");
  });
});

describe("eseguiBackup", () => {
  it("esporta tutte le tabelle cifrate, allegati e metadati", async () => {
    const backupDir = path.join(tmp, "backups");
    const uploadsDir = path.join(tmp, "uploads");
    await mkdir(path.join(uploadsDir, "seg"), { recursive: true });
    await writeFile(path.join(uploadsDir, "seg", "a.jpg"), "img");
    const delegati = delegatiLettura({
      user: [
        {
          id: "u1",
          email: "a@b.it",
          passwordHash: "$2b$hash",
          totpSecret: "SEGRETO",
          totpPendingSecret: "NUOVO_SEGRETO_IN_ATTESA",
        },
      ],
      segnalazione: [{ id: "s1" }, { id: "s2" }],
    });

    const esito = await eseguiBackup({
      delegati,
      backupDir,
      uploadsDir,
      chiave: CHIAVE,
      ora: new Date("2026-07-12T14:30:45Z"),
      log,
    });

    expect(esito.backupPath).toBe(path.join(backupDir, "backup-20260712-143045"));
    expect(esito.record.segnalazione).toBe(2);
    expect(esito.record.user).toBe(1);
    expect(esito.allegatiCopiati).toBe(1);
    expect(esito.allegatiSaltati).toBe(0);
    expect(esito.backupRimossi).toBe(0);

    // Ogni file è cifrato: nessun JSON in chiaro e nessun segreto leggibile.
    const files = await readdir(esito.backupPath);
    expect(files.every((f) => f.endsWith(".enc") || f === "uploads")).toBe(true);
    const utenti = JSON.parse(decifra(await readFile(path.join(esito.backupPath, "user.json.enc")), CHIAVE).toString());
    expect(utenti[0].passwordHash).toBe("$2b$hash");
    expect(utenti[0].totpSecret).toBe("SEGRETO");
    expect(utenti[0].totpPendingSecret).toBe("NUOVO_SEGRETO_IN_ATTESA");
    expect((await readFile(path.join(esito.backupPath, "user.json.enc"))).toString()).not.toContain(
      "NUOVO_SEGRETO_IN_ATTESA",
    );
    const meta = JSON.parse(
      decifra(await readFile(path.join(esito.backupPath, "_metadata.json.enc")), CHIAVE).toString(),
    );
    expect(meta.cifratura).toBe("AES-256-GCM");
    expect(meta.tabelle).toEqual([...TABELLE_BACKUP]);
    expect(existsSync(path.join(esito.backupPath, "uploads", "seg", "a.jpg.enc"))).toBe(true);
  });

  it("restringe una directory backup esistente e protegge tutti i file su disco", async () => {
    const backupDir = path.join(tmp, "backups");
    const uploadsDir = path.join(tmp, "uploads");
    await mkdir(backupDir);
    await chmod(backupDir, 0o755);
    await mkdir(path.join(uploadsDir, "seg"), { recursive: true });
    await writeFile(path.join(uploadsDir, "seg", "foto.jpg"), "documento riservato");

    const { backupPath } = await eseguiBackup({
      delegati: delegatiLettura({ user: [{ id: "u1", totpSecret: "segreto" }] }),
      backupDir,
      uploadsDir,
      chiave: CHIAVE,
      ora: new Date("2026-10-29T02:00:00Z"),
      log,
    });
    for (const directory of [
      backupDir,
      backupPath,
      path.join(backupPath, "uploads"),
      path.join(backupPath, "uploads", "seg"),
    ]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    for (const file of [
      path.join(backupPath, "user.json.enc"),
      path.join(backupPath, "_metadata.json.enc"),
      path.join(backupPath, "uploads", "seg", "foto.jpg.enc"),
    ]) {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("non segue un collegamento simbolico usato come directory dei backup", async () => {
    await mkdir(path.join(tmp, "destinazione"));
    await symlink(path.join(tmp, "destinazione"), path.join(tmp, "link"));
    await expect(
      eseguiBackup({
        delegati: delegatiLettura(),
        backupDir: path.join(tmp, "link"),
        uploadsDir: path.join(tmp, "uploads"),
        chiave: CHIAVE,
        ora: new Date("2026-10-29T02:00:00Z"),
        log,
      }),
    ).rejects.toThrow("directory regolare");
    expect(await readdir(path.join(tmp, "destinazione"))).toEqual([]);
  });

  it("non esporta le sessioni attive", async () => {
    expect(TABELLE_BACKUP).not.toContain("sessione");
  });
});

describe("caricaTabella", () => {
  it("segnala un backup incompleto se il file della tabella manca", async () => {
    await expect(caricaTabella(tmp, "comune", CHIAVE)).rejects.toThrow("Backup incompleto");
  });

  it("rifiuta un contenuto che non è un array di record", async () => {
    await writeFile(path.join(tmp, "comune.json.enc"), cifra(Buffer.from('{"non":"array"}'), CHIAVE));
    await expect(caricaTabella(tmp, "comune", CHIAVE)).rejects.toThrow("atteso un array");
  });

  it("segnala una chiave errata con un messaggio chiaro", async () => {
    await writeFile(path.join(tmp, "comune.json.enc"), cifra(Buffer.from('[{"id":1}]'), CHIAVE));
    const altraChiave = Buffer.alloc(32, 9);
    await expect(caricaTabella(tmp, "comune", altraChiave)).rejects.toThrow(ErroreBackup);
    await expect(caricaTabella(tmp, "comune", altraChiave)).rejects.toThrow("chiave di cifratura errata");
  });

  it("segnala un contenuto decifrato che non è JSON valido", async () => {
    await writeFile(path.join(tmp, "comune.json.enc"), cifra(Buffer.from("non json"), CHIAVE));
    await expect(caricaTabella(tmp, "comune", CHIAVE)).rejects.toThrow("chiave di cifratura errata o file corrotto");
  });

  it("carica e decifra i record", async () => {
    await writeFile(path.join(tmp, "comune.json.enc"), cifra(Buffer.from('[{"id":1}]'), CHIAVE));
    expect(await caricaTabella(tmp, "comune", CHIAVE)).toEqual([{ id: 1 }]);
  });
});

describe("eseguiRipristino", () => {
  async function creaBackupCompleto(): Promise<string> {
    const esito = await eseguiBackup({
      delegati: delegatiLettura({ user: [{ id: "u1", passwordHash: "h" }], comune: [{ id: 5 }] }),
      backupDir: tmp,
      uploadsDir: path.join(tmp, "nessuno"),
      chiave: CHIAVE,
      ora: new Date("2026-10-28T10:00:00Z"),
      log,
    });
    return esito.backupPath;
  }

  function clientFinto(utenti: number) {
    const scrittura = delegatiScrittura();
    const conteggi = Object.fromEntries(
      TABELLE_BACKUP.map((tabella) => [tabella, { count: vi.fn().mockResolvedValue(tabella === "user" ? utenti : 0) }]),
    ) as unknown as Pick<ClientRipristino, NomeTabella>;
    const query = vi.fn().mockResolvedValue([]);
    const client: ClientRipristino = {
      ...conteggi,
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({ ...scrittura, $queryRawUnsafe: query })),
    };
    return { client, scrittura, query };
  }

  it("con database vuoto ripristina tutte le tabelle, svuotando prima i figli", async () => {
    const backupPath = await creaBackupCompleto();
    const { client, scrittura } = clientFinto(0);
    const conteggi = await eseguiRipristino({
      db: client,
      backupPath,
      uploadsDir: path.join(tmp, "uploads-restored"),
      chiave: CHIAVE,
      force: false,
      log,
    });
    expect(conteggi.user).toBe(1);
    expect(conteggi.comune).toBe(1);
    expect(conteggi.regioneLegge).toBe(0);
    expect(scrittura.sessione.deleteMany).toHaveBeenCalled();
    expect(scrittura.user.createMany).toHaveBeenCalledWith({ data: [{ id: "u1", passwordHash: "h" }] });
    const ordineDelete = vi.mocked(scrittura.auditLog.deleteMany).mock.invocationCallOrder[0];
    const ordineCreate = vi.mocked(scrittura.regioneLegge.createMany).mock.invocationCallOrder[0];
    expect(ordineDelete).toBeLessThan(ordineCreate);
    expect(client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("rifiuta il ripristino su un database con utenti senza --force, senza modifiche", async () => {
    const backupPath = await creaBackupCompleto();
    const { client } = clientFinto(3);
    await expect(
      eseguiRipristino({
        db: client,
        backupPath,
        uploadsDir: path.join(tmp, "uploads-restored"),
        chiave: CHIAVE,
        force: false,
        log,
      }),
    ).rejects.toThrow("sovrascriverà i dati esistenti");
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("procede con --force anche su un database popolato", async () => {
    const backupPath = await creaBackupCompleto();
    const { client, scrittura } = clientFinto(3);
    await eseguiRipristino({
      db: client,
      backupPath,
      uploadsDir: path.join(tmp, "uploads-restored"),
      chiave: CHIAVE,
      force: true,
      log,
    });
    expect(client.$transaction).toHaveBeenCalled();
    expect(scrittura.user.createMany).toHaveBeenCalledWith({ data: [{ id: "u1", passwordHash: "h" }] });
  });

  it("non tocca il database se un file del backup è mancante", async () => {
    const backupPath = await creaBackupCompleto();
    await rm(path.join(backupPath, "segnalazione.json.enc"));
    const { client } = clientFinto(0);
    await expect(
      eseguiRipristino({
        db: client,
        backupPath,
        uploadsDir: path.join(tmp, "uploads-restored"),
        chiave: CHIAVE,
        force: false,
        log,
      }),
    ).rejects.toThrow("Backup incompleto");
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("con chiave errata il ripristino fallisce prima di toccare il database", async () => {
    const backupPath = await creaBackupCompleto();
    const { client } = clientFinto(0);
    await expect(
      eseguiRipristino({
        db: client,
        backupPath,
        uploadsDir: path.join(tmp, "uploads-restored"),
        chiave: Buffer.alloc(32, 1),
        force: false,
        log,
      }),
    ).rejects.toThrow();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe("file system di supporto", () => {
  it("le directory create dal backup esistono dopo l'esecuzione", async () => {
    await eseguiBackup({
      delegati: delegatiLettura(),
      backupDir: path.join(tmp, "b"),
      uploadsDir: path.join(tmp, "u"),
      chiave: CHIAVE,
      ora: new Date("2026-10-28T10:00:00Z"),
      log,
    });
    expect((await stat(path.join(tmp, "b", "backup-20261028-100000"))).isDirectory()).toBe(true);
  });
});
