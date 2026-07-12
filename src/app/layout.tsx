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
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CieloBuio",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f4f5",
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
        {/* L6: service worker registration come script esterno (no dangerouslySetInnerHTML) */}
        <script src="/sw-register.js" defer />
      </body>
    </html>
  );
}
