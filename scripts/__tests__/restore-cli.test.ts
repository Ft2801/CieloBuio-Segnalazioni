/**
 * Test della CLI di ripristino (scripts/restore-db.ts) con client Prisma finto.
 * Lo script esegue la propria logica all'import: ogni scenario ricarica il modulo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { eseguiBackup, TABELLE_BACKUP, type DelegatiLettura } from "@/lib/backup";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../src/lib/prisma-client", () => ({
  createPrismaClient: () => holder.db,
}));

const CHIAVE = Buffer.alloc(32, 5);
const CHIAVE_B64 = CHIAVE.toString("base64");

function dbFinto(utenti: number, transazioneFallisce = false) {
  const scrittura = () => ({
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
  });
  const tx: Record<string, ReturnType<typeof scrittura>> = { sessione: scrittura() };
  for (const t of TABELLE_BACKUP) tx[t] = scrittura();
  const conteggi = Object.fromEntries(
    TABELLE_BACKUP.map((tabella) => [tabella, { count: vi.fn().mockResolvedValue(tabella === "user" ? utenti : 0) }]),
  );
  return {
    ...conteggi,
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      if (transazioneFallisce) throw new Error("transazione rifiutata");
      return fn({ ...tx, $queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    }),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

async function creaBackup(dir: string): Promise<string> {
  const delegati = {} as DelegatiLettura;
  for (const t of TABELLE_BACKUP) delegati[t] = { findMany: vi.fn().mockResolvedValue([]) };
  const esito = await eseguiBackup({
    delegati,
    backupDir: dir,
    uploadsDir: path.join(dir, "nessuno"),
    chiave: CHIAVE,
    ora: new Date("2026-10-28T10:00:00Z"),
    log: () => undefined,
  });
  return path.basename(esito.backupPath);
}

async function eseguiScript(argv: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ["node", "restore-db", ...argv];
  await import("../restore-db");
  await vi.waitFor(() => {
    expect((holder.db as { $disconnect: () => unknown }).$disconnect).toHaveBeenCalled();
  });
  await new Promise((r) => setTimeout(r, 0));
}

let tmp: string;
let errori: unknown[];
let messaggi: string[];
const argvOriginale = process.argv;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cb-cli-restore-"));
  errori = [];
  messaggi = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errori.push(a);
  });
  vi.spyOn(console, "log").mockImplementation((m: unknown) => {
    messaggi.push(String(m));
  });
  process.exitCode = 0;
  process.env.BACKUP_ENCRYPTION_KEY = CHIAVE_B64;
  process.env.BACKUP_DIR = tmp;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.argv = argvOriginale;
  process.exitCode = 0;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_DIR;
  delete process.env.STORAGE_ROOT;
  delete process.env.DOTENV_CONFIG_PATH;
  await rm(tmp, { recursive: true, force: true });
});

describe("CLI restore-db", () => {
  it("senza nome di backup termina con errore", async () => {
    holder.db = dbFinto(0);
    await eseguiScript([]);
    expect(process.exitCode).toBe(1);
    expect(errori.flat().join(" ")).toContain("Nome backup mancante");
  });

  it("rifiuta un nome con separatori di percorso", async () => {
    holder.db = dbFinto(0);
    await eseguiScript(["../../etc"]);
    expect(process.exitCode).toBe(1);
    expect(errori.flat().join(" ")).toContain("Nome backup non valido");
  });

  it("senza chiave termina con errore prima di leggere il backup", async () => {
    holder.db = dbFinto(0);
    delete process.env.BACKUP_ENCRYPTION_KEY;
    await eseguiScript(["backup-20261028-100000"]);
    expect(process.exitCode).toBe(1);
    expect(errori.flat().join(" ")).toContain("BACKUP_ENCRYPTION_KEY non impostata");
  });

  it("legge chiave e percorsi dal file di ambiente della CLI", async () => {
    const nome = await creaBackup(tmp);
    const root = path.join(tmp, "storage-configurato");
    const fileEnv = path.join(tmp, "ambiente.env");
    await writeFile(fileEnv, `BACKUP_ENCRYPTION_KEY=${CHIAVE_B64}\nBACKUP_DIR=${tmp}\nSTORAGE_ROOT=${root}\n`);
    delete process.env.BACKUP_ENCRYPTION_KEY;
    delete process.env.BACKUP_DIR;
    process.env.DOTENV_CONFIG_PATH = fileEnv;
    holder.db = dbFinto(0);
    await eseguiScript([nome]);
    expect(process.exitCode, JSON.stringify(errori)).toBe(0);
    expect(await readdir(root)).toEqual([]);
    expect((holder.db as { $transaction: unknown }).$transaction).toHaveBeenCalled();
  });

  it("ripristina un backup su database vuoto e riporta il totale", async () => {
    const nome = await creaBackup(tmp);
    holder.db = dbFinto(0);
    await eseguiScript([nome]);
    expect(process.exitCode).toBe(0);
    expect(messaggi.some((m) => m.startsWith("Ripristino completato:"))).toBe(true);
    expect((holder.db as { $transaction: unknown }).$transaction).toHaveBeenCalled();
  });

  it("su database con utenti richiede --force", async () => {
    const nome = await creaBackup(tmp);
    holder.db = dbFinto(4);
    await eseguiScript([nome]);
    expect(process.exitCode).toBe(1);
    expect(errori.flat().join(" ")).toContain("ripetere il comando con --force");
    expect((holder.db as { $transaction: unknown }).$transaction).not.toHaveBeenCalled();
  });

  it("con --force ripristina anche su database popolato", async () => {
    const nome = await creaBackup(tmp);
    holder.db = dbFinto(4);
    await eseguiScript([nome, "--force"]);
    expect(process.exitCode).toBe(0);
  });

  it("un errore della transazione termina con codice 1 e lo stampa", async () => {
    const nome = await creaBackup(tmp);
    holder.db = dbFinto(0, true);
    await eseguiScript([nome]);
    expect(process.exitCode).toBe(1);
    expect(errori.flat().some((e) => e instanceof Error && e.message === "transazione rifiutata")).toBe(true);
  });

  it("ripristina gli allegati nella directory STORAGE_ROOT configurata", async () => {
    const origine = path.join(tmp, "origine");
    await mkdir(path.join(origine, "s1"), { recursive: true });
    await writeFile(path.join(origine, "s1", "foto.jpg"), "immagine restaurata");
    const delegati = {} as DelegatiLettura;
    for (const tabella of TABELLE_BACKUP) delegati[tabella] = { findMany: vi.fn().mockResolvedValue([]) };
    delegati.allegato = {
      findMany: vi.fn().mockResolvedValue([{ id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg" }]),
    };
    await eseguiBackup({
      delegati,
      backupDir: tmp,
      uploadsDir: origine,
      chiave: CHIAVE,
      ora: new Date("2026-10-28T10:00:00Z"),
      log: () => undefined,
    });
    process.env.STORAGE_ROOT = path.join(tmp, "storage-custom");
    holder.db = dbFinto(0);
    await eseguiScript(["backup-20261028-100000"]);
    expect(process.exitCode).toBe(0);
    expect(await readFile(path.join(process.env.STORAGE_ROOT, "s1", "foto.jpg"), "utf8")).toBe("immagine restaurata");
  });

  it("senza BACKUP_DIR cerca il backup nella directory di lavoro", async () => {
    delete process.env.BACKUP_DIR;
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
    const nome = await creaBackup(path.join(tmp, "backups"));
    holder.db = dbFinto(0);
    await eseguiScript([nome]);
    expect(process.exitCode).toBe(0);
  });
});
