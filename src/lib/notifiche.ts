/**
 * Libreria per l'invio di email di notifica (non PEC) ai referenti
 * territoriali e ai volontari. Usa lo stesso transport SMTP configurato
 * per le PEC, ma con un'email ordinaria separata.
 *
 * In modalità demo (PEC_SMTP_HOST non configurato) le notifiche vengono
 * solo loggate, non inviate.
 *
 * Autore: Fabio Tempera (2026)
 */

import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Segnalazione } from "@/lib/types";

type NotificaEmail = {
  to: string;
  subject: string;
  text: string;
};

// Transporter SMTP cached a livello di modulo (evita di ricreare
// la connessione TLS a ogni chiamata). La chiave di cache include host,
// porta, utente e password così che una rotazione delle credenziali via
// env produca un nuovo transporter invece di riusare quello obsoleto.
let cachedTransporter: nodemailer.Transporter | null = null;
let cachedKey = "";

function buildTransporterKey(): string {
  return `${process.env.PEC_SMTP_HOST ?? ""}:${process.env.PEC_SMTP_PORT ?? "465"}:${process.env.PEC_SMTP_USER ?? ""}:${process.env.PEC_SMTP_PASSWORD ?? ""}`;
}

function getTransporter(): nodemailer.Transporter {
  const key = buildTransporterKey();
  if (!cachedTransporter || cachedKey !== key) {
    const rawPort = process.env.PEC_SMTP_PORT ?? "465";
    const port = Number(rawPort);
    // Validazione difensiva del numero di porta: un valore non numerico
    // (es. "abc" impostato per errore nel .env) produrrebbe NaN,
    // creando un transporter non funzionante che fallirebbe con errori
    // criptici al primo invio. In tal caso fallback alla porta di
    // default (465) e logga un warning per segnalare la configurazione.
    const portValida = Number.isInteger(port) && port >= 1 && port <= 65535;
    const portFinale = portValida ? port : 465;
    if (!portValida) {
      logger.warn(
        { rawPort },
        "PEC_SMTP_PORT non valido (deve essere un intero 1-65535), uso 465 come fallback"
      );
    }
    // secure:true è corretto solo per la porta 465 (implicit TLS).
    // Per 587 (STARTTLS) va usato secure:false con requireTLS:true,
    // altrimenti il transporter non connette. Per altre porte
    // inferiamo secure dal valore di porta (465 = implicit TLS).
    const isImplicitTls = portFinale === 465;
    // Se stiamo sostituendo un transporter precedente (rotazione credenziali
    // via env), chiudiamo esplicitamente la connessione del vecchio per
    // evitare leak di socket e handle TCP librati dopo la sostituzione.
    const vecchio = cachedTransporter;
    cachedTransporter = nodemailer.createTransport({
      host: process.env.PEC_SMTP_HOST!,
      port: portFinale,
      secure: isImplicitTls,
      requireTLS: !isImplicitTls,
      auth: {
        user: process.env.PEC_SMTP_USER,
        pass: process.env.PEC_SMTP_PASSWORD,
      },
    });
    cachedKey = key;
    if (vecchio) {
      // close() del vecchio transporter: lo invochiamo per rilasciare le
      // socket TCP residue. Alcune versioni di nodemailer ritornano void,
      // altre Promise<void>: gestiamo entrambi i casi. L'eventuale
      // rejection viene loggata a livello debug (non blocca il flusso).
      try {
        const maybePromise = vecchio.close() as unknown;
        if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
          (maybePromise as Promise<unknown>).catch((e: unknown) => {
            logger.debug({ err: e }, "Errore non bloccante nella chiusura del vecchio transporter SMTP");
          });
        }
      } catch (e) {
        logger.debug({ err: e }, "Errore sincrono nella chiusura del vecchio transporter SMTP");
      }
    }
  }
  return cachedTransporter;
}

type InviaEmailResult =
  | { ok: true }
  | { ok: false; reason: "demo" | "error"; error?: unknown };

async function inviaEmail(notifica: NotificaEmail): Promise<InviaEmailResult> {
  const host = process.env.PEC_SMTP_HOST;
  if (!host) {
    logger.info({ to: notifica.to, subject: notifica.subject }, "[DEMO] Notifica email (SMTP non configurato)");
    return { ok: false, reason: "demo" };
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.PEC_FROM ?? "no-reply@tuodominio.it",
      to: notifica.to,
      subject: notifica.subject,
      text: notifica.text,
    });
    return { ok: true };
  } catch (e) {
    logger.error({ err: e, to: notifica.to, subject: notifica.subject }, "Errore invio notifica email");
    return { ok: false, reason: "error", error: e };
  }
}

/**
 * Azzera il cache del transporter SMTP. Esposta per i test: permette di
 * verificare che la configurazione venga letta correttamente dopo cambi
 * di variabili d'ambiente.
 */
export function __resetTransporterCacheForTests(): void {
  cachedTransporter = null;
  cachedKey = "";
}

/**
 * Notifica al referente territoriale competente che c'è una nuova
 * segnalazione in revisione. Cerca il referente assegnato alla provincia
 * o alla regione della segnalazione.
 *
 * Gli admin NON ricevono più una notifica per ogni nuova segnalazione in
 * revisione: questa cascata generava email eccessive (ogni admin per ogni
 * segnalazione) ed è stata rimossa in favore di un più mirato flusso di
 * notifica ai referenti territorialmente competenti. Gli admin possono
 * monitorare il sistema tramite la dashboard.
 */
export async function notificaReferenteNuovaRevisione(
  segnalazioneId: string
): Promise<void> {
  const segnalazione = await db.segnalazione.findUnique({
    where: { id: segnalazioneId },
    include: {
      comune: true,
      provincia: true,
      regione: true,
      volontario: { select: { nomeCognome: true, email: true } },
    },
  });
  if (!segnalazione) return;

  // Cerca referenti assegnati a questa provincia o regione.
  // Il filtro runtime `if (email)` nel ciclo sotto gestisce il caso
  // (rarissimo) di utente senza email disponibile.
  // Gli admin non sono inclusi nella notifica: ricevono troppe email
  // e possono monitorare via dashboard.
  const referenti = await db.user.findMany({
    where: {
      attivo: true,
      AND: [
        {
          OR: [
            // Solo se la segnalazione ha provinciaId non null, altrimenti
            // un referente con provinciaId null (mal configurato) riceverebbe
            // notifiche non destinate a lui.
            ...(segnalazione.provinciaId !== null
              ? [{ ruolo: "referente_provinciale" as const, provinciaId: segnalazione.provinciaId }]
              : []),
            ...(segnalazione.regioneId !== null
              ? [{ ruolo: "referente_regionale" as const, regioneId: segnalazione.regioneId }]
              : []),
          ],
        },
      ],
    },
  });

  if (referenti.length === 0) return;

  const subject = `Nuova segnalazione in revisione: ${segnalazione.comune?.nome ?? ""} (${
    segnalazione.provincia?.sigla ?? ""
  })`;

  const text = `Una nuova segnalazione richiede la tua revisione.

Indirizzo: ${segnalazione.indirizzoVia}
Comune: ${segnalazione.comune?.nome ?? "n/d"} (${segnalazione.provincia?.sigla ?? "n/d"})
Regione: ${segnalazione.regione?.regione ?? "n/d"}
Volontario: ${segnalazione.volontario?.nomeCognome ?? "n/d"}

Accedi alla piattaforma per visualizzare i dettagli e procedere con l'approvazione o il rifiuto.

Piattaforma: ${process.env.NEXT_PUBLIC_BASE_URL ?? "https://segnalazioni.esempio.it"}

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  // Invia in parallelo: Promise.allSettled per non bloccare su un
  // destinatario fallito. Logga i fallimenti ma non le propaga (le
  // notifiche sono best-effort rispetto al flusso principale).
  const destinatari = referenti
    .map((ref) => ref.emailOrdinaria ?? ref.email)
    .filter((email): email is string => Boolean(email));

  const results = await Promise.allSettled(
    destinatari.map((email) => inviaEmail({ to: email, subject, text }))
  );
  const failures = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
  if (failures.length > 0) {
    logger.warn({ total: destinatari.length, failures: failures.length }, "Alcune notifiche email non sono state consegnate");
  }
}

/**
 * Notifica al volontario che la sua segnalazione è stata rifiutata con nota.
 */
export async function notificaVolontarioRifiuto(
  segnalazioneId: string,
  notaRifiuto: string
): Promise<void> {
  const segnalazione = await db.segnalazione.findUnique({
    where: { id: segnalazioneId },
    include: {
      volontario: { select: { nomeCognome: true, email: true, emailOrdinaria: true } },
      referenteApprovatore: { select: { nomeCognome: true } },
    },
  });
  if (!segnalazione) return;

  const email = segnalazione.volontario?.emailOrdinaria ?? segnalazione.volontario?.email;
  if (!email) return;

  const subject = "Segnalazione rifiutata dal referente territoriale";
  const text = `La tua segnalazione è stata rifiutata dal referente ${segnalazione.referenteApprovatore?.nomeCognome ?? ""}.

Nota del referente:
${notaRifiuto}

Accedi alla piattaforma per modificare i dati e inviare nuovamente la segnalazione in revisione.

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  const result = await inviaEmail({ to: email, subject, text });
  if (result.ok === false && result.reason === "error") {
    logger.warn(
      { err: result.error, to: email, segnalazioneId },
      "Invio notifica rifiuto al volontario fallito (best-effort, non blocca il flusso principale)"
    );
  }
}

/**
 * Notifica al volontario e al referente approvatore che la PEC è stata
 * inviata con successo. Entrambi ricevono la stessa email di conferma
 * (se diversi e con email disponibile).
 *
 * Gli invii sono in parallelo (Promise.allSettled) per ridurre la
 * latenza totale rispetto all'invio sequenziale.
 */
export async function notificaPecInviata(segnalazioneId: string): Promise<void> {
  const segnalazione = await db.segnalazione.findUnique({
    where: { id: segnalazioneId },
    include: {
      volontario: { select: { id: true, nomeCognome: true, email: true, emailOrdinaria: true } },
      referenteApprovatore: { select: { id: true, nomeCognome: true, email: true, emailOrdinaria: true } },
      comune: true,
      provincia: true,
    },
  });
  if (!segnalazione) return;

  const subject = `PEC inviata: ${segnalazione.numeroProtocollo ?? ""}`;
  const text = `La PEC per la segnalazione è stata inviata con successo.

Protocollo: ${segnalazione.numeroProtocollo ?? "n/d"}
Indirizzo: ${segnalazione.indirizzoVia}
Comune: ${segnalazione.comune?.nome ?? "n/d"} (${segnalazione.provincia?.sigla ?? "n/d"})
Data invio: ${segnalazione.dataInvio ? new Date(segnalazione.dataInvio).toLocaleString("it-IT") : "n/d"}

La pratica è ora in stato "Inviata" e resta in attesa di risposta dall'amministrazione.

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  // Costruisce la lista dei destinatari (volontario + referente approvatore
  // se diverso), deduplicando per email.
  const destinatari = new Set<string>();
  const emailVolontario = segnalazione.volontario?.emailOrdinaria ?? segnalazione.volontario?.email;
  if (emailVolontario) destinatari.add(emailVolontario);

  const referente = segnalazione.referenteApprovatore;
  if (referente && referente.id !== segnalazione.volontario?.id) {
    const emailReferente = referente.emailOrdinaria ?? referente.email;
    if (emailReferente) destinatari.add(emailReferente);
  }

  // Invia in parallelo. Promise.allSettled per non bloccare su un
  // destinatario fallito. Logga i fallimenti come warning per dare
  // visibilità al problema senza propagare l'errore al chiamante
  // (le notifiche sono best-effort rispetto al flusso principale).
  const results = await Promise.allSettled(
    [...destinatari].map((email) => inviaEmail({ to: email, subject, text }))
  );
  const failures = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)
  );
  if (failures.length > 0) {
    logger.warn(
      { total: destinatari.size, failures: failures.length, segnalazioneId },
      "Alcune notifiche di conferma invio PEC non sono state consegnate"
    );
  }
}
