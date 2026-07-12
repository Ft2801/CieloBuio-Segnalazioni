import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["src/components/**/*.test.tsx", "jsdom"],
      ["src/hooks/**/*.test.ts", "jsdom"],
      ["src/app/**/*.test.tsx", "jsdom"],
      ["src/__tests__/**/*.test.tsx", "jsdom"],
    ],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html"],
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/middleware.ts",
        "src/hooks/**/*.ts",
        "src/components/ui/**/*.tsx",
        "src/components/app/autore-link.tsx",
        "src/components/app/login-screen.tsx",
        "src/components/app/vista-reminder.tsx",
        "src/components/app/dashboard.tsx",
        "src/components/app/lista-segnalazioni.tsx",
        "src/components/app/app-shell.tsx",
        "src/components/app/dettaglio-segnalazione.tsx",
        "src/components/app/form-segnalazione.tsx",
        "src/components/app/pannello-admin.tsx",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "scripts/cron-jobs.ts",
      ],
      exclude: [
        "src/lib/types.ts",
        "src/lib/demo-data.ts",
        "src/lib/db.ts",
        "src/lib/logger.ts",
        "src/lib/**/*.test.ts",
        "src/app/api/**/*.test.ts",
        "src/app/api/__tests__/**",
        "src/app/api/health/route.ts",
        "src/components/**/*.test.tsx",
        "src/hooks/**/*.test.ts",
        "src/__tests__/**",
        "src/components/ui/toast.tsx",
        "scripts/seed.ts",
        "scripts/create-admin.ts",
        "scripts/backup-db.ts",
        "scripts/generate-icons.py",
        "scripts/deploy.sh",
      ],
      thresholds: {
        // Soglia 100% su tutto il codice sorgente.
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    server: {
      deps: {
        inline: ["@prisma/client"],
      },
    },
    setupFiles: ["./src/setup-tests.ts"],
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
