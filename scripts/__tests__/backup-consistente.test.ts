import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const script = path.resolve(process.cwd(), "scripts/backup-consistente.sh");
let tmp: string;
let bin: string;
let app: string;
let logFile: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cielobuio-backup-shell-"));
  bin = path.join(tmp, "bin");
  app = path.join(tmp, "app");
  logFile = path.join(tmp, "commands.log");
  await mkdir(bin);
  await mkdir(app);
  await writeFile(
    path.join(bin, "systemctl"),
    '#!/bin/sh\nprintf "systemctl %s\\n" "$1" >> "$CIELOBUIO_TEST_LOG"\n' +
      '[ "$1" != "is-active" ] || [ "${CIELOBUIO_TEST_INACTIVE:-0}" != "1" ] || exit 1\n' +
      '[ "$1" != "start" ] || [ "${CIELOBUIO_TEST_START_FAIL:-0}" != "1" ] || exit 1\n',
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "runuser"),
    '#!/bin/sh\nprintf "runuser %s\\n" "$*" >> "$CIELOBUIO_TEST_LOG"\n' +
      '[ "${CIELOBUIO_TEST_BACKUP_FAIL:-0}" != "1" ]\n',
    { mode: 0o755 },
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function esegui(variabili: Record<string, string> = {}) {
  return spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CIELOBUIO_APP_DIR: app,
      CIELOBUIO_TEST_LOG: logFile,
      ...variabili,
    },
  });
}

async function comandi(): Promise<string[]> {
  return (await readFile(logFile, "utf8")).trim().split("\n");
}

describe("backup coerente con servizio systemd", () => {
  it("ferma il servizio, esegue il backup come utente applicativo e riavvia", async () => {
    const risultato = esegui();
    expect(risultato.status).toBe(0);
    expect(await comandi()).toEqual([
      "systemctl is-active",
      "systemctl stop",
      "runuser -u www-data -- npm run db:backup",
      "systemctl start",
    ]);
  });

  it("riavvia il servizio anche se il backup fallisce e restituisce errore", async () => {
    const risultato = esegui({ CIELOBUIO_TEST_BACKUP_FAIL: "1" });
    expect(risultato.status).toBe(1);
    expect(await comandi()).toEqual([
      "systemctl is-active",
      "systemctl stop",
      "runuser -u www-data -- npm run db:backup",
      "systemctl start",
    ]);
  });

  it("non avvia il servizio né esegue il backup se era già fermo", async () => {
    const risultato = esegui({ CIELOBUIO_TEST_INACTIVE: "1" });
    expect(risultato.status).toBe(1);
    expect(await comandi()).toEqual(["systemctl is-active"]);
  });

  it("se il riavvio fallisce restituisce errore e segnala l'intervento necessario", async () => {
    const risultato = esegui({ CIELOBUIO_TEST_START_FAIL: "1" });
    expect(risultato.status).toBe(1);
    expect(risultato.stderr).toContain("Intervento immediato necessario");
    expect((await comandi()).at(-1)).toBe("systemctl start");
  });

  it("rifiuta una directory applicativa inesistente senza fermare il servizio", () => {
    const risultato = esegui({ CIELOBUIO_APP_DIR: path.join(tmp, "assente") });
    expect(risultato.status).toBe(1);
    expect(risultato.stderr).toContain("Directory applicativa non trovata");
  });
});
