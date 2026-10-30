/**
 * Copertura dello script build-pages: scambio della configurazione,
 * esclusione e ripristino delle directory dalla build statica, ripristino
 * anche in caso di errore, errori di configurazione mancante.
 * Il comando next build è simulato (execSync); tutto il resto lavora
 * su una directory di progetto temporanea reale.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

const CONFIG_PRODUZIONE = "export default { output: 'standalone' };\n";
const CONFIG_PAGES = "export default { output: 'export' };\n";

let radice: string;
let argvOriginale: string[];

function scrivi(relativo: string, contenuto: string): void {
  const completo = path.join(radice, relativo);
  fs.mkdirSync(path.dirname(completo), { recursive: true });
  fs.writeFileSync(completo, contenuto);
}

/** Crea un progetto con la configurazione di produzione, le config pages e le directory escluse. */
function creaProgetto(opzioni: { prodConfig?: boolean; pagesConfig?: boolean; escluse?: boolean } = {}): void {
  const { prodConfig = true, pagesConfig = true, escluse = true } = opzioni;
  if (prodConfig) scrivi("next.config.ts", CONFIG_PRODUZIONE);
  if (pagesConfig) scrivi("next.config.pages.ts", CONFIG_PAGES);
  scrivi("src/app/layout.tsx", "export default function Layout() {}");
  if (escluse) {
    scrivi("src/app/api/segnalazioni/route.ts", "export async function GET() {}");
    scrivi("src/__tests__/security.test.ts", "test('x', () => {});");
    scrivi("integration/flussi-postgresql.test.ts", "test('postgresql', () => {});");
    scrivi("src/proxy.ts", "export function proxy() {}");
  }
}

/** Esegue lo script sulla radice indicata e attende la sua conclusione. */
async function eseguiScript(argomenti: string[]) {
  process.argv = ["node", "build-pages.ts", ...argomenti];
  vi.resetModules();
  const modulo = await import("../build-pages");
  await modulo.completamento;
  return modulo;
}

/** Simula `next build` che produce out/index.html. */
function simulaBuildRiuscita(): void {
  vi.mocked(execSync).mockImplementation(() => {
    scrivi("out/index.html", "<html></html>");
    return Buffer.from("");
  });
}

beforeEach(() => {
  radice = fs.mkdtempSync(path.join(os.tmpdir(), "cielobuio-build-pages-"));
  argvOriginale = process.argv;
  process.exitCode = undefined;
  vi.mocked(execSync).mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = argvOriginale;
  process.exitCode = undefined;
  fs.rmSync(radice, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("build-pages", () => {
  it("costruisce con la config pages, esclude le directory e le ripristina", async () => {
    creaProgetto();
    let configDuranteBuild = "";
    let apiPresenteDuranteBuild = true;
    let variabileDuranteBuild: string | undefined;
    vi.mocked(execSync).mockImplementation((_comando, opzioni) => {
      configDuranteBuild = fs.readFileSync(path.join(radice, "next.config.ts"), "utf-8");
      expect(fs.existsSync(path.join(radice, "integration"))).toBe(false);
      apiPresenteDuranteBuild = fs.existsSync(path.join(radice, "src", "app", "api"));
      variabileDuranteBuild = (opzioni as { env: NodeJS.ProcessEnv }).env.CIELOBUIO_BUILD_STATICO;
      scrivi("out/index.html", "<html></html>");
      return Buffer.from("");
    });

    await eseguiScript([radice]);

    expect(configDuranteBuild).toBe(CONFIG_PAGES);
    expect(apiPresenteDuranteBuild).toBe(false);
    expect(variabileDuranteBuild).toBe("1");
    expect(process.exitCode).toBeUndefined();
    // Ripristino completo: config di produzione, directory escluse e nessun file di servizio.
    expect(fs.readFileSync(path.join(radice, "next.config.ts"), "utf-8")).toBe(CONFIG_PRODUZIONE);
    expect(fs.existsSync(path.join(radice, "next.config.ts.bak"))).toBe(false);
    expect(fs.readFileSync(path.join(radice, "src", "app", "api", "segnalazioni", "route.ts"), "utf-8")).toContain(
      "GET",
    );
    expect(fs.existsSync(path.join(radice, "src", "__tests__", "security.test.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "src", "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "integration", "flussi-postgresql.test.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "out", "index.html"))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("OK Build completata"));
  });

  it("rimuove i tipi delle API lasciati da next dev prima della build statica", async () => {
    creaProgetto();
    scrivi(".next/dev/types/validator.ts", "import '../../../src/app/api/segnalazioni/route.js';");
    vi.mocked(execSync).mockImplementation(() => {
      expect(fs.existsSync(path.join(radice, ".next", "dev", "types", "validator.ts"))).toBe(false);
      expect(fs.existsSync(path.join(radice, "src", "app", "api"))).toBe(false);
      scrivi("out/index.html", "<html></html>");
      return Buffer.from("");
    });

    await eseguiScript([radice]);
    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(radice, "src", "app", "api", "segnalazioni", "route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "out", "index.html"))).toBe(true);
  });

  it("rimuove l'output precedente prima della nuova build", async () => {
    creaProgetto();
    scrivi("out/vecchio.html", "obsoleto");
    simulaBuildRiuscita();
    await eseguiScript([radice]);
    expect(fs.existsSync(path.join(radice, "out", "vecchio.html"))).toBe(false);
    expect(fs.existsSync(path.join(radice, "out", "index.html"))).toBe(true);
  });

  it("salta le directory escluse che non esistono", async () => {
    creaProgetto({ escluse: false });
    simulaBuildRiuscita();
    await eseguiScript([radice]);
    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(radice, "src", "app", "layout.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "src", "app", "api"))).toBe(false);
  });

  it("ripristina tutto anche se next build fallisce", async () => {
    creaProgetto();
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("build fallita");
    });
    await eseguiScript([radice]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "Errore durante la build statica:",
      expect.objectContaining({ message: "build fallita" }),
    );
    expect(fs.readFileSync(path.join(radice, "next.config.ts"), "utf-8")).toBe(CONFIG_PRODUZIONE);
    expect(fs.existsSync(path.join(radice, "next.config.ts.bak"))).toBe(false);
    expect(fs.existsSync(path.join(radice, "src", "app", "api", "segnalazioni", "route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "src", "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(radice, "integration", "flussi-postgresql.test.ts"))).toBe(true);
  });

  it("non tocca il progetto se manca next.config.pages.ts", async () => {
    creaProgetto({ pagesConfig: false });
    await eseguiScript([radice]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "Errore durante la build statica:",
      expect.objectContaining({ message: expect.stringContaining("next.config.pages.ts non trovato") }),
    );
    expect(execSync).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(radice, "next.config.ts"), "utf-8")).toBe(CONFIG_PRODUZIONE);
    expect(fs.existsSync(path.join(radice, "src", "app", "api"))).toBe(true);
  });

  it("termina con errore senza backup se manca next.config.ts", async () => {
    creaProgetto({ prodConfig: false });
    await eseguiScript([radice]);
    expect(process.exitCode).toBe(1);
    expect(execSync).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(radice, "next.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(radice, "next.config.ts.bak"))).toBe(false);
    expect(fs.existsSync(path.join(radice, "src", "app", "api"))).toBe(true);
  });

  it("termina con errore se manca l'argomento della radice", async () => {
    await eseguiScript([]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "Errore durante la build statica:",
      expect.objectContaining({ message: expect.stringContaining("Uso:") }),
    );
  });
});
