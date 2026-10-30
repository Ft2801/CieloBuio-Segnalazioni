/**
 * Test della CLI di backup (scripts/backup-db.ts) con client Prisma finto.
 * Lo script esegue la propria logica all'import: ogni scenario ricarica il modulo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from "fs/promises";
import { decifra } from "@/lib/backup";
import os from "os";
import path from "path";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../src/lib/prisma-client", () => ({
  createPrismaClient: () => holder.db,
}));

function dbFinto(findManyUtenti: () => Promise<unknown[]>) {
  const tabella = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  return {
    regioneLegge: tabella(),
    provincia: tabella(),
    comune: tabella(),
    user: { findMany: vi.fn(findManyUtenti) },
    segnalazione: tabella(),
    allegato: tabella(),
    storicoStato: tabella(),
    logInvioPec: tabella(),
    auditLog: tabella(),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

async function eseguiScript(): Promise<void> {
  vi.resetModules();
  await import("../backup-db");
  await vi.waitFor(() => expect(holder.db).not.toBeNull());
  await vi.waitFor(() => {
    expect((holder.db as { $disconnect: () => unknown }).$disconnect).toHaveBeenCalled();
  });
  await new Promise((r) => setTimeout(r, 0));
}

let tmp: string;
let errori: unknown[];
let messaggi: string[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cb-cli-backup-"));
  errori = [];
  messaggi = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errori.push(a);
  });
  vi.spyOn(console, "log").mockImplementation((m: unknown) => {
    messaggi.push(String(m));
  });
  process.exitCode = 0;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_DIR;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_DIR;
  delete process.env.STORAGE_ROOT;
  delete process.env.DOTENV_CONFIG_PATH;
  await rm(tmp, { recursive: true, force: true });
});

describe("CLI backup-db", () => {
  it("senza BACKUP_ENCRYPTION_KEY termina con errore e non crea nulla", async () => {
    holder.db = dbFinto(async () => []);
    process.env.BACKUP_DIR = path.join(tmp, "backups");
    await eseguiScript();
    expect(process.exitCode).toBe(1);
    expect(errori.flat().join(" ")).toContain("BACKUP_ENCRYPTION_KEY non impostata");
    expect(await readdir(tmp)).toEqual([]);
  });

  it("con chiave valida crea il backup nella BACKUP_DIR indicata", async () => {
    holder.db = dbFinto(async () => [{ id: "u1", passwordHash: "h" }]);
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.BACKUP_DIR = path.join(tmp, "backups");
    await eseguiScript();
    expect(process.exitCode).toBe(0);
    const [nome] = await readdir(path.join(tmp, "backups"));
    expect(nome).toMatch(/^backup-\d{8}-\d{6}$/);
    expect(messaggi.some((m) => m.includes("Backup salvato in"))).toBe(true);
  });

  it("senza BACKUP_DIR usa la cartella backups nella directory di lavoro", async () => {
    holder.db = dbFinto(async () => []);
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
    await eseguiScript();
    expect(process.exitCode).toBe(0);
    expect(await readdir(path.join(tmp, "backups"))).toHaveLength(1);
  });

  it("legge chiave e percorso backup dal file di ambiente della CLI", async () => {
    const fileEnv = path.join(tmp, "ambiente.env");
    const dest = path.join(tmp, "archivi");
    await writeFile(fileEnv, `BACKUP_ENCRYPTION_KEY=${Buffer.alloc(32, 3).toString("base64")}\nBACKUP_DIR=${dest}\n`);
    process.env.DOTENV_CONFIG_PATH = fileEnv;
    holder.db = dbFinto(async () => []);
    await eseguiScript();
    expect(process.exitCode, JSON.stringify(errori)).toBe(0);
    expect(await readdir(dest)).toHaveLength(1);
  });

  it("cifra gli allegati della directory STORAGE_ROOT configurata", async () => {
    const root = path.join(tmp, "allegati-configurati");
    await mkdir(path.join(root, "s1"), { recursive: true });
    await writeFile(path.join(root, "s1", "foto.jpg"), "immagine personalizzata");
    process.env.STORAGE_ROOT = root;
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.BACKUP_DIR = path.join(tmp, "backups");
    const db = dbFinto(async () => []);
    db.allegato.findMany.mockResolvedValue([{ id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg" }]);
    holder.db = db;
    await eseguiScript();
    expect(process.exitCode).toBe(0);
    const [nome] = await readdir(path.join(tmp, "backups"));
    const file = await readFile(path.join(tmp, "backups", nome, "uploads", "s1", "foto.jpg.enc"));
    expect(decifra(file, Buffer.alloc(32, 3)).toString()).toBe("immagine personalizzata");
  });

  it("un errore imprevisto del database termina con codice 1 e lo stampa", async () => {
    holder.db = dbFinto(async () => {
      throw new Error("connessione persa");
    });
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.BACKUP_DIR = path.join(tmp, "backups");
    await eseguiScript();
    expect(process.exitCode).toBe(1);
    expect(errori.flat().some((e) => e instanceof Error && e.message === "connessione persa")).toBe(true);
  });
});
