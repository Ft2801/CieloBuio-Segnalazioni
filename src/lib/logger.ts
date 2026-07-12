/**
 * Logger strutturato con Pino.
 *
 * In produzione: log JSON su stdout con livello 'info', redazione automatica
 * dei campi sensibili (passwordHash, token, password, totpSecret).
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
      "passwordHash",
      "password",
      "token",
      "totpSecret",
      "*.passwordHash",
      "*.password",
      "*.token",
      "*.totpSecret",
      "**.passwordHash",
      "**.password",
      "**.token",
      "**.totpSecret",
      "sessione.token",
      "user.passwordHash",
      "user.totpSecret",
      "req.headers.authorization",
      "req.headers.cookie",
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
