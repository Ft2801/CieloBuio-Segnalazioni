/**
 * API: POST /api/segnalazioni/[id]/simula-pec
 * Simulazione di invio PEC: invia solo all'indirizzo del mittente (test sicuro).
 * Equivalente del vecchio tasto "Simula spedizione" del sistema Excel.
 *
 * In modalità demo (PEC_SMTP_HOST non configurato) NON viene inviata nessuna
 * email reale: viene solo registrato il log. In produzione (PEC_SMTP_HOST
 * configurato) viene inviata una PEC effettiva al solo indirizzo del mittente.
 *
 * Il numero di protocollo viene mostrato in preview (calcolato in modo
 * previsionale) ma NON viene persistito: la segnalazione resta nello stato
 * "approvata" finché non viene eseguito l'invio reale.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { getSessionUser, canSendPec, hasTerritorialCompetence } from "@/lib/auth";
import { calcolaProtocolloPrevisionale } from "@/lib/protocollo";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildLetteraContextFromSegnalazione, generaTestoLettera } from "@/lib/lettera";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canSendPec(user)) {
    return NextResponse.json(
      { error: "Non autorizzato" },
      { status: 403 }
    );
  }

  // H5: rate limiting per utente (10 simulazioni/ora)
  const rl = checkRateLimit(`simula-pec:${user.id}`, 10, 60 * 60 * 1000, 60 * 60 * 1000, 30 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe simulazioni. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
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

  // H3: verifica competenza territoriale
  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json(
      { error: "Non autorizzato per questa segnalazione" },
      { status: 403 }
    );
  }

  if (!["approvata"].includes(segnalazione.stato)) {
    return NextResponse.json(
      { error: "La segnalazione deve essere prima approvata" },
      { status: 400 }
    );
  }

  // Numero di protocollo: se già assegnato (invio reale già avvenuto), lo mostra;
  // altrimenti calcola un valore previsionale usando la funzione condivisa
  // in protocollo.ts (stessa logica di generaNumeroProtocollo, ma senza
  // persistere il risultato).
  let numeroProtocollo = segnalazione.numeroProtocollo;
  if (!numeroProtocollo) {
    const regione = segnalazione.regione ?? segnalazione.provincia?.regione;
    if (regione && segnalazione.provincia && segnalazione.volontario && segnalazione.volontarioId) {
      const previsionale = await calcolaProtocolloPrevisionale({
        data: segnalazione.dataSegnalazione,
        regione: regione.regione,
        provinciaSigla: segnalazione.provincia.sigla,
        segnalatoreId: segnalazione.volontarioId,
        segnalatoreNomeCognome: segnalazione.volontario.nomeCognome,
        inizialiProtocollo: segnalazione.volontario.inizialiProtocollo,
      });
      numeroProtocollo = previsionale ? `${previsionale} (previsionale)` : null;
    }
  }

  // Destinatario simulazione: solo il mittente.
  // Nota: dopo anonimizzazione GDPR, segnalazione.volontario può essere null;
  // in quel caso non c'è PEC mittente valida e la simulazione non può inviare.
  const vol = segnalazione.volontario;
  const mittentePec = segnalazione.mittenteVisibile
    ? vol?.pec ?? vol?.emailOrdinaria ?? vol?.email ?? null
    : user.pec ?? user.emailOrdinaria ?? user.email;

  const pecHost = process.env.PEC_SMTP_HOST;
  let esito: "ok" | "errore" = "ok";
  let messaggioErrore: string | null = null;
  let emailInviata = false;

  // Logica di branching esplicita sui due prerequisiti per l'invio SMTP
  // reale della simulazione: host SMTP configurato E mittente PEC disponibile.
  // Tre rami distinti per evitare l'attuale comportamento ambiguo in cui
  // `!pecHost || !mittentePec` cade nel ramo demo ma il log viene comunque
  // registrato con esito="ok" e un messaggio che menziona "modalità demo"
  // anche quando l'host SMTP è configurato ma manca la PEC mittente.
  if (!pecHost) {
    // Modalità demo: nessun host SMTP configurato, simula con ritardo.
    await new Promise((r) => setTimeout(r, 300));
  } else if (!mittentePec) {
    // Host SMTP configurato ma mittente PEC mancante: non possiamo inviare
    // la simulazione. Registriamo esito="errore" con un messaggio chiaro
    // per distinguere questo caso dal demo mode.
    esito = "errore";
    messaggioErrore = "Mittente PEC non configurato per l'utente corrente";
  } else {
    try {
      // La simulazione invia la lettera completa (come l'invio reale).
      // generaTestoLettera include già il testo introduttivo del volontario.
      // Antepone un avviso esplicito che si tratta di una prova.
      const letteraContext = await buildLetteraContextFromSegnalazione(id);
      const corpoLettera = generaTestoLettera(letteraContext);
      const testoPec = `[SIMULAZIONE - questa PEC è una prova, non è stata inviata al Comune]\n\n${corpoLettera}`;

      const transporter = nodemailer.createTransport({
        host: pecHost,
        port: Number(process.env.PEC_SMTP_PORT ?? 465),
        secure: true,
        auth: {
          user: process.env.PEC_SMTP_USER,
          pass: process.env.PEC_SMTP_PASSWORD,
        },
      });
      // Risolve il mittente: PEC_FROM (configurazione server) ha priorità,
      // altrimenti usa la PEC dell'utente corrente come fallback.
      const fromAddress = (process.env.PEC_FROM ? process.env.PEC_FROM : user.pec) as string | undefined;
      await transporter.sendMail({
        from: fromAddress,
        to: mittentePec,
        subject: `[SIMULAZIONE] ${segnalazione.oggettoPec ?? ""}`,
        text: testoPec,
      });
      emailInviata = true;
    } catch (e) {
      esito = "errore";
      messaggioErrore = e instanceof Error ? e.message : String(e);
    }
  }

  await db.logInvioPec.create({
    data: {
      segnalazioneId: id,
      tipo: "simula",
      destinatari: mittentePec ?? "",
      oggetto: `[SIMULAZIONE] ${segnalazione.oggettoPec ?? ""}`,
      esito,
      messaggioErrore,
    },
  });

  if (esito === "errore") {
    // Non rivelare dettagli SMTP al client; l'errore è nel log DB.
    // Il dettaglio resta in `messaggioErrore` per audit lato server.
    return NextResponse.json(
      { error: "Errore durante la simulazione della PEC. Il dettaglio è registrato nei log di sistema. Contatta l'amministrazione se il problema persiste." },
      { status: 500 }
    );
  }

  const messaggio = emailInviata
    ? `Email di simulazione inviata a ${mittentePec}`
    : `Simulazione registrata (modalità demo: nessuna email inviata). Destinatario previsto: ${mittentePec}`;

  return NextResponse.json({
    ok: true,
    numeroProtocollo,
    mittentePec,
    emailInviata,
    messaggio,
  });
}
