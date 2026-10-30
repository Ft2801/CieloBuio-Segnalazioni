import type { NextConfig } from "next";

/**
 * Configurazione Next.js dedicata alla build statica per GitHub Pages.
 *
 * Perché un file separato da next.config.ts:
 * - La build di produzione usa output "standalone" (server Node.js con
 *   API routes, Prisma, invio PEC reale, proxy di sicurezza).
 * - GitHub Pages serve solo file statici: nessun server, nessuna API
 *   route, nessun database. Serve quindi un output "export".
 * - Le due build sono target diversi con requisiti incompatibili
 *   (standalone richiede un server Node; export produce solo HTML/CSS/JS
 *   statici), motivo per cui si tengono due file di configurazione
 *   invece di un flag condizionale in un unico file.
 *
 * Cosa include questa build:
 * - Solo l'interfaccia, con gli account di accesso di prova
 *   (src/lib/demo-mode.ts): dati statici incorporati nel bundle, nessuna
 *   chiamata di rete verso API o database (vedi commenti in
 *   src/lib/demo-mode.ts e src/components/app/use-session.ts).
 * - Le API routes in src/app/api/** NON vengono incluse: con
 *   output "export" richiederebbero un server per funzionare, quindi
 *   scripts/build-pages.ts le sposta temporaneamente fuori dal progetto
 *   durante la build statica.
 *
 * NEXT_PUBLIC_BASE_PATH:
 * - GitHub Pages serve un progetto (repo diverso da <utente>.github.io)
 *   sotto un sottopercorso: https://<utente>.github.io/<nome-repo>/
 *   Va quindi impostato basePath/assetPrefix, altrimenti CSS/JS/icone
 *   non si caricano (path assoluti che puntano alla root del dominio).
 * - Se il repo è invece <utente>.github.io (Pages "utente", servito
 *   dalla root del dominio), lasciare NEXT_PUBLIC_BASE_PATH vuoto/non
 *   impostato: il workflow imposterà "" in quel caso.
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",

  // L'ottimizzazione immagini di next/image richiede un server Node in
  // esecuzione (endpoint /_next/image). Su export statico non esiste:
  // va disattivata, le immagini vengono servite così come sono.
  images: {
    unoptimized: true,
  },

  // Sottopercorso su cui GitHub Pages pubblica il progetto. Vuoto per
  // Pages "utente" (<utente>.github.io), "/<nome-repo>" per Pages
  // "progetto". Impostato dal workflow tramite variabile d'ambiente,
  // così questo file non va toccato quando cambia il nome del repo.
  basePath,
  assetPrefix: basePath || undefined,

  // Modalità demo attiva solo in questa build statica: il bundle client riceve
  // il flag come variabile NEXT_PUBLIC_*. Nel server standalone di produzione il
  // flag non esiste e gli account demo non vengono riconosciuti.
  env: {
    NEXT_PUBLIC_CIELOBUIO_DEMO: "1",
  },

  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,

  // Nessun blocco "headers" qui: su export statico gli header HTTP non
  // sono applicabili (non c'è un server Next in esecuzione che li possa
  // impostare). Gli header di sicurezza restano validi solo per la build
  // di produzione (next.config.ts + proxy.ts), che gira su un vero
  // server Node dietro Caddy/reverse proxy.
};

export default nextConfig;
