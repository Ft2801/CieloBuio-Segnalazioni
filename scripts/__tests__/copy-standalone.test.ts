/**
 * Copertura dello script copy-standalone: copia di .next/static e public/
 * nel build standalone, avvisi per le directory mancanti, errore se il
 * build standalone non esiste, uscita con errore senza argomento.
 * Lavora su directory temporanee reali.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let radice: string;
let argvOriginale: string[];

function creaStandalone(): void {
  fs.mkdirSync(path.join(radice, ".next", "standalone"), { recursive: true });
}

function creaStatic(): void {
  fs.mkdirSync(path.join(radice, ".next", "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(radice, ".next", "static", "chunks", "app.js"), "console.log(1);");
}

function creaPublic(): void {
  fs.mkdirSync(path.join(radice, "public"), { recursive: true });
  fs.writeFileSync(path.join(radice, "public", "robots.txt"), "<svg></svg>");
}

/** Importa lo script con gli argomenti indicati ed attende la sua esecuzione. */
async function eseguiScript(argomenti: string[]) {
  process.argv = ["node", "copy-standalone.ts", ...argomenti];
  vi.resetModules();
  const modulo = await import("../copy-standalone");
  await modulo.completamento;
  return modulo;
}

beforeEach(() => {
  radice = fs.mkdtempSync(path.join(os.tmpdir(), "cielobuio-copy-standalone-"));
  argvOriginale = process.argv;
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = argvOriginale;
  process.exitCode = undefined;
  fs.rmSync(radice, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("copy-standalone", () => {
  it("copia .next/static e public/ nel build standalone", async () => {
    creaStandalone();
    creaStatic();
    creaPublic();
    await eseguiScript([radice]);
    expect(fs.existsSync(path.join(radice, ".next", "standalone", ".next", "static", "chunks", "app.js"))).toBe(true);
    expect(fs.existsSync(path.join(radice, ".next", "standalone", "public", "robots.txt"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith("[copy-standalone] Copia completata.");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("avvisa e prosegue quando .next/static manca", async () => {
    creaStandalone();
    creaPublic();
    await eseguiScript([radice]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(".next/static non trovato"));
    expect(fs.existsSync(path.join(radice, ".next", "standalone", "public", "robots.txt"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("avvisa e prosegue quando public/ manca", async () => {
    creaStandalone();
    creaStatic();
    await eseguiScript([radice]);
    expect(console.warn).toHaveBeenCalledWith("[copy-standalone] public/ non trovato (skip).");
    expect(fs.existsSync(path.join(radice, ".next", "standalone", ".next", "static", "chunks", "app.js"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("termina con errore se il build standalone non esiste", async () => {
    creaStatic();
    await eseguiScript([radice]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "[copy-standalone] Errore:",
      expect.objectContaining({ message: expect.stringContaining("next build") }),
    );
  });

  it("termina con errore se manca l'argomento della radice", async () => {
    await eseguiScript([]);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "[copy-standalone] Errore:",
      expect.objectContaining({ message: expect.stringContaining("Uso:") }),
    );
  });
});
