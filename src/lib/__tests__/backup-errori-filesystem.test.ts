import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  eseguiBackup,
  eseguiRipristino,
  TABELLE_BACKUP,
  type ClientRipristino,
  type DelegatiLettura,
  type NomeTabella,
} from "@/lib/backup";

const errori = vi.hoisted(() => ({
  nomeInvalido: false,
  nonFile: false,
  lstat: false,
  rename: false,
  rm: false,
  destinazione: "",
}));

vi.mock("fs/promises", async (importOriginal) => {
  const originale = await importOriginal<typeof import("fs/promises")>();
  return {
    ...originale,
    readdir: async (...args: Parameters<typeof originale.readdir>) => {
      const directory = String(args[0]);
      if (errori.nomeInvalido && directory.includes(".cielobuio-backup-") && directory.endsWith("uploads/s1")) {
        await originale.writeFile(path.join(directory, "imprevisto"), "file non cifrato");
        errori.nomeInvalido = false;
      }
      return Reflect.apply(originale.readdir, originale, args);
    },
    stat: async (...args: Parameters<typeof originale.stat>) => {
      if (errori.nonFile && String(args[0]).endsWith("foto.jpg.enc")) {
        return { isFile: () => false };
      }
      return Reflect.apply(originale.stat, originale, args);
    },
    lstat: async (...args: Parameters<typeof originale.lstat>) => {
      if (errori.lstat && String(args[0]) === errori.destinazione) {
        throw Object.assign(new Error("Permesso negato"), { code: "EACCES" });
      }
      return Reflect.apply(originale.lstat, originale, args);
    },
    rename: async (...args: Parameters<typeof originale.rename>) => {
      if (errori.rename && String(args[0]).includes(".cielobuio-restore-") && String(args[1]) === errori.destinazione) {
        throw new Error("Sostituzione storage fallita");
      }
      return Reflect.apply(originale.rename, originale, args);
    },
    rm: async (...args: Parameters<typeof originale.rm>) => {
      if (errori.rm && String(args[0]).includes(".cielobuio-previous-")) {
        throw new Error("Pulizia vecchio storage fallita");
      }
      return Reflect.apply(originale.rm, originale, args);
    },
  };
});

const chiave = Buffer.alloc(32, 33);
let tmp: string;
let backupDir: string;
let sorgente: string;
let destinazione: string;
const log = vi.fn();

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cielobuio-errori-fs-"));
  backupDir = path.join(tmp, "backups");
  sorgente = path.join(tmp, "sorgente");
  destinazione = path.join(tmp, "destinazione");
  Object.assign(errori, {
    nomeInvalido: false,
    nonFile: false,
    lstat: false,
    rename: false,
    rm: false,
    destinazione,
  });
  log.mockClear();
});

afterEach(async () => {
  Object.assign(errori, { nomeInvalido: false, nonFile: false, lstat: false, rename: false, rm: false });
  await rm(tmp, { recursive: true, force: true });
});

async function creaBackup(): Promise<string> {
  await mkdir(path.join(sorgente, "s1"), { recursive: true });
  await writeFile(path.join(sorgente, "s1", "foto.jpg"), "fotografia");
  const delegati = Object.fromEntries(
    TABELLE_BACKUP.map((t) => [
      t,
      {
        findMany: vi
          .fn()
          .mockResolvedValue(t === "allegato" ? [{ id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg" }] : []),
      },
    ]),
  ) as unknown as DelegatiLettura;
  return (
    await eseguiBackup({
      delegati,
      backupDir,
      uploadsDir: sorgente,
      chiave,
      ora: new Date("2026-10-29T02:00:00Z"),
      log,
    })
  ).backupPath;
}

function creaClient(): ClientRipristino {
  const lettura = Object.fromEntries(TABELLE_BACKUP.map((t) => [t, { count: vi.fn().mockResolvedValue(0) }]));
  const scrittura = Object.fromEntries(
    [...TABELLE_BACKUP, "sessione"].map((t) => [
      t,
      {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
    ]),
  );
  return {
    ...(lettura as unknown as Pick<ClientRipristino, NomeTabella>),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...scrittura, $queryRawUnsafe: vi.fn().mockResolvedValue([]) }),
    ),
  };
}

function opzioni(db: ClientRipristino, backupPath: string) {
  return { db, backupPath, uploadsDir: destinazione, chiave, force: false, log };
}

describe("errori del filesystem durante backup e ripristino", () => {
  it("non pubblica un backup se compare un file non cifrato durante la verifica", async () => {
    errori.nomeInvalido = true;
    await expect(creaBackup()).rejects.toThrow("non compatibile con il ripristino");
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("non pubblica un backup se un allegato non è più un file regolare", async () => {
    errori.nonFile = true;
    await expect(creaBackup()).rejects.toThrow("non presente sul disco");
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("non modifica il database se lstat dello storage restituisce EACCES", async () => {
    const backupPath = await creaBackup();
    const db = creaClient();
    errori.lstat = true;
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("Permesso negato");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect((await readdir(tmp)).some((n) => n.startsWith(".cielobuio-"))).toBe(false);
  });

  it("recupera lo storage precedente se la sostituzione dei file fallisce", async () => {
    const backupPath = await creaBackup();
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "precedente.txt"), "ancora presente");
    const db = creaClient();
    errori.rename = true;
    await expect(eseguiRipristino(opzioni(db, backupPath))).rejects.toThrow("Sostituzione storage fallita");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await readFile(path.join(destinazione, "precedente.txt"), "utf8")).toBe("ancora presente");
  });

  it("se il cleanup dello storage precedente fallisce segnala il residuo senza annullare il commit", async () => {
    const backupPath = await creaBackup();
    await mkdir(destinazione);
    await writeFile(path.join(destinazione, "precedente.txt"), "prima");
    const db = creaClient();
    errori.rm = true;
    await eseguiRipristino(opzioni(db, backupPath));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(destinazione, "s1", "foto.jpg"), "utf8")).toBe("fotografia");
    expect(existsSync(path.join(destinazione, "precedente.txt"))).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("directory precedente conservata"));
  });
});
