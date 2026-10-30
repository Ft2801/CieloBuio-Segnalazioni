/**
 * Copia i file statici e la directory public/ nel build standalone di
 * Next.js, in modo cross-platform (Windows, macOS, Linux).
 *
 * Usa le API fs/promises di Node.js invece di `cp -r` nel `build` script
 * di package.json, che è specifico per i sistemi POSIX.
 *
 * Uso: tsx scripts/copy-standalone.ts <radice-progetto>
 *
 * Autore: Fabio Tempera (2026)
 */

import { cp, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Percorsi usati dalla copia, relativi alla radice del progetto. */
function percorsi(radice: string) {
  return {
    standalone: path.join(radice, ".next", "standalone"),
    staticSrc: path.join(radice, ".next", "static"),
    staticDst: path.join(radice, ".next", "standalone", ".next", "static"),
    publicSrc: path.join(radice, "public"),
    publicDst: path.join(radice, ".next", "standalone", "public"),
  };
}

async function esiste(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia .next/static e public/ dentro .next/standalone.
 * Lancia un errore se il build standalone non esiste.
 */
export async function copiaStandalone(radice: string): Promise<void> {
  const p = percorsi(radice);

  // Verifica che il build standalone esista: se manca, l'esecuzione di
  // `next build` è fallita o è stata saltata, e non ha senso copiare.
  if (!existsSync(p.standalone)) {
    throw new Error(
      "Directory .next/standalone non trovata. " +
        "Esegui prima `next build` con output: 'standalone' in next.config.ts.",
    );
  }

  // Copia .next/static -> .next/standalone/.next/static
  // I file statici (chunk JS, CSS) sono referenziati dal server standalone
  // e devono essere serviti dalla stessa directory.
  if (await esiste(p.staticSrc)) {
    await mkdir(path.dirname(p.staticDst), { recursive: true });
    await cp(p.staticSrc, p.staticDst, { recursive: true });
    console.log(`[copy-standalone] Copiato .next/static in ${path.relative(radice, p.staticDst)}`);
  } else {
    console.warn("[copy-standalone] .next/static non trovato (skip). Possibile build incompleto.");
  }

  // Copia public/ -> .next/standalone/public
  // Asset statici (favicon, manifest.json, icone, service worker, ecc.).
  if (await esiste(p.publicSrc)) {
    await cp(p.publicSrc, p.publicDst, { recursive: true });
    console.log(`[copy-standalone] Copiato public/ in ${path.relative(radice, p.publicDst)}`);
  } else {
    console.warn("[copy-standalone] public/ non trovato (skip).");
  }

  console.log("[copy-standalone] Copia completata.");
}

// Esecuzione da riga di comando: il primo argomento è la radice del progetto.
const radiceCli = process.argv[2];
export const completamento: Promise<void> = (async () => {
  if (!radiceCli) {
    throw new Error("Uso: tsx scripts/copy-standalone.ts <radice-progetto>");
  }
  await copiaStandalone(path.resolve(radiceCli));
})().catch((e: unknown) => {
  console.error("[copy-standalone] Errore:", e);
  process.exitCode = 1;
});
