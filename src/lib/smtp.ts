import { createHash } from "crypto";
import { createTransport, type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";

/**
 * Configurazione SMTP per l'invio delle PEC e delle notifiche email.
 *
 * Variabili d'ambiente:
 *  - PEC_SMTP_HOST: host del server SMTP. Se assente, l'invio PEC è disabilitato:
 *    le richieste di invio rispondono 503 e la simulazione viene solo registrata.
 *  - PEC_SMTP_PORT: porta (default 465). 465 usa TLS implicito; ogni altra
 *    porta (es. 587) usa STARTTLS con requireTLS.
 *  - PEC_SMTP_USER, PEC_SMTP_PASSWORD: credenziali della casella PEC.
 *  - PEC_FROM: indirizzo mittente. Se assente si usa la PEC dell'utente.
 */
type ConfigurazioneSmtp = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string | undefined;
};

const PORTA_SMTP_PREDEFINITA = 465;

/**
 * Legge la configurazione SMTP dall'ambiente. Ritorna null quando
 * PEC_SMTP_HOST non è impostato: in quel caso nessun messaggio può essere inviato.
 */
export function leggiConfigurazioneSmtp(env: NodeJS.ProcessEnv = process.env): ConfigurazioneSmtp | null {
  const host = env.PEC_SMTP_HOST?.trim();
  if (!host) return null;

  const rawPort = env.PEC_SMTP_PORT ?? String(PORTA_SMTP_PREDEFINITA);
  const port = Number(rawPort);
  const portValida = Number.isInteger(port) && port >= 1 && port <= 65535;
  if (!portValida) {
    logger.warn(
      { rawPort },
      `PEC_SMTP_PORT non valido (deve essere un intero 1-65535), uso ${PORTA_SMTP_PREDEFINITA} come fallback`,
    );
  }
  const portaFinale = portValida ? port : PORTA_SMTP_PREDEFINITA;
  const tlsImplicito = portaFinale === PORTA_SMTP_PREDEFINITA;

  return {
    host,
    port: portaFinale,
    secure: tlsImplicito,
    requireTLS: !tlsImplicito,
    user: env.PEC_SMTP_USER || undefined,
    pass: env.PEC_SMTP_PASSWORD || undefined,
    from: env.PEC_FROM?.trim() || undefined,
  };
}

// Transporter condiviso a livello di modulo: evita di aprire una nuova
// connessione TLS a ogni richiesta. La chiave include host, porta, utente
// e password (in forma di hash) così che una rotazione delle credenziali
// produca un nuovo transporter.
let cached: { key: string; transporter: Transporter } | null = null;

function chiaveConfigurazione(cfg: ConfigurazioneSmtp): string {
  return createHash("sha256")
    .update(JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user ?? "", cfg.pass ?? ""]))
    .digest("hex");
}

/**
 * Ritorna il transporter per la configurazione indicata, riusandolo quando
 * la configurazione non è cambiata. Il transporter precedente viene chiuso
 * quando la configurazione cambia.
 */
export function getTransporter(cfg: ConfigurazioneSmtp): Transporter {
  const key = chiaveConfigurazione(cfg);
  if (cached && cached.key === key) return cached.transporter;

  const precedente = cached?.transporter;
  cached = {
    key,
    transporter: createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      requireTLS: cfg.requireTLS,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    }),
  };
  precedente?.close();
  return cached.transporter;
}

/** Azzera la cache del transporter. Riservata ai test. */
export function __resetTransporterCacheForTests(): void {
  cached?.transporter.close();
  cached = null;
}
