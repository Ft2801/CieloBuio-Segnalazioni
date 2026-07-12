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
// la connessione TLS a ogni chiamata)
let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.PEC_SMTP_HOST!,
      port: Number(process.env.PEC_SMTP_PORT ?? 465),
      secure: true,
      auth: {
        user: process.env.PEC_SMTP_USER,
        pass: process.env.PEC_SMTP_PASSWORD,
      },
    });
  }
  return cachedTransporter;
}

async function inviaEmail(notifica: NotificaEmail): Promise<boolean> {
  const host = process.env.PEC_SMTP_HOST;
  if (!host) {
    logger.info({ to: notifica.to, subject: notifica.subject }, "[DEMO] Notifica email (SMTP non configurato)");
    return false;
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.PEC_FROM ?? "no-reply@tuodominio.it",
      to: notifica.to,
      subject: notifica.subject,
      text: notifica.text,
    });
    return true;
  } catch (e) {
    logger.error({ err: e, to: notifica.to, subject: notifica.subject }, "Errore invio notifica email");
    return false;
  }
}

/**
 * Azzera il cache del transporter SMTP. Esposta per i test: permette di
 * verificare che la configurazione venga letta correttamente dopo cambi
 * di variabili d'ambiente.
 */
export function __resetTransporterCacheForTests(): void {
  cachedTransporter = null;
}

/**
 * Notifica al referente territoriale competente che c'è una nuova
 * segnalazione in revisione. Cerca il referente assegnato alla provincia
 * o alla regione della segnalazione.
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
            { ruolo: "admin" as const },
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

  for (const ref of referenti) {
    const email = ref.emailOrdinaria ?? ref.email;
    if (email) {
      await inviaEmail({ to: email, subject, text });
    }
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

  await inviaEmail({ to: email, subject, text });
}

/**
 * Notifica al volontario e al referente approvatore che la PEC è stata
 * inviata con successo. Entrambi ricevono la stessa email di conferma
 * (se diversi e con email disponibile).
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

  // Invia al volontario segnalatore
  const emailVolontario = segnalazione.volontario?.emailOrdinaria ?? segnalazione.volontario?.email;
  if (emailVolontario) {
    await inviaEmail({ to: emailVolontario, subject, text });
  }

  // Invia anche al referente approvatore (se diverso dal volontario e con email disponibile)
  const referente = segnalazione.referenteApprovatore;
  if (referente && referente.id !== segnalazione.volontario?.id) {
    const emailReferente = referente.emailOrdinaria ?? referente.email;
    if (emailReferente && emailReferente !== emailVolontario) {
      await inviaEmail({ to: emailReferente, subject, text });
    }
  }
}
