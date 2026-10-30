/**
 * Libreria per l'invio di email di notifica (non PEC) ai referenti
 * territoriali e ai volontari. Usa lo stesso transport SMTP configurato
 * per le PEC, ma con un'email ordinaria separata.
 *
 * Se PEC_SMTP_HOST non è configurato le notifiche non vengono inviate: se ne
 * registra l'esito nel log di sistema.
 *
 * Autore: Fabio Tempera (2026)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  leggiConfigurazioneSmtp,
  getTransporter,
  __resetTransporterCacheForTests as __resetSmtpCacheForTests,
} from "@/lib/smtp";
import { formatDataOra } from "@/lib/format";

type NotificaEmail = {
  to: string;
  subject: string;
  text: string;
};

type InviaEmailResult = { ok: true } | { ok: false; reason: "non_configurato" | "error"; error?: unknown };

async function inviaEmail(notifica: NotificaEmail): Promise<InviaEmailResult> {
  const cfg = leggiConfigurazioneSmtp();
  if (!cfg) {
    logger.info({ to: notifica.to, subject: notifica.subject }, "Notifica email non inviata: SMTP non configurato");
    return { ok: false, reason: "non_configurato" };
  }
  if (!cfg.from) {
    // Senza mittente configurato non si invia nulla: un valore di ripiego
    // produrrebbe email con un dominio inesistente.
    logger.error(
      { to: notifica.to, subject: notifica.subject },
      "PEC_FROM non configurato: notifica email non inviata",
    );
    return { ok: false, reason: "non_configurato" };
  }
  try {
    await getTransporter(cfg).sendMail({
      from: cfg.from,
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
 * Azzera la cache del transporter SMTP. Esposta per i test.
 */
export function __resetTransporterCacheForTests(): void {
  __resetSmtpCacheForTests();
}

/**
 * Notifica al referente territoriale competente che c'è una nuova
 * segnalazione in revisione. Cerca il referente assegnato alla provincia
 * o alla regione della segnalazione.
 *
 * La notifica raggiunge solo i referenti territorialmente competenti. Gli
 * admin non ricevono un'email per ogni segnalazione in revisione: possono
 * monitorare le pratiche dalla dashboard.
 */
export async function notificaReferenteNuovaRevisione(segnalazioneId: string): Promise<void> {
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

  // Cerca i referenti assegnati alla provincia o alla regione della
  // segnalazione. Gli admin non sono inclusi (vedi JSDoc della funzione).
  // Un destinatario senza indirizzo viene scartato più avanti, in
  // `destinatari`.
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

  // Il comune è facoltativo nello schema: senza comune l'oggetto resta essenziale.
  const luogo = segnalazione.comune
    ? `: ${segnalazione.comune.nome}${segnalazione.provincia?.sigla ? ` (${segnalazione.provincia.sigla})` : ""}`
    : "";
  const subject = `Nuova segnalazione in revisione${luogo}`;

  const text = `Una nuova segnalazione richiede la tua revisione.

Indirizzo: ${segnalazione.indirizzoVia}
Comune: ${segnalazione.comune?.nome ?? "n/d"} (${segnalazione.provincia?.sigla ?? "n/d"})
Regione: ${segnalazione.regione?.regione ?? "n/d"}
Volontario: ${segnalazione.volontario?.nomeCognome ?? "n/d"}

Accedi alla piattaforma per visualizzare i dettagli e procedere con l'approvazione o il rifiuto.

Piattaforma: ${process.env.NEXT_PUBLIC_BASE_URL || "n/d"}

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  // Invio in parallelo con Promise.allSettled: un destinatario in errore non
  // blocca gli altri. I fallimenti vengono loggati e non propagati, perché le
  // notifiche sono best-effort rispetto al flusso principale.
  // Deduplica per email: lo stesso indirizzo non riceve due copie.
  const destinatari = [
    ...new Set(
      referenti.map((ref) => ref.emailOrdinaria || ref.email).filter((email): email is string => Boolean(email)),
    ),
  ];

  const results = await Promise.allSettled(destinatari.map((email) => inviaEmail({ to: email, subject, text })));
  const failures = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
  if (failures.length > 0) {
    logger.warn(
      { total: destinatari.length, failures: failures.length },
      "Alcune notifiche email non sono state consegnate",
    );
  }
}

/**
 * Notifica al volontario che la sua segnalazione è stata rifiutata con nota.
 */
export async function notificaVolontarioRifiuto(
  segnalazioneId: string,
  notaRifiuto: string,
  nomeReferente?: string,
): Promise<void> {
  const segnalazione = await db.segnalazione.findUnique({
    where: { id: segnalazioneId },
    include: {
      volontario: { select: { nomeCognome: true, email: true, emailOrdinaria: true } },
      referenteApprovatore: { select: { nomeCognome: true } },
    },
  });
  if (!segnalazione) return;

  const email = segnalazione.volontario?.emailOrdinaria || segnalazione.volontario?.email;
  if (!email) return;

  const subject = "Segnalazione rifiutata dal referente territoriale";
  const text = `La tua segnalazione è stata rifiutata dal referente${nomeReferente ? ` ${nomeReferente}` : " territoriale"}.

Nota del referente:
${notaRifiuto}

Accedi alla piattaforma per modificare i dati e inviare nuovamente la segnalazione in revisione.

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  const result = await inviaEmail({ to: email, subject, text });
  if (result.ok === false && result.reason === "error") {
    logger.warn(
      { err: result.error, to: email, segnalazioneId },
      "Invio notifica rifiuto al volontario fallito (best-effort, non blocca il flusso principale)",
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
Data invio: ${formatDataOra(segnalazione.dataInvio)}

La pratica è ora in stato "Inviata" e resta in attesa di risposta dall'amministrazione.

CieloBuio, Coordinamento per la protezione del cielo notturno`;

  // Costruisce la lista dei destinatari (volontario + referente approvatore
  // se diverso), deduplicando per email.
  const destinatari = new Set<string>();
  const emailVolontario = segnalazione.volontario?.emailOrdinaria || segnalazione.volontario?.email;
  if (emailVolontario) destinatari.add(emailVolontario);

  const referente = segnalazione.referenteApprovatore;
  if (referente && referente.id !== segnalazione.volontario?.id) {
    const emailReferente = referente.emailOrdinaria || referente.email;
    if (emailReferente) destinatari.add(emailReferente);
  }

  // Invia in parallelo. Promise.allSettled per non bloccare su un
  // destinatario fallito. Logga i fallimenti come warning per dare
  // visibilità al problema senza propagare l'errore al chiamante
  // (le notifiche sono best-effort rispetto al flusso principale).
  const results = await Promise.allSettled([...destinatari].map((email) => inviaEmail({ to: email, subject, text })));
  const failures = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
  if (failures.length > 0) {
    logger.warn(
      { total: destinatari.size, failures: failures.length, segnalazioneId },
      "Alcune notifiche di conferma invio PEC non sono state consegnate",
    );
  }
}
