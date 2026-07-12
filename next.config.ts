import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Non inviare l'header X-Powered-By per non fingerprintare lo stack
  // tecnologico lato client (riduce la superficie di attacco).
  poweredByHeader: false,
  // Non ignorare gli errori TypeScript in build; aiuta a intercettare
  // bug di sicurezza legati a tipi sballati (es. string | undefined che
  // bypassa controlli strict).
  typescript: {
    ignoreBuildErrors: false,
  },
  // reactStrictMode per intercettare pattern deprecari in development
  reactStrictMode: true,
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
