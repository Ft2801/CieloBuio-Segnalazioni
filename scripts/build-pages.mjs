#!/usr/bin/env node
/**
 * Build statica per GitHub Pages.
 *
 * Next.js legge sempre next.config.ts dalla root del progetto (non
 * esiste un flag CLI --config) e, con output "export", pretende che
 * OGNI route in src/app/api sia compatibile con l'export statico
 * (dichiari "force-static"/revalidate). Le route di questo progetto
 * sono tutte dinamiche per natura (DB, upload, invio PEC) e vanno
 * escluse dalla build della demo, non riscritte: la build di
 * produzione (server Node reale) deve restare invariata.
 *
 * Per tenere due configurazioni/alberi di file separati senza
 * duplicare il codice sorgente, questo script:
 *
 *   1. salva da parte l'attuale next.config.ts (quello di produzione,
 *      output "standalone");
 *   2. copia al suo posto next.config.pages.ts (output "export");
 *   3. sposta temporaneamente src/app/api in una cartella temporanea
 *      di sistema, FUORI dalla root del progetto (tsconfig.json include
 *      "**\/*.ts" a partire dalla root: una cartella "nascosta" ma
 *      ancora dentro la root verrebbe comunque scansionata da
 *      TypeScript durante la build, con lo stesso errore);
 *   4. lancia "next build";
 *   5. ripristina SEMPRE config e cartella API alla fine, anche se la
 *      build fallisce (blocco finally), così il repository resta
 *      pulito e "npm run build" di produzione non risente in alcun
 *      modo di questo passaggio.
 *
 * Uso:
 *   node scripts/build-pages.mjs
 *   NEXT_PUBLIC_BASE_PATH="/nome-repo" node scripts/build-pages.mjs
 *
 * Output: cartella out/ con i file statici pronti per essere pubblicati
 * (questo è ciò che il workflow GitHub Actions carica su Pages).
 *
 * Autore: script di supporto aggiunto per il deploy demo su GitHub Pages.
 */

import { existsSync, copyFileSync, rmSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prodConfig = path.join(root, "next.config.ts");
const pagesConfig = path.join(root, "next.config.pages.ts");
const backupConfig = path.join(root, "next.config.ts.bak");

const apiDir = path.join(root, "src", "app", "api");
// Fuori dalla root del progetto (non dentro root/qualcosa): tsconfig.json
// include "**/*.ts" a partire dalla root, quindi una cartella spostata
// altrove DENTRO la root verrebbe comunque scansionata da TypeScript.
// os.tmpdir() è sempre fuori dalla root del repository.
const apiDirBackup = path.join(
  os.tmpdir(),
  `cielobuio-api-excluded-${process.pid}`
);

if (!existsSync(pagesConfig)) {
  console.error("Errore: next.config.pages.ts non trovato nella root del progetto.");
  process.exit(1);
}

// Pulisce un eventuale output precedente, per evitare file residui di
// build vecchie.
const outDir = path.join(root, "out");
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

let configSwapped = false;
let apiMoved = false;

try {
  copyFileSync(prodConfig, backupConfig);
  copyFileSync(pagesConfig, prodConfig);
  configSwapped = true;

  if (existsSync(apiDir)) {
    renameSync(apiDir, apiDirBackup);
    apiMoved = true;
    console.log("→ src/app/api escluso temporaneamente dalla build statica.");
  }

  console.log("→ Build statica in corso (output: export)...");
  execSync("npx next build", { stdio: "inherit", cwd: root });

  console.log(`\nOK Build completata. File statici pronti in: ${outDir}`);
} finally {
  if (apiMoved && existsSync(apiDirBackup)) {
    renameSync(apiDirBackup, apiDir);
    console.log("→ src/app/api ripristinato.");
  }
  if (configSwapped && existsSync(backupConfig)) {
    copyFileSync(backupConfig, prodConfig);
    rmSync(backupConfig);
    console.log("→ next.config.ts di produzione ripristinato.");
  }
}
