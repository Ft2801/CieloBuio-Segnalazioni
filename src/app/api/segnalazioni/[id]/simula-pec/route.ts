/**
 * API: POST /api/segnalazioni/[id]/simula-pec
 *
 * Simulazione della spedizione: l'anteprima della PEC viene inviata solo al
 * destinatario di controllo (la PEC del volontario o dell'utente che la
 * richiede), mai al Comune.
 *
 * Modalità:
 *  - PEC_SMTP_HOST non configurato: nessuna email, solo registrazione nel log.
 *  - PEC_SMTP_HOST configurato: anteprima reale al destinatario di controllo.
 *
 * Il numero di protocollo viene mostrato in anteprima (calcolato in modo
 * previsionale) ma NON viene persistito: la segnalazione resta nello stato
 * "approvata" finché non viene eseguito l'invio reale.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canSendPec, hasTerritorialCompetence } from "@/lib/auth";
import { ErroreProtocollo, calcolaProtocolloPrevisionale } from "@/lib/protocollo";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildLetteraContextFromSegnalazione, generaTestoLettera } from "@/lib/lettera";
import { leggiConfigurazioneSmtp, getTransporter } from "@/lib/smtp";
import { logger } from "@/lib/logger";
import { messaggioDaErrore } from "@/lib/errori";

type Params = { params: Promise<{ id: string }> };

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canSendPec(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const rl = checkRateLimit(
    `simula-pec:${user.id}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
    30 * 60 * 1000,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe simulazioni. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({
    where: { id },
    include: {
      volontario: true,
      provincia: { include: { regione: true } },
      regione: true,
    },
  });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato per questa segnalazione" }, { status: 403 });
  }

  if (segnalazione.stato !== "approvata") {
    return NextResponse.json({ error: "La segnalazione deve essere prima approvata" }, { status: 400 });
  }

  // Numero di protocollo: se già assegnato lo mostra; altrimenti calcola un
  // valore previsionale con la stessa logica di generaNumeroProtocollo, senza
  // persistere il risultato.
  let numeroProtocollo = segnalazione.numeroProtocollo;
  if (!numeroProtocollo) {
    const regione = segnalazione.regione ?? segnalazione.provincia?.regione;
    if (regione && segnalazione.provincia && segnalazione.volontario && segnalazione.volontarioId) {
      let previsionale: string | null;
      try {
        previsionale = await calcolaProtocolloPrevisionale({
          data: segnalazione.dataSegnalazione,
          regione: regione.regione,
          provinciaSigla: segnalazione.provincia.sigla,
          segnalatoreId: segnalazione.volontarioId,
          segnalatoreNomeCognome: segnalazione.volontario.nomeCognome,
          inizialiProtocollo: segnalazione.volontario.inizialiProtocollo,
        });
      } catch (e) {
        if (e instanceof ErroreProtocollo) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }
        logger.error({ err: e, segnalazioneId: id }, "Calcolo del numero previsionale fallito");
        return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
      }
      numeroProtocollo = previsionale ? `${previsionale} (previsionale)` : null;
    }
  }

  // Destinatario di controllo: la PEC del volontario se il mittente è visibile,
  // altrimenti la PEC dell'utente che richiede la simulazione. Dopo
  // anonimizzazione GDPR il volontario può essere null: in tal caso manca un
  // destinatario valido e la simulazione non può inviare.
  const vol = segnalazione.volontario;
  const mittentePec = segnalazione.mittenteVisibile
    ? vol?.pec || vol?.emailOrdinaria || vol?.email
    : user.pec || user.emailOrdinaria || user.email;

  const smtp = leggiConfigurazioneSmtp();
  // Mittente SMTP: PEC_FROM, altrimenti la PEC dell'utente. Il valore è unico
  // per il controllo e per l'invio, così non resta un fallback mai usato.
  const mittenteSmtp = smtp?.from || user.pec;
  let esito: "ok" | "errore" = "ok";
  let messaggioErrore: string | null = null;
  let emailInviata = false;

  if (!smtp) {
    // Nessun servizio di posta configurato: la simulazione viene solo registrata.
  } else if (!mittentePec) {
    esito = "errore";
    messaggioErrore = "Destinatario di controllo non disponibile (PEC del volontario o dell'utente mancante)";
  } else if (!mittenteSmtp) {
    esito = "errore";
    messaggioErrore = "Mittente PEC non configurato: impostare PEC_FROM o assegnare una PEC all'utente";
  } else {
    try {
      const letteraContext = await buildLetteraContextFromSegnalazione(id);
      const corpoLettera = generaTestoLettera(letteraContext);
      const testoAnteprima = `Anteprima della PEC che sarà inviata al Comune. Questo messaggio non è stato inviato al Comune.\n\n${corpoLettera}`;

      await getTransporter(smtp).sendMail({
        from: mittenteSmtp,
        to: mittentePec,
        subject: `Anteprima PEC: ${segnalazione.oggettoPec ?? ""}`,
        text: testoAnteprima,
      });
      emailInviata = true;
    } catch (e) {
      esito = "errore";
      messaggioErrore = messaggioDaErrore(e);
      logger.error({ err: e, segnalazioneId: id }, "Errore simulazione PEC via SMTP");
    }
  }

  try {
    await db.logInvioPec.create({
      data: {
        segnalazioneId: id,
        tipo: "simula",
        destinatari: mittentePec ?? "",
        oggetto: `Anteprima PEC: ${segnalazione.oggettoPec ?? ""}`,
        esito,
        messaggioErrore,
      },
    });
  } catch (e) {
    logger.error({ err: e, segnalazioneId: id }, "Registrazione log simulazione PEC fallita");
  }

  if (esito === "errore") {
    // Il dettaglio resta in `messaggioErrore` (log DB) e nei log di sistema.
    return NextResponse.json(
      {
        error:
          "Errore durante la simulazione della PEC. Il dettaglio è registrato nei log di sistema. Contatta l'amministrazione se il problema persiste.",
      },
      { status: 500 },
    );
  }

  const messaggio = emailInviata
    ? `Anteprima inviata a ${mittentePec}`
    : `Simulazione registrata. Nessuna email inviata: il servizio di posta non è configurato. Destinatario previsto: ${mittentePec ?? "non disponibile"}`;

  return NextResponse.json({
    ok: true,
    numeroProtocollo,
    mittentePec,
    emailInviata,
    messaggio,
  });
}
