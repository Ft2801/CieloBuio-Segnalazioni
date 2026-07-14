import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Non inviare l'header X-Powered-By per non fingerprintare lo stack
  // tecnologico lato client (riduce la superficie di attacco).
  poweredByHeader: false,
  // Non ignorare gli errori TypeScript in build; aiuta a intercettare
  // vulnerabilità di sicurezza legate a tipi sballati (es. string | undefined che
  // bypassa controlli strict).
  typescript: {
    ignoreBuildErrors: false,
  },
  // reactStrictMode per intercettare pattern deprecari in development
  reactStrictMode: true,
  // Limite dimensione body per le richieste: previene che upload
  // arbitrarmente grandi (multi-GB) vengano bufferizzati in memoria prima
  // del check su file.size nella route /api/upload. 12 MB copre il limite
  // applicativo di 10 MB per singolo allegato con margine per il multipart
  // encoding overhead. Per la route /api/upload viene poi applicato il
  // check puntuale MAX_ALLEGATO_BYTE sul singolo file. Il limite effettivo
  // è applicato anche dal reverse proxy (Caddy: request_body max_size 50MB)
  // come defense-in-depth a monte dell'applicazione.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // Header di sicurezza aggiuntivi a livello di Next.js (in aggiunta al middleware)
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
