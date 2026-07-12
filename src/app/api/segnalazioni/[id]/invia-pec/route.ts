/**
 * API: POST /api/segnalazioni/[id]/invia-pec
 * Invio reale della PEC al Comune (e ARPA se richiesto).
 * Transizione: approvata -> inviata
 *
 * Il sistema genera qui il numero di protocollo definitivo (se non già presente),
 * registra il log di invio e cambia stato. L'invio SMTP effettivo è disabilitato
 * in ambiente di sviluppo (viene solo loggato); in produzione va configurato con
 * le credenziali della casella PEC dell'associazione.
 *
 * Vincolo tecnico (specifiche sezione 13): i messaggi PEC non supportano il CCN
 * verso indirizzi PEC, quindi tutti i destinatari vanno in TO o CC.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { getSessionUser, canSendPec, hasTerritorialCompetence } from "@/lib/auth";
import { generaNumeroProtocollo } from "@/lib/protocollo";
import { notificaPecInviata } from "@/lib/notifiche";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildLetteraContextFromSegnalazione, generaTestoLettera } from "@/lib/lettera";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro } from "@/lib/path-guard";
import { readFile } from "fs/promises";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canSendPec(user)) {
    return NextResponse.json(
      { error: "Non autorizzato all'invio PEC" },
      { status: 403 }
    );
  }

  // H5: rate limiting per utente (5 PEC/ora, blocco 1 ora)
  const rl = checkRateLimit(`pec:${user.id}`, 5, 60 * 60 * 1000, 60 * 60 * 1000, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppi invii PEC. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({
    where: { id },
    include: {
      comune: true,
      provincia: { include: { regione: true } },
      regione: true,
      volontario: true,
    },
  });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // H2: verifica competenza territoriale
  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json(
      { error: "Non autorizzato per questa segnalazione" },
      { status: 403 }
    );
  }

  if (segnalazione.stato !== "approvata") {
    return NextResponse.json(
      { error: "La segnalazione deve essere prima approvata" },
      { status: 400 }
    );
  }

  // Genera il numero di protocollo definitivo se mancante.
  // La funzione generaNumeroProtocollo gestisce la race condition con
  // transazione + retry su collisione unique.
  let numeroProtocollo = segnalazione.numeroProtocollo;
  if (!numeroProtocollo) {
    // Dopo anonimizzazione GDPR, il volontario può essere null. In quel
    // caso non è possibile generare un nuovo protocollo (manca il
    // segnalatore): restituisci errore esplicito.
    if (!segnalazione.volontario || !segnalazione.volontarioId) {
      return NextResponse.json(
        { error: "Segnalazione anonimizzata: impossibile generare un numero di protocollo" },
        { status: 400 }
      );
    }
    const regione = segnalazione.regione ?? segnalazione.provincia?.regione;
    if (!regione || !segnalazione.provincia) {
      return NextResponse.json(
        { error: "Regione o provincia non determinabile" },
        { status: 400 }
      );
    }
    numeroProtocollo = await generaNumeroProtocollo({
      data: segnalazione.dataSegnalazione,
      regione: regione.regione,
      provinciaSigla: segnalazione.provincia.sigla,
      segnalatoreId: segnalazione.volontarioId,
      segnalatoreNomeCognome: segnalazione.volontario.nomeCognome,
      inizialiProtocollo: segnalazione.volontario.inizialiProtocollo,
      segnalazioneId: segnalazione.id,
    });
  }

  // Composizione destinatari (TO + CC, mai BCC per le PEC)
  const destinatari: string[] = [];
  if (segnalazione.comune?.pecComune) {
    destinatari.push(segnalazione.comune.pecComune);
  }
  const regione = segnalazione.regione ?? segnalazione.provincia?.regione;
  if (segnalazione.includiArpa && regione?.pecArpaRegionale) {
    destinatari.push(regione.pecArpaRegionale);
  }
  if (segnalazione.pecCcAggiuntive) {
    for (const cc of segnalazione.pecCcAggiuntive.split(";")) {
      const t = cc.trim();
      if (t && !destinatari.includes(t)) destinatari.push(t);
    }
  }

  // Validazione pre-SMTP: se nessun destinatario, l'invio fallirebbe con
  // errore opaco ("No recipients"). Restituiamo un errore chiaro.
  if (destinatari.length === 0) {
    return NextResponse.json(
      { error: "Nessun destinatario PEC configurato. Verifica che il comune abbia una PEC e/o che la segnalazione includa CC validi." },
      { status: 400 }
    );
  }

  // Blocca l'invio se la PEC del comune contiene un placeholder
  // (es. "PEC-DA-CONFIGURARE@comune-...") che indica che il dato non è
  // stato ancora configurato dall'amministratore. Inviarci una PEC reale
  // produrrebbe un bounce e sprecerebbe il numero di protocollo.
  const PLACEHOLDER_PEC_PATTERN = /PEC-DA-CONFIGURARE/i;
  const placeholderDestinatari = destinatari.filter((d) => PLACEHOLDER_PEC_PATTERN.test(d));
  if (placeholderDestinatari.length > 0) {
    return NextResponse.json(
      { error: `Impossibile inviare PEC: i seguenti destinatari contengono un placeholder non configurato: ${placeholderDestinatari.join(", ")}. Configurare la PEC reale dal pannello di amministrazione.` },
      { status: 400 }
    );
  }

  // Mittente: obbligatorio. Se manca sia PEC_FROM sia user.pec, nodemailer
  // restituirebbe un errore generico.
  const fromAddress = process.env.PEC_FROM ?? user.pec;
  if (!fromAddress) {
    return NextResponse.json(
      { error: "Mittente PEC non configurato. Imposta PEC_FROM nel file .env o assegna una PEC all'utente." },
      { status: 500 }
    );
  }

  // Costruisce il corpo completo della lettera. generaTestoLettera include
  // già il testo introduttivo del volontario (se presente), garantendo
  // coerenza tra anteprima (lettera/route.ts) e invio reale.
  const letteraContext = await buildLetteraContextFromSegnalazione(id);
  const testoPec = generaTestoLettera(letteraContext);

  // Raccoglie gli allegati fotografici e documentali della segnalazione
  // per includerli nella PEC come attachment SMTP. Le foto sono prove
  // visive essenziali della non conformità segnalata.
  const allegati = await db.allegato.findMany({
    where: { segnalazioneId: id, tipo: { in: ["foto", "documento"] } },
    orderBy: { createdAt: "asc" },
  });
  const smtpAttachments: nodemailer.SendMailOptions["attachments"] = [];
  for (const a of allegati) {
    // L4: path traversal protection centralizzata in path-guard.ts.
    // Parse + validazione segmenti (nessun `..`, `/`, `\`).
    const parsed = parseUrlStorageSicuro(a.urlStorage);
    if (!parsed) continue;
    if (parsed.segnalazioneId !== id) continue;
    // parsed è già validato, risolviPathAllegatoSicuro restituisce sempre
    // un path non null. Cast sicuro perché i segmenti sono già validati.
    const filePath = risolviPathAllegatoSicuro(
      parsed.segnalazioneId,
      parsed.filename
    ) as string;
    try {
      await readFile(filePath);
      smtpAttachments.push({
        filename: a.nomeOriginale.replace(/[^\w.\- ]/g, "_").slice(0, 100),
        path: filePath,
      });
    } catch {
      // File mancante: salta questo allegato
    }
  }

  // Invio SMTP effettivo (mock in assenza di credenziali configurate)
  let esito: "ok" | "errore" = "ok";
  let messaggioErrore: string | null = null;

  const pecHost = process.env.PEC_SMTP_HOST;
  if (pecHost) {
    try {
      // Invio SMTP reale: configurare PEC_SMTP_HOST, PEC_SMTP_PORT,
      // PEC_SMTP_USER, PEC_SMTP_PASSWORD, PEC_FROM nel file .env
      const transporter = nodemailer.createTransport({
        host: pecHost,
        port: Number(process.env.PEC_SMTP_PORT ?? 465),
        secure: true,
        auth: {
          user: process.env.PEC_SMTP_USER,
          pass: process.env.PEC_SMTP_PASSWORD,
        },
      });
      await transporter.sendMail({
        from: fromAddress,
        to: destinatari.join(", "),
        subject: segnalazione.oggettoPec ?? "Segnalazione",
        text: testoPec,
        attachments: smtpAttachments,
      });
    } catch (e) {
      esito = "errore";
      messaggioErrore = e instanceof Error ? e.message : String(e);
    }
  } else {
    // Modalità demo: simula l'invio con un piccolo ritardo
    logger.info(
      { segnalazioneId: segnalazione.id, destinatari },
      "[DEMO] Invio PEC simulato"
    );
    await new Promise((r) => setTimeout(r, 400));
  }

  // Log invio. Il tipo distingue invio reale (SMTP configurato) da demo
  // (PEC_SMTP_HOST non configurato), per un audit trail accurato.
  await db.logInvioPec.create({
    data: {
      segnalazioneId: id,
      tipo: pecHost ? "reale" : "demo",
      destinatari: destinatari.join(";"),
      oggetto: segnalazione.oggettoPec ?? "",
      esito,
      messaggioErrore,
    },
  });

  if (esito === "errore") {
    // M4: non rivelare dettagli SMTP al client; l'errore è nel log DB
    return NextResponse.json(
      { error: "Errore durante l'invio della PEC. Il dettaglio è registrato nei log di sistema. Contatta l'amministrazione se il problema persiste." },
      { status: 500 }
    );
  }

  // Update atomica con clausola WHERE su stato="approvata": previene race
  // condition tra findUnique e update (lo stato potrebbe cambiare
  // concorrentemente, ad es. un admin cambia stato manualmente). Se count=0,
  // lo stato è cambiato: 409 Conflict. L'invio SMTP è già avvenuto, ma lo
  // stato non viene aggiornato → l'audit trail resta coerente (log PEC
  // registrato, segnalazione resta "approvata", l'utente può ritentare).
  const result = await db.segnalazione.updateMany({
    where: { id, stato: "approvata" },
    data: {
      stato: "inviata",
      numeroProtocollo,
      dataInvio: new Date(),
    },
  });
  if (result.count === 0) {
    // Race condition: lo stato non è più "approvata" (qualcuno lo ha
    // cambiato concorrentemente tra findUnique e updateMany). L'invio
    // SMTP è avvenuto e il numero di protocollo è stato comunque
    // assegnato alla segnalazione (campo `numeroProtocollo` salvato
    // persistentemente dalla funzione `generaNumeroProtocollo`).
    // Lo stato NON è transitato a "inviata": l'utente deve ricaricare
    // e verificare. Lo esponiamo esplicitamente per evitare che l'utente
    // ritenti l'invio credendo che non sia avvenuto, generando un
    // secondo invio SMTP duplicato con un nuovo numero di protocollo.
    return NextResponse.json(
      {
        error:
          "La segnalazione non è più in stato 'approvata' (modifica concorrente). " +
          `ATTENZIONE: l'invio SMTP è AVVENUTO e il numero di protocollo "${numeroProtocollo}" ` +
          "è stato comunque assegnato alla segnalazione. Lo stato NON è transitato a 'inviata'. " +
          "Non ritentare l'invio (genererebbe un duplicato PEC con nuovo protocollo). " +
          "Ricarica la pagina e verifica lo stato attuale, o contatta l'amministrazione.",
        protocolloAssegnato: numeroProtocollo,
        invioSmtpAvvenuto: true,
      },
      { status: 409 }
    );
  }

  const aggiornata = await db.segnalazione.findUnique({ where: { id } });

  await db.storicoStato.create({
    data: {
      segnalazioneId: id,
      statoPrecedente: "approvata",
      statoNuovo: "inviata",
      userId: user.id,
      nota: `PEC inviata a: ${destinatari.join(", ")}. Protocollo: ${numeroProtocollo}`,
    },
  });

  // Notifica email al volontario e referente (async, non bloccante)
  void notificaPecInviata(id);

  return NextResponse.json({
    segnalazione: aggiornata,
    destinatari,
    numeroProtocollo,
  });
}
