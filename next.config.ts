import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Nessun header X-Powered-By: non espone lo stack tecnologico al client.
  poweredByHeader: false,
  // Il type check del build è eseguito dallo script "build" con TypeScript 7
  // (npm run typecheck), che precede next build. Il type check interno di Next
  // userebbe il pacchetto "typescript" del progetto (TypeScript 6, richiesto da
  // typescript-eslint): disattivato per evitare una seconda verifica divergente.
  // Gli errori di tipo bloccano comunque il build.
  typescript: {
    ignoreBuildErrors: true,
  },
  // reactStrictMode per intercettare pattern deprecati in development
  reactStrictMode: true,
  // Disabilita la generazione automatica di AGENTS.md in dev
  agentRules: false,
  // Il proxy di Next.js copia il corpo prima di chiamare la route. Il suo
  // default di 10 MiB troncherebbe un file valido da 10 MiB più il multipart.
  // Il limite di 12 MiB gli consente di inoltrare il body completo: la route
  // /api/upload applica il limite effettivo di 10 MiB più 64 KiB misurando
  // il flusso (413 anche se Content-Length manca o è falso). Caddy applica
  // inoltre request_body max_size 12MB prima di raggiungere Next.js.
  experimental: {
    proxyClientMaxBodySize: "12mb",
  },
  // Header di sicurezza aggiuntivi a livello di Next.js (in aggiunta al proxy)
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
