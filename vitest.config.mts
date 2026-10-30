import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("./src", import.meta.url));

// Test che richiedono il DOM (React Testing Library). Tutti gli altri girano in Node.
const JSDOM_INCLUDE = [
  "src/components/**/*.test.tsx",
  "src/hooks/**/*.test.ts",
  "src/app/**/*.test.tsx",
  "src/__tests__/**/*.test.tsx",
];

const TEST_INCLUDE = ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "scripts/**/*.test.ts"];

export default defineConfig({
  resolve: {
    alias: {
      "@": SRC,
    },
  },
  test: {
    globals: true,
    testTimeout: 10000,
    setupFiles: ["./src/setup-tests.ts"],
    server: {
      deps: {
        inline: ["@prisma/client"],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: JSDOM_INCLUDE,
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: TEST_INCLUDE,
          exclude: JSDOM_INCLUDE,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "json-summary", "html"],
      // Perimetro: tutto il codice eseguibile di applicazione e script CLI.
      // Esclusi solo i file di test, l'infrastruttura di test e le dichiarazioni di tipo.
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/*.spec.{ts,tsx}",
        "src/setup-tests.ts",
        "src/**/*.d.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
