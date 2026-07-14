/**
 * Logger strutturato con Pino.
 *
 * In produzione: log JSON su stdout con livello 'info', redazione automatica
 * dei campi sensibili (passwordHash, token, password, totpSecret e altri).
 * In sviluppo: log pretty-print su stdout con livello 'debug'.
 *
 * Autore: Fabio Tempera (2026)
 */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: isProduction ? "info" : "debug",
  redact: {
    paths: [
      // Credenziali e segreti di autenticazione
      "passwordHash",
      "password",
      "token",
      "totpSecret",
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
      "user.totpVerifiedAt",
      // Match ricorsivi (qualsiasi profondità)
      "*.passwordHash",
      "*.password",
      "*.token",
      "*.totpSecret",
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
    version: "1.0.0",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

export { logger };
