#!/usr/bin/env node
/**
 * Copia i file statici e la directory public/ nel build standalone di
 * Next.js, in modo cross-platform (Windows, macOS, Linux).
 *
 * Sostituisce la precedente pipeline `cp -r` nel `build` script di
 * package.json che era POSIX-only e falliva su Windows. Usa le API
 * fs/promises di Node.js per portabilità.
 *
 * Autore: Fabio Tempera (2026)
 */

import { cp, mkdir, access } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const STATIC_SRC = path.join(projectRoot, ".next", "static");
const STATIC_DST = path.join(projectRoot, ".next", "standalone", ".next", "static");
const PUBLIC_SRC = path.join(projectRoot, "public");
const PUBLIC_DST = path.join(projectRoot, ".next", "standalone", "public");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Verifica che il build standalone esista: se manca, l'esecuzione di
  // `next build` è fallita o è stata saltata, e non ha senso copiare.
  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  if (!existsSync(standaloneDir)) {
    console.error(
      "[copy-standalone] Directory .next/standalone non trovata. " +
        "Esegui prima `next build` con output: 'standalone' in next.config.ts."
    );
    process.exit(1);
  }

  // Copia .next/static -> .next/standalone/.next/static
  // I file statici (chunk JS, CSS) sono referenziati dal server standalone
  // e devono essere serviti dalla stessa directory.
  if (await exists(STATIC_SRC)) {
    await mkdir(path.dirname(STATIC_DST), { recursive: true });
    await cp(STATIC_SRC, STATIC_DST, { recursive: true });
    console.log(`[copy-standalone] Copiato .next/static in ${path.relative(projectRoot, STATIC_DST)}`);
  } else {
    console.warn("[copy-standalone] .next/static non trovato (skip). Possibile build incompleto.");
  }

  // Copia public/ -> .next/standalone/public
  // Asset statici (favicon, manifest.json, icone, service worker, ecc.).
  if (await exists(PUBLIC_SRC)) {
    await cp(PUBLIC_SRC, PUBLIC_DST, { recursive: true });
    console.log(`[copy-standalone] Copiato public/ in ${path.relative(projectRoot, PUBLIC_DST)}`);
  } else {
    console.warn("[copy-standalone] public/ non trovato (skip).");
  }

  console.log("[copy-standalone] Copia completata.");
}

main().catch((e) => {
  console.error("[copy-standalone] Errore:", e);
  process.exit(1);
});
