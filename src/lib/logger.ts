/**
 * Logger strutturato con Pino.
 *
 * Log JSON su stdout, redazione automatica dei campi sensibili (passwordHash,
 * token, password, totpSecret, totpPendingSecret e altri).
 *   - livello: LOG_LEVEL se impostata; altrimenti 'info' in produzione e 'debug' altrove
 *   - formato: JSON; con LOG_FORMAT=pretty l'output è formattato per la lettura umana
 *
 * Autore: Fabio Tempera (2026)
 */
import pino from "pino";
import pkg from "../../package.json";

const isProduction = process.env.NODE_ENV === "production";

const livelloPredefinito = isProduction ? "info" : "debug";

const logger = pino({
  level: process.env.LOG_LEVEL ?? livelloPredefinito,
  redact: {
    paths: [
      // Credenziali e segreti di autenticazione
      "passwordHash",
      "password",
      "token",
      "totpSecret",
      "totpPendingSecret",
      "totpVerifiedAt",
      "secret",
      "otp",
      "code",
      "pin",
      "apiKey",
      "api_key",
      "authorization",
      "cookie",
      "sessionToken",
      "refreshToken",
      "bearer",
      "jwt",
      // PII: indirizzi PEC/email/firma/indirizzo (sotto user o root)
      "user.pec",
      "user.emailOrdinaria",
      "user.indirizzo",
      "user.firma",
      "user.passwordHash",
      "user.totpSecret",
      "user.totpPendingSecret",
      "user.totpVerifiedAt",
      // Match ricorsivi (qualsiasi profondità)
      "*.passwordHash",
      "*.password",
      "*.token",
      "*.totpSecret",
      "*.totpPendingSecret",
      "*.totpVerifiedAt",
      "*.secret",
      "*.otp",
      "*.code",
      "*.pin",
      "*.apiKey",
      "*.api_key",
      "*.authorization",
      "*.cookie",
      "*.sessionToken",
      "*.refreshToken",
      "*.bearer",
      "*.jwt",
      "**.passwordHash",
      "**.password",
      "**.token",
      "**.totpSecret",
      "**.totpPendingSecret",
      "**.totpVerifiedAt",
      "**.secret",
      "**.otp",
      "**.code",
      "**.pin",
      "**.apiKey",
      "**.api_key",
      "**.authorization",
      "**.cookie",
      "**.sessionToken",
      "**.refreshToken",
      "**.bearer",
      "**.jwt",
      // Headers HTTP che possono contenere credenziali
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: "cielobuio-segnalazioni",
    version: pkg.version,
  },
  ...(process.env.LOG_FORMAT === "pretty"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

export { logger };
