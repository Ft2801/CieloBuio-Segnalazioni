import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurazione ESLint bilanciata: mantiene attive le regole che
// intercettano classi di errore reali (race condition via hook deps,
// dead code, unreachable code, fallthrough negli switch, riassegnazioni
// const) e disattiva solo le regole che generano rumore eccessivo per
// pattern legittimi nel codebase (any per compatibilità Prisma,
// console per logging).
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules - regole mantenute attive per intercettare classi di errore reali
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules - react-hooks/exhaustive-deps intercetta stale closure
    // e loop infiniti: mantenuta attiva come errore.
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules - regole critiche mantenute attive
    "no-implied-eval": "error",
    "prefer-const": "error",
    "no-unused-vars": "off", // gestito da @typescript-eslint/no-unused-vars
    "no-console": "off", // logging via pino è consentito
    "no-debugger": "error",
    "no-empty": "warn",
    "no-irregular-whitespace": "error",
    "no-case-declarations": "off",
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-redeclare": "error",
    "no-undef": "off", // gestito da TypeScript
    "no-unreachable": "error",
    "no-useless-escape": "warn",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "eslint.config.mjs", "postcss.config.mjs"]
}];

export default eslintConfig;
