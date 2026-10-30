/**
 * Build statica per GitHub Pages.
 *
 * Next.js legge sempre next.config.ts dalla root del progetto (non
 * esiste un flag CLI --config) e, con output "export", pretende che
 * OGNI route in src/app/api sia compatibile con l'export statico
 * (dichiari "force-static"/revalidate). Le route di questo progetto
 * sono tutte dinamiche per natura (DB, upload, invio PEC) e vanno
 * escluse dalla build statica, non riscritte: la build di
 * produzione (server Node reale) deve restare invariata.
 *
 * Per lo stesso motivo non possono restare nella build statica i test
 * che importano le route API (src/__tests__ e integration): anche i file di test sono
 * compilati dal typecheck di `next build`, e non fanno parte del sito.
 *
 * Per lo stesso motivo non può restare nella build statica il proxy di
 * sicurezza (src/proxy.ts): in un export statico non viene eseguito e non
 * può impostare gli header HTTP (su GitHub Pages non sono configurabili).
 * Next.js lo segnalerebbe con un avviso (export statico con middleware),
 * quindi viene escluso con la stessa procedura delle route API.
 *
 * Per tenere due configurazioni/alberi di file separati senza
 * duplicare il codice sorgente, questo script:
 *
 *   1. salva da parte l'attuale next.config.ts (quello di produzione,
 *      output "standalone");
 *   2. copia al suo posto next.config.pages.ts (output "export");
 *   3. sposta temporaneamente le directory escluse (src/app/api e
 *      src/__tests__) in una cartella temporanea di sistema, FUORI dalla
 *      root del progetto (tsconfig.json include "**\/*.ts" a partire dalla
 *      root: una cartella "nascosta" ma ancora dentro la root verrebbe
 *      comunque scansionata da TypeScript durante la build, con lo stesso
 *      errore). Lo spostamento è una copia seguita dalla rimozione
 *      dell'originale, perché os.tmpdir() può trovarsi su un filesystem
 *      diverso dal progetto (rename fallirebbe con EXDEV);
 *   4. lancia "next build";
 *   5. ripristina SEMPRE config e directory escluse alla fine, anche se la
 *      build fallisce (blocco finally), così il repository resta
 *      pulito e "npm run build" di produzione non risente in alcun
 *      modo di questo passaggio.
 *
 * Uso:
 *   tsx scripts/build-pages.ts .
 *   NEXT_PUBLIC_BASE_PATH="/nome-repo" tsx scripts/build-pages.ts .
 *
 * Output: cartella out/ con i file statici pronti per essere pubblicati
 * (questo è ciò che il workflow GitHub Actions carica su Pages).
 *
 * Autore: Fabio Tempera (2026)
 */

import { existsSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

/** Percorso (directory o file) escluso dalla build statica. */
interface DirectoryEsclusa {
  nome: string;
  origine: string;
}

/** Percorso escluso effettivamente spostato: origine e copia temporanea. */
interface Spostata {
  origine: string;
  copia: string;
}

/**
 * Esegue la build statica sulla radice indicata. In caso di errore la
 * configurazione e le directory escluse vengono comunque ripristinate.
 */
export function buildStatica(radiceProgetto: string): void {
  const root = radiceProgetto;
  const prodConfig = path.join(root, "next.config.ts");
  const pagesConfig = path.join(root, "next.config.pages.ts");
  const backupConfig = path.join(root, "next.config.ts.bak");

  // Percorsi (directory o file) esclusi dalla build statica. Ciascuno viene
  // copiato in una cartella temporanea fuori dalla root del progetto (vedi
  // punto 3 sopra).
  const DIRECTORY_ESCLUSE: DirectoryEsclusa[] = [
    { nome: "src/app/api", origine: path.join(root, "src", "app", "api") },
    { nome: "src/__tests__", origine: path.join(root, "src", "__tests__") },
    { nome: "integration", origine: path.join(root, "integration") },
    { nome: "src/proxy.ts", origine: path.join(root, "src", "proxy.ts") },
  ];

  if (!existsSync(pagesConfig)) {
    throw new Error("next.config.pages.ts non trovato nella root del progetto.");
  }

  // Pulisce un eventuale output precedente, per evitare file residui di
  // build vecchie.
  const outDir = path.join(root, "out");
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  let configSwapped = false;
  // Directory effettivamente spostate: { origine, copia }.
  const spostate: Spostata[] = [];

  try {
    copyFileSync(prodConfig, backupConfig);
    copyFileSync(pagesConfig, prodConfig);
    configSwapped = true;

    DIRECTORY_ESCLUSE.forEach((dir, indice) => {
      if (!existsSync(dir.origine)) return;
      // os.tmpdir() è sempre fuori dalla root del repository.
      const copia = path.join(os.tmpdir(), `cielobuio-excluded-${process.pid}-${indice}`);
      // Copia prima, poi rimozione: se la copia fallisce, l'originale è intatto.
      cpSync(dir.origine, copia, { recursive: true });
      spostate.push({ origine: dir.origine, copia });
      rmSync(dir.origine, { recursive: true, force: true });
      console.log(`→ ${dir.nome} escluso temporaneamente dalla build statica.`);
    });

    // Il typecheck di Next include anche .next/dev/types/**/*.ts. Se il
    // progetto è stato avviato con `next dev`, quei tipi contengono import
    // delle API ora escluse e fanno fallire la build statica. Sono artefatti
    // generati: si possono rimuovere senza toccare il sorgente o la build
    // standalone. Il successivo avvio in sviluppo li ricrea automaticamente.
    const tipiDevObsoleti = path.join(root, ".next", "dev", "types");
    if (existsSync(tipiDevObsoleti)) {
      rmSync(tipiDevObsoleti, { recursive: true, force: true });
      console.log("→ Tipi obsoleti della build di sviluppo rimossi.");
    }

    console.log("→ Build statica in corso (output: export)...");
    // CIELOBUIO_BUILD_STATICO indica al layout che non c'è un proxy né un server
    // che generi il nonce CSP (vedi src/app/layout.tsx).
    execSync("npx next build", {
      stdio: "inherit",
      cwd: root,
      timeout: 600000,
      env: { ...process.env, CIELOBUIO_BUILD_STATICO: "1" },
    });

    console.log(`\nOK Build completata. File statici pronti in: ${outDir}`);
  } finally {
    // Ripristino in ordine inverso allo spostamento. Ogni copia registrata in
    // "spostate" è stata creata con successo, quindi esiste sempre.
    for (const { origine, copia } of spostate.reverse()) {
      cpSync(copia, origine, { recursive: true });
      rmSync(copia, { recursive: true, force: true });
      console.log(`→ ${path.relative(root, origine)} ripristinato.`);
    }
    if (configSwapped) {
      copyFileSync(backupConfig, prodConfig);
      rmSync(backupConfig);
      console.log("→ next.config.ts di produzione ripristinato.");
    }
  }
}

// Esecuzione da riga di comando: il primo argomento è la radice del progetto.
const radiceCli = process.argv[2];
export const completamento: Promise<void> = (async () => {
  if (!radiceCli) {
    throw new Error("Uso: tsx scripts/build-pages.ts <radice-progetto>");
  }
  buildStatica(path.resolve(radiceCli));
})().catch((e: unknown) => {
  console.error("Errore durante la build statica:", e);
  process.exitCode = 1;
});
