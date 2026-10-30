import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { headers } from "next/headers";
import { SCRIPT_TEMA_INIZIALE } from "@/lib/tema";
import localFont from "next/font/local";

// Inter autoospitata (licenza SIL OFL 1.1, vedi src/fonts/inter/LICENSE.txt):
// nessuna richiesta a server esterni, compatibile con font-src 'self'.
const inter = localFont({
  src: [
    { path: "../fonts/inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/inter/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "CieloBuio, segnalazioni impianti non conformi",
  description:
    "Sistema di segnalazione PEC di impianti di illuminazione non conformi alle leggi regionali sull'inquinamento luminoso. Piattaforma di CieloBuio, Coordinamento per la protezione del cielo notturno.",
  // Percorso relativo: funziona sia alla radice del server sia quando la
  // demo statica è pubblicata sotto /<nome-repo>/ su GitHub Pages.
  manifest: "./manifest.json",
  keywords: ["CieloBuio", "inquinamento luminoso", "PEC", "segnalazione", "illuminazione"],
  authors: [{ name: "Fabio Tempera", url: "https://ft2801.github.io/Portfolio" }],
  appleWebApp: {
    capable: true,
    // black-translucent dà un aspetto più native su iOS quando installata
    // come PWA, allineando il colore della status bar al brand indigo.
    statusBarStyle: "black-translucent",
    title: "CieloBuio",
  },
};

export const viewport: Viewport = {
  // Allineato al background_color del manifest per coerenza visiva
  // durante l'avvio (splash screen) e su iOS quando installata.
  themeColor: "#2a2d5f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Leggere gli header a runtime rende la pagina dinamica: il nonce CSP generato
  // dal proxy viene così applicato agli script di Next.js e allo script del
  // service worker. Senza nonce (sviluppo) l'attributo viene omesso.
  // Nella build statica per GitHub Pages (CIELOBUIO_BUILD_STATICO=1, impostata da
  // scripts/build-pages.ts) non esistono richieste né proxy: headers() non è
  // ammesso in export statico e il nonce resta assente.
  const nonce =
    process.env.CIELOBUIO_BUILD_STATICO === "1" ? undefined : ((await headers()).get("x-nonce") ?? undefined);
  return (
    <html lang="it" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Tema scuro/chiaro applicato prima del primo rendering (vedi src/lib/tema.ts).
            Script inline e sincrono: il nonce CSP lo autorizza senza 'unsafe-inline'. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INIZIALE }} />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
        {/* Service worker registration come script esterno (no dangerouslySetInnerHTML) */}
        <script src="./sw-register.js" defer nonce={nonce} />
      </body>
    </html>
  );
}
