import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let app: string;
let bin: string;
let trace: string;
const script = path.resolve("scripts/deploy.sh");

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "cb-deploy-"));
  app = path.join(tmp, "app");
  bin = path.join(tmp, "bin");
  trace = path.join(tmp, "trace");
  mkdirSync(app);
  mkdirSync(bin);
  writeFileSync(path.join(app, ".env"), "");
  writeFileSync(trace, "");
  const programmi: Record<string, string> = {
    git: 'case "$1" in branch) printf "%s\\n" "${TEST_BRANCH:-main}" ;; status) printf "%s" "${TEST_DIRTY:-}" ;; pull) printf "pull\\n" >> "$TEST_TRACE" ;; esac',
    sudo: 'if [ "$2" = "-l" ]; then exit 0; fi; printf "%s\\n" "$*" >> "$TEST_TRACE"',
    systemctl: "exit 0",
    npm: 'printf "%s\\n" "$*" >> "$TEST_TRACE"; if [ "$*" = "${TEST_FAIL:-impossibile}" ]; then exit 1; fi',
    npx: 'printf "%s\\n" "$*" >> "$TEST_TRACE"',
    curl: 'printf "curl %s\\n" "$*" >> "$TEST_TRACE"; printf \'{"status":"ok"}\'',
    sleep: "exit 0",
  };
  for (const [nome, contenuto] of Object.entries(programmi)) {
    writeFileSync(path.join(bin, nome), `#!/usr/bin/env bash\nset -eu\n${contenuto}\n`, { mode: 0o755 });
  }
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function avvia(args: string[] = [], extra: Record<string, string | undefined> = {}) {
  return () =>
    execFileSync("bash", [script, ...args], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CIELOBUIO_APP_DIR: app,
        CIELOBUIO_SERVICE: "cb-test",
        TEST_TRACE: trace,
        ...extra,
      },
      stdio: "pipe",
    });
}
const eventi = () => readFileSync(trace, "utf8").trim().split("\n").filter(Boolean);

describe("deploy con manutenzione coerente", () => {
  it("ferma il servizio prima del backup e costruisce prima di migrare", () => {
    avvia()();
    expect(eventi().slice(0, 7)).toEqual([
      "-n systemctl stop cb-test",
      "run db:backup",
      "pull",
      "ci",
      "run build",
      "prisma migrate deploy",
      "-n systemctl start cb-test",
    ]);
  });
  it("un backup fallito riavvia il servizio senza pull o migrazioni, anche con FORCE_DEPLOY", () => {
    expect(avvia([], { TEST_FAIL: "run db:backup", FORCE_DEPLOY: "1" })).toThrow();
    expect(eventi()).toEqual(["-n systemctl stop cb-test", "run db:backup", "-n systemctl start cb-test"]);
  });
  it("una build fallita non avvia migrazioni e riavvia il servizio", () => {
    expect(avvia([], { TEST_FAIL: "run build" })).toThrow();
    expect(eventi()).not.toContain("prisma migrate deploy");
    expect(eventi().at(-1)).toBe("-n systemctl start cb-test");
  });
  it.each([
    { args: ["inesistente"], extra: {} },
    { args: ["staging"], extra: {} },
    { args: [], extra: { TEST_BRANCH: "altro" } },
    { args: [], extra: { TEST_DIRTY: " M file.ts" } },
  ])("un prerequisito non soddisfatto non ferma il servizio: $args $extra", ({ args, extra }) => {
    expect(avvia(args, extra)).toThrow();
    expect(eventi()).toEqual([]);
  });
  it("staging usa la propria unità e il proprio health check", () => {
    avvia(["staging"], { CIELOBUIO_SERVICE: "cb-staging", CIELOBUIO_HEALTH_URL: "http://localhost:3001/api/health" })();
    expect(eventi()[0]).toBe("-n systemctl stop cb-staging");
    expect(eventi().at(-1)).toContain("http://localhost:3001/api/health");
  });
});
