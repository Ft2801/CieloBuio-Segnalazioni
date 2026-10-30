import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";
import pluginSecurity from "eslint-plugin-security";

// Configurazione ESLint (flat config, ESLint 10).
//
// Le regole Next.js (core-web-vitals) e i hook React sono attive. Le regole
// TypeScript sono attive come errore.
// Il progetto non produce avvisi: ogni eccezione deve essere motivata e
// circoscritta con un commento nel punto in cui viene applicata.
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      ".vitest/**",
      "next-env.d.ts",
      "eslint.config.mjs",
      "postcss.config.mjs",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
      react,
      "jsx-a11y": jsxA11y,
      "import-x": importX,
    },
    settings: {
      react: { version: "19.3" },
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,

      // React e accessibilità JSX (ESLint 10 compatibile tramite override del peer)
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "import-x/no-duplicates": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/no-absolute-path": "error",

      // Hook React: le dipendenze mancanti generano stale closure e loop infiniti.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // TypeScript
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],

      // JavaScript generale
      "no-implied-eval": "error",
      "prefer-const": "error",
      "no-debugger": "error",
      "no-empty": "error",
      "no-irregular-whitespace": "error",
      "no-fallthrough": "error",
      "no-mixed-spaces-and-tabs": "error",
      "no-redeclare": "error",
      "no-unreachable": "error",
      "no-useless-escape": "error",
    },
  },
  {
    // Regole di sicurezza (eslint-plugin-security). Due regole del set consigliato
    // sono disattivate per il progetto, con motivazione:
    // - detect-non-literal-fs-filename: il progetto gestisce allegati su disco; ogni
    //   percorso passa da src/lib/path-guard.ts, che blocca traversal e percorsi fuori
    //   dalla radice dello storage. La regola non distingue questi casi.
    // - detect-object-injection: segnala ogni accesso con chiave variabile, anche su
    //   oggetti costruiti dal codice con chiavi fisse (mappe di configurazione, enum).
    //   Le chiavi provenienti dall'esterno sono validate con Zod prima dell'uso.
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { security: pluginSecurity },
    rules: {
      ...pluginSecurity.configs.recommended.rules,
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-unsafe-regex": "error",
    },
  },
];

export default eslintConfig;
