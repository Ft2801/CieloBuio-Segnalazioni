import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, truncate, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  MAX_ALLEGATO_BACKUP_BYTE,
  TABELLE_BACKUP,
  cifra,
  decifra,
  eseguiBackup,
  eseguiRipristino,
  type ClientRipristino,
  type DelegatiLettura,
  type DelegatoScrittura,
  type NomeTabella,
} from "@/lib/backup";

const CHIAVE = Buffer.alloc(32, 42);
let tmp: string;
let sorgente: string;
let destinazione: string;
let backupDir: string;
const log = vi.fn();

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cielobuio-integrita-"));
  sorgente = path.join(tmp, "sorgente");
  destinazione = path.join(tmp, "destinazione");
  backupDir = path.join(tmp, "backups");
  log.mockClear();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function lettura(dati: Partial<Record<NomeTabella, Record<string, unknown>[]>> = {}): DelegatiLettura {
  return Object.fromEntries(
    TABELLE_BACKUP.map((t) => [t, { findMany: vi.fn().mockResolvedValue(dati[t] ?? []) }]),
  ) as unknown as DelegatiLettura;
}

async function backup(dati: Partial<Record<NomeTabella, Record<string, unknown>[]>> = {}) {
  return (
    await eseguiBackup({
      delegati: lettura(dati),
      uploadsDir: sorgente,
      backupDir,
      chiave: CHIAVE,
      ora: new Date("2026-10-29T02:00:00Z"),
      log,
    })
  ).backupPath;
}

function client(utenti = 0) {
  const scrittura = Object.fromEntries(
    [...TABELLE_BACKUP, "sessione"].map((t) => [
      t,
      {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
    ]),
  ) as unknown as Record<NomeTabella | "sessione", DelegatoScrittura>;
  const conteggi = Object.fromEntries(
    TABELLE_BACKUP.map((t) => [t, { count: vi.fn().mockResolvedValue(t === "user" ? utenti : 0) }]),
  ) as unknown as Pick<ClientRipristino, NomeTabella>;
  const query = vi.fn().mockResolvedValue([]);
  const db: ClientRipristino = {
    ...conteggi,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...scrittura, $queryRawUnsafe: query })),
  };
  return { db, scrittura, query };
}

function opzioni(db: ClientRipristino, backupPath: string, force = false) {
  return { db, backupPath, uploadsDir: destinazione, chiave: CHIAVE, force, log };
}

async function foto(): Promise<{ segnalazione: Record<string, unknown>[]; allegato: Record<string, unknown>[] }> {
  await mkdir(path.join(sorgente, "s1"), { recursive: true });
  await writeFile(path.join(sorgente, "s1", "foto.jpg"), "foto originale");
  return {
    segnalazione: [{ id: "s1", segnalazionePrecedenteId: null }],
    allegato: [{ id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg" }],
  };
}

describe("integrità del backup e degli allegati", () => {
  it("non pubblica directory temporanee se manca un allegato presente nel database", async () => {
    await expect(
      backup({ allegato: [{ id: "a1", segnalazioneId: "s1", urlStorage: "s1/assente.jpg" }] }),
    ).rejects.toThrow("non presente sul disco");
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("rifiuta un urlStorage non sicuro o che non appartiene alla pratica", async () => {
    const dati = await foto();
    await expect(
      backup({ ...dati, allegato: [{ id: "a1", segnalazioneId: "s1", urlStorage: "../foto.jpg" }] }),
    ).rejects.toThrow("percorso non valido");
    await expect(
      backup({ ...dati, allegato: [{ id: "a1", segnalazioneId: "altra", urlStorage: "s1/foto.jpg" }] }),
    ).rejects.toThrow("percorso non valido");
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("rifiuta file orfani non ripristinabili prima di pubblicare il backup", async () => {
    await mkdir(path.join(sorgente, "s1"), { recursive: true });
    await writeFile(path.join(sorgente, "s1", "orphan.txt"), "testo");
    await expect(backup()).rejects.toThrow("non compatibile con il ripristino");
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("rifiuta file al primo livello, non compatibili con la struttura uploads", async () => {
    await mkdir(sorgente);
    await writeFile(path.join(sorgente, "foto.pdf"), "testo");
    await expect(backup()).rejects.toThrow("directory allegati non compatibile");
  });

  it("rifiuta i symlink saltati dalla copia e non lascia copie parziali", async () => {
    await mkdir(sorgente);
    await writeFile(path.join(tmp, "fuori.jpg"), "fuori");
    await symlink(path.join(tmp, "fuori.jpg"), path.join(sorgente, "link.jpg"));
    await expect(backup()).rejects.toThrow("allegati non copiati");
    expect(await readdir(backupDir)).toEqual([]);
  });
});

describe("ripristino completo e rollback", () => {
  it("ripristina file, recidive e sequenze transazionali sostituendo la vecchia cartella", async () => {
    const dati = await foto();
    dati.segnalazione.push({ id: "s2", segnalazionePrecedenteId: "s1" });
    const backupPath = await backup(dati);
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "vecchia.jpg"), "dati precedenti");
    const { db, scrittura, query } = client();

    const conteggi = await eseguiRipristino(opzioni(db, backupPath));

    expect(conteggi.segnalazione).toBe(2);
    expect(conteggi.allegato).toBe(1);
    expect(await readFile(path.join(destinazione, "s1", "foto.jpg"), "utf8")).toBe("foto originale");
    expect((await stat(destinazione)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(destinazione, "s1"))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(destinazione, "s1", "foto.jpg"))).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(destinazione, "vecchia.jpg"))).toBe(false);
    expect(scrittura.segnalazione.createMany).toHaveBeenCalledWith({
      data: [
        { id: "s1", segnalazionePrecedenteId: null },
        { id: "s2", segnalazionePrecedenteId: null },
      ],
    });
    expect(scrittura.segnalazione.update).toHaveBeenCalledWith({
      where: { id: "s2" },
      data: { segnalazionePrecedenteId: "s1" },
    });
    expect(vi.mocked(scrittura.segnalazione.update).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(scrittura.segnalazione.createMany).mock.invocationCallOrder[0],
    );
    expect(query).toHaveBeenCalledTimes(3);
    for (const [index, tabella] of ["regioni_leggi", "province", "comuni"].entries()) {
      expect(query.mock.calls[index][0]).toContain(`FROM ${tabella}`);
      expect(query.mock.calls[index][0]).toContain("ALTER SEQUENCE %s RESTART WITH %s");
      expect(query.mock.calls[index][0]).not.toContain("setval(");
    }
    expect((await readdir(tmp)).some((n) => n.startsWith(".cielobuio-"))).toBe(false);
  });

  it("in caso di errore SQL ripristina i vecchi file e non lascia file del backup attivi", async () => {
    const backupPath = await backup(await foto());
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "vecchia.jpg"), "integra");
    const { db } = client();
    vi.mocked(db.$transaction).mockRejectedValueOnce(new Error("rollback database"));

    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("rollback database");
    expect(await readFile(path.join(destinazione, "vecchia.jpg"), "utf8")).toBe("integra");
    expect(existsSync(path.join(destinazione, "s1", "foto.jpg"))).toBe(false);
    expect((await readdir(tmp)).some((n) => n.startsWith(".cielobuio-"))).toBe(false);
  });

  it("in caso di rollback senza storage preesistente rimuove i nuovi file", async () => {
    const backupPath = await backup(await foto());
    const { db } = client();
    vi.mocked(db.$transaction).mockRejectedValueOnce(new Error("rollback senza storage"));

    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("rollback senza storage");
    expect(existsSync(destinazione)).toBe(false);
    expect((await readdir(tmp)).some((n) => n.startsWith(".cielobuio-"))).toBe(false);
  });

  it("non distrugge lo storage se il file cifrato è mancante", async () => {
    const backupPath = await backup(await foto());
    await rm(path.join(backupPath, "uploads", "s1", "foto.jpg.enc"));
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "vecchia.jpg"), "integra");
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("mancante");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await readFile(path.join(destinazione, "vecchia.jpg"), "utf8")).toBe("integra");
  });

  it("non modifica i dati se un allegato cifrato è corrotto", async () => {
    const backupPath = await backup(await foto());
    const file = path.join(backupPath, "uploads", "s1", "foto.jpg.enc");
    const alterato = await readFile(file);
    alterato[14] ^= 1;
    await writeFile(file, alterato);
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("non decifrabile");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta un file cifrato troppo grande senza caricarlo in memoria", async () => {
    const backupPath = await backup();
    await mkdir(path.join(backupPath, "uploads", "s1"));
    const file = path.join(backupPath, "uploads", "s1", "foto.jpg.enc");
    await writeFile(file, "");
    await truncate(file, MAX_ALLEGATO_BACKUP_BYTE + 29);
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("troppo grande");
  });

  it("rifiuta una directory uploads cifrata che è un collegamento simbolico", async () => {
    const backupPath = await backup();
    await rm(path.join(backupPath, "uploads"), { recursive: true });
    await mkdir(path.join(tmp, "esterno"));
    await symlink(path.join(tmp, "esterno"), path.join(backupPath, "uploads"));
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("directory regolare");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta una directory uploads assente o un file extra al primo livello", async () => {
    const backupPath = await backup();
    const { db } = client();
    await rename(path.join(backupPath, "uploads"), path.join(backupPath, "salvata"));
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("uploads mancante");
    await rename(path.join(backupPath, "salvata"), path.join(backupPath, "uploads"));
    await writeFile(path.join(backupPath, "uploads", "extra.enc"), cifra(Buffer.from("x"), CHIAVE));
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("directory allegati non sicura");
  });

  it("rifiuta un file non cifrato o un symlink nella sottodirectory", async () => {
    const backupPath = await backup();
    const cartella = path.join(backupPath, "uploads", "s1");
    await mkdir(cartella);
    const { db } = client();
    const file = path.join(cartella, "foto.jpg");
    await writeFile(file, "in chiaro");
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("nome o tipo");
    await rm(file);
    await writeFile(path.join(tmp, "fuori.jpg.enc"), "fuori");
    await symlink(path.join(tmp, "fuori.jpg.enc"), path.join(cartella, "foto.jpg.enc"));
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("nome o tipo");
  });

  it("rifiuta il database popolato anche se non contiene utenti", async () => {
    const backupPath = await backup();
    const { db } = client();
    vi.mocked(db.auditLog.count).mockResolvedValue(1);
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("auditLog: 1");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta una recidiva che punta a un record assente", async () => {
    const backupPath = await backup({
      segnalazione: [{ id: "s2", segnalazionePrecedenteId: "s1" }],
    });
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("recidiva");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rifiuta uno storage corrente che non è una directory regolare", async () => {
    const backupPath = await backup();
    await writeFile(destinazione, "non directory");
    const { db } = client();
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("directory regolare");
    expect(await readFile(destinazione, "utf8")).toBe("non directory");
  });

  it("rifiuta metadati incoerenti o file tabella con righe non-oggetto", async () => {
    const backupPath = await backup();
    const { db } = client();
    const meta = path.join(backupPath, "_metadata.json.enc");
    const originale = JSON.parse(decifra(await readFile(meta), CHIAVE).toString());
    for (const cambia of [{ formato: "altro" }, { versioneFormato: 1 }, { cifratura: "nessuna" }, { tabelle: [] }]) {
      await writeFile(meta, cifra(Buffer.from(JSON.stringify({ ...originale, ...cambia })), CHIAVE));
      await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("Metadati del backup non validi");
    }
    await writeFile(meta, cifra(Buffer.from(JSON.stringify(originale)), CHIAVE));
    const tabella = path.join(backupPath, "user.json.enc");
    for (const righe of [[null], [42], [[1]]]) {
      await writeFile(tabella, cifra(Buffer.from(JSON.stringify(righe)), CHIAVE));
      await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("atteso un array di record");
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("coerenza dopo il commit del ripristino", () => {
  it("un errore di output dopo il commit non ripristina soltanto i vecchi file", async () => {
    const dati = await foto();
    const backupPath = await backup(dati);
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "precedente.txt"), "vecchio storage");
    const { db } = client();
    const output = (testo: string) => {
      if (testo.startsWith("- Allegati fisici:")) throw new Error("Output non disponibile");
    };
    await expect(eseguiRipristino({ ...opzioni(db, backupPath), log: output })).rejects.toThrow(
      "Output non disponibile",
    );
    expect(await readFile(path.join(destinazione, "s1", "foto.jpg"), "utf8")).toBe("foto originale");
    expect(existsSync(path.join(destinazione, "precedente.txt"))).toBe(false);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
