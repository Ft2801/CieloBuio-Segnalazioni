import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "CieloBuio, segnalazioni impianti non conformi",
  description:
    "Sistema di segnalazione PEC di impianti di illuminazione non conformi alle leggi regionali sull'inquinamento luminoso. Piattaforma di CieloBuio, Coordinamento per la protezione del cielo notturno.",
  manifest: "/manifest.json",
  keywords: [
    "CieloBuio",
    "inquinamento luminoso",
    "PEC",
    "segnalazione",
    "illuminazione",
  ],
  authors: [{ name: "Fabio Tempera", url: "https://ft2801.github.io/Portfolio" }],
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // apple-touch-icon: iOS richiede idealmente 180x180, ma accetta anche
    // 192x192 ridimensionato. L'icona è già progettata con padding sicuro
    // per il masking Apple (sfondo opaco, logo centrato).
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
        {/* Service worker registration come script esterno (no dangerouslySetInnerHTML) */}
        <script src="/sw-register.js" defer />
      </body>
    </html>
  );
}
