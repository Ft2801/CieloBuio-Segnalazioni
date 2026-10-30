/**
 * API: POST /api/segnalazioni/[id]/invia-pec
 *
 * Invio reale della PEC al Comune (e ad ARPA se richiesto).
 * Transizione: approvata -> inviata.
 *
 * Sequenza:
 *  1. Autenticazione, permesso di invio e rate limit (5 invii/ora per utente).
 *  2. Lock applicativo per segnalazione: una seconda richiesta concorrente
 *     riceve 409 invece di inviare un'altra PEC.
 *  3. Verifica di stato, competenza territoriale e validità dei destinatari
 *     e del mittente. Tutti i controlli precedono la generazione del numero
 *     di protocollo e l'invio.
 *  4. Generazione del numero di protocollo definitivo (se mancante). Il numero
 *     viene assegnato alla segnalazione prima dell'invio: se l'invio fallisce,
 *     resta assegnato e il tentativo successivo riusa lo stesso numero.
 *  5. Invio SMTP. Senza configurazione SMTP la richiesta è rifiutata con 503 e
 *     nessuno stato cambia: una PEC non spedita non risulta mai come inviata.
 *  6. Registrazione obbligatoria del tentativo prima di SMTP: un crash o un
 *     esito incerto non possono generare un secondo invio automatico.
 *  7. Transizione di stato e storico in un'unica transazione, con
 *     clausola WHERE stato = 'approvata'.
 *
 * Vincolo tecnico: i messaggi PEC non supportano il CCN verso indirizzi PEC,
 * quindi tutti i destinatari vanno in TO o CC.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getSessionUser, canSendPec, hasTerritorialCompetence } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import { ErroreProtocollo, generaNumeroProtocollo } from "@/lib/protocollo";
import { notificaPecInviata } from "@/lib/notifiche";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildLetteraContextFromSegnalazione, generaTestoLettera, PEC_MITTENTE_NON_CONFIGURATA } from "@/lib/lettera";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro, verificaPercorsoFisicoAllegato } from "@/lib/path-guard";
import { leggiConfigurazioneSmtp, getTransporter } from "@/lib/smtp";
import { logger } from "@/lib/logger";
import { messaggioDaErrore } from "@/lib/errori";

type Params = { params: Promise<{ id: string }> };

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Lease dell'invio PEC persistito nel database: impedisce che due richieste
// concorrenti (doppio clic, retry del browser) inviino due PEC reali al
// Comune, anche con più istanze dell'app. Un lock più vecchio di
// PEC_LOCK_TTL_MS è orfano (crash del processo) e può essere riacquisito.
const PEC_LOCK_TTL_MS = 10 * 60 * 1000;

async function acquisisciLock(id: string, token: string): Promise<boolean> {
  const { count } = await db.segnalazione.updateMany({
    where: {
      id,
      OR: [{ invioPecLockToken: null }, { invioPecLockAt: { lt: new Date(Date.now() - PEC_LOCK_TTL_MS) } }],
    },
    data: { invioPecLockToken: token, invioPecLockAt: new Date() },
  });
  return count === 1;
}

/** true se il percorso esiste ed è un file leggibile. */
async function fileLeggibile(filePath: string): Promise<boolean> {
  try {
    await verificaPercorsoFisicoAllegato(filePath);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function rilasciaLock(id: string, token: string): Promise<void> {
  try {
    await db.segnalazione.updateMany({
      where: { id, invioPecLockToken: token },
      data: { invioPecLockToken: null, invioPecLockAt: null },
    });
  } catch (err) {
    // Il lock scade comunque da solo (PEC_LOCK_TTL_MS): il fallimento è solo loggato.
    logger.error({ err, segnalazioneId: id }, "Rilascio del lock invio PEC non riuscito");
  }
}

/** Forma minima di un indirizzo: parte locale, @, dominio con almeno un punto. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canSendPec(user)) {
    return NextResponse.json({ error: "Non autorizzato all'invio PEC" }, { status: 403 });
  }

  const rl = checkRateLimit(
    `pec:${user.id}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppi invii PEC. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const token = randomUUID();
  if (!(await acquisisciLock(id, token))) {
    const esiste = await db.segnalazione.findUnique({ where: { id }, select: { id: true } });
    if (!esiste) {
      return NextResponse.json({ error: "Non trovata" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Invio PEC già in corso per questa segnalazione. Attendere l'esito prima di riprovare." },
      { status: 409 },
    );
  }

  try {
    return await inviaPecSegnalazione(user, id, token);
  } finally {
    await rilasciaLock(id, token);
  }
}

async function inviaPecSegnalazione(user: SessionUser, id: string, token: string): Promise<NextResponse> {
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

  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato per questa segnalazione" }, { status: 403 });
  }

  if (segnalazione.stato !== "approvata") {
    return NextResponse.json({ error: "La segnalazione deve essere prima approvata" }, { status: 400 });
  }

  // Un tentativo iniziato, incerto o concluso può aver già consegnato la
  // PEC, anche se un crash ha lasciato lo stato della pratica invariato.
  // Il controllo viene ripetuto nella transazione di prenotazione.
  const invioPrecedente = await db.logInvioPec.findFirst({
    where: { segnalazioneId: id, tipo: "reale", esito: { in: ["in_corso", "incerto", "ok"] } },
    select: { id: true },
  });
  if (invioPrecedente) {
    return NextResponse.json(
      { error: "Esiste già un tentativo di invio PEC. Verificare l'esito nella casella PEC prima di riprovare." },
      { status: 409 },
    );
  }

  // La PEC è indirizzata al Comune. Senza la sua PEC non si invia nulla: ARPA
  // e CC aggiuntive non sostituiscono il destinatario principale, altrimenti la
  // segnalazione risulterebbe "inviata" senza che il Comune la riceva.
  if (!segnalazione.comune?.pecComune) {
    return NextResponse.json(
      {
        error:
          "Il Comune non ha una PEC configurata: completare i dati dal pannello di amministrazione prima dell'invio.",
      },
      { status: 400 },
    );
  }

  // Destinatari (TO + CC, mai BCC per le PEC).
  const destinatari: string[] = [segnalazione.comune.pecComune];
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

  const destinatariNonValidi = destinatari.filter((d) => !EMAIL_RE.test(d));
  if (destinatariNonValidi.length > 0) {
    return NextResponse.json(
      {
        error: `Impossibile inviare PEC: indirizzi non validi: ${destinatariNonValidi.join(", ")}. Correggerli dal pannello di amministrazione.`,
      },
      { status: 400 },
    );
  }

  // Senza configurazione SMTP la PEC non può essere spedita: la richiesta è
  // rifiutata prima di qualsiasi modifica (nessun protocollo, nessuno stato).
  const smtp = leggiConfigurazioneSmtp();
  if (!smtp) {
    return NextResponse.json(
      { error: "Servizio di posta non configurato: la PEC non può essere inviata. Contatta l'amministrazione." },
      { status: 503 },
    );
  }

  // Mittente: PEC_FROM ha la precedenza, poi la PEC dell'utente. Una stringa
  // vuota è trattata come "non configurata".
  const fromAddress = smtp.from || user.pec || undefined;
  // Con mittente non visibile la lettera riporta la PEC dell'associazione
  // (PEC_FROM): senza di essa il testo inviato al Comune sarebbe incompleto.
  if (!segnalazione.mittenteVisibile && !smtp.from) {
    return NextResponse.json(
      { error: "Mittente non visibile: occorre configurare PEC_FROM con la PEC dell'associazione prima di inviare." },
      { status: 400 },
    );
  }
  if (!fromAddress) {
    return NextResponse.json(
      { error: "Mittente PEC non configurato. Imposta PEC_FROM nel file .env o assegna una PEC all'utente." },
      { status: 500 },
    );
  }

  // Allegati (foto e documenti) come attachment SMTP. Il controllo avviene
  // prima della generazione del protocollo: un allegato non valido non consuma
  // un numero e non lascia tracce.
  const allegati = await db.allegato.findMany({
    where: { segnalazioneId: id, tipo: { in: ["foto", "documento"] } },
    orderBy: { createdAt: "asc" },
  });
  // Ogni allegato registrato deve essere presente e leggibile: una PEC senza
  // una foto o un documento che la segnalazione dichiara non viene inviata.
  const smtpAttachments: { filename: string; path: string }[] = [];
  for (const a of allegati) {
    const parsed = parseUrlStorageSicuro(a.urlStorage);
    const filePath =
      parsed && parsed.segnalazioneId === id ? risolviPathAllegatoSicuro(parsed.segnalazioneId, parsed.filename) : null;
    if (!filePath || !(await fileLeggibile(filePath))) {
      logger.error({ segnalazioneId: id, allegatoId: a.id }, "Allegato non leggibile: invio PEC annullato");
      return NextResponse.json(
        {
          error: `Allegato "${a.nomeOriginale}" non disponibile sul server: PEC non inviata. Contattare l'amministrazione.`,
        },
        { status: 500 },
      );
    }
    smtpAttachments.push({
      filename: a.nomeOriginale.replace(/[^\w.\- ]/g, "_").slice(0, 100),
      path: filePath,
    });
  }

  // Numero di protocollo: generato solo dopo che tutti i controlli sono superati.
  let numeroProtocollo = segnalazione.numeroProtocollo;
  if (!numeroProtocollo) {
    // Dopo anonimizzazione GDPR il volontario può essere null: manca il
    // segnalatore, quindi non è possibile generare un nuovo protocollo.
    if (!segnalazione.volontario || !segnalazione.volontarioId) {
      return NextResponse.json(
        { error: "Segnalazione anonimizzata: impossibile generare un numero di protocollo" },
        { status: 400 },
      );
    }
    if (!regione || !segnalazione.provincia) {
      return NextResponse.json({ error: "Regione o provincia non determinabile" }, { status: 400 });
    }
    try {
      numeroProtocollo = await generaNumeroProtocollo({
        data: segnalazione.dataSegnalazione,
        regione: regione.regione,
        provinciaSigla: segnalazione.provincia.sigla,
        segnalatoreId: segnalazione.volontarioId,
        segnalatoreNomeCognome: segnalazione.volontario.nomeCognome,
        inizialiProtocollo: segnalazione.volontario.inizialiProtocollo,
        segnalazioneId: segnalazione.id,
      });
    } catch (e) {
      if (e instanceof ErroreProtocollo) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      // Errore non previsto prima dell'invio: nessuna PEC è partita, quindi la risposta 500 è sicura.
      logger.error({ err: e, segnalazioneId: id }, "Generazione del numero di protocollo fallita");
      return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
    }
  }

  // Corpo della lettera: generaTestoLettera include il testo introduttivo del
  // volontario, così anteprima (lettera/route.ts) e invio reale coincidono.
  const letteraContext = await buildLetteraContextFromSegnalazione(id);
  const testoPec = generaTestoLettera(letteraContext);
  if (testoPec.includes(PEC_MITTENTE_NON_CONFIGURATA)) {
    return NextResponse.json(
      { error: "Indirizzo PEC del mittente non configurato. Imposta PEC_FROM prima di inviare." },
      { status: 400 },
    );
  }

  // La prenotazione è persistente e precedente all'invio. La transazione
  // serializza i tentativi sul lock della pratica e rifiuta una prenotazione
  // esistente anche se il lease temporaneo è scaduto. Se il DB non riesce a
  // salvarla, nessuna richiesta SMTP viene eseguita.
  let tentativo: { id: string } | null;
  try {
    tentativo = await db.$transaction(async (tx) => {
      const corrente = await tx.segnalazione.updateMany({
        where: { id, stato: "approvata", invioPecLockToken: token },
        data: { invioPecLockAt: new Date() },
      });
      if (corrente.count !== 1) return null;
      const giaInviata = await tx.logInvioPec.findFirst({
        where: { segnalazioneId: id, tipo: "reale", esito: { in: ["in_corso", "incerto", "ok"] } },
        select: { id: true },
      });
      if (giaInviata) return null;
      return tx.logInvioPec.create({
        data: {
          segnalazioneId: id,
          tipo: "reale",
          destinatari: destinatari.join(";"),
          oggetto: segnalazione.oggettoPec ?? "",
          esito: "in_corso",
          messaggioErrore: null,
        },
      });
    });
  } catch (e) {
    logger.error({ err: e, segnalazioneId: id }, "Prenotazione invio PEC fallita prima di SMTP");
    return NextResponse.json(
      { error: "Impossibile registrare il tentativo PEC: nessun invio effettuato." },
      { status: 503 },
    );
  }
  if (!tentativo) {
    return NextResponse.json(
      { error: "Stato, lease o esito PEC modificati durante la preparazione. Non ripetere l'invio senza verifica." },
      { status: 409 },
    );
  }

  try {
    const risposta = await getTransporter(smtp).sendMail({
      from: fromAddress,
      to: destinatari.join(", "),
      subject: segnalazione.oggettoPec ?? "Segnalazione",
      text: testoPec,
      attachments: smtpAttachments,
    });
    // Nodemailer può risolvere la Promise quando accetta almeno un CC ma
    // rifiuta il Comune. Anche una consegna parziale richiede riconciliazione.
    if (!destinatari.every((dest) => risposta.accepted?.some((a) => a.toLowerCase() === dest.toLowerCase()))) {
      throw new Error("Il server SMTP non ha accettato tutti i destinatari PEC");
    }
  } catch (e) {
    logger.error({ err: e, segnalazioneId: id }, "Esito invio PEC incerto o consegna parziale");
    try {
      await db.logInvioPec.update({
        where: { id: tentativo.id },
        data: { esito: "incerto", messaggioErrore: messaggioDaErrore(e) },
      });
    } catch (logErr) {
      // Il record in_corso resta comunque a bloccare i retry automatici.
      logger.error({ err: logErr, segnalazioneId: id }, "Registrazione esito incerto PEC fallita");
    }
    return NextResponse.json(
      {
        error:
          "Esito PEC incerto. Non ritentare l'invio: verificare prima la casella PEC e i log con l'amministrazione.",
        invioSmtpIncerto: true,
        protocolloAssegnato: numeroProtocollo,
      },
      { status: 500 },
    );
  }

  // Il record in_corso blocca i retry anche se l'aggiornamento del log
  // fallisce dopo la consegna. Non far dipendere la transizione dallo storico.
  try {
    await db.logInvioPec.update({ where: { id: tentativo.id }, data: { esito: "ok", messaggioErrore: null } });
  } catch (e) {
    logger.error({ err: e, segnalazioneId: id }, "Registrazione esito positivo PEC fallita");
  }

  // Transizione di stato e storico nella stessa transazione. Se lo stato non è
  // più "approvata" (modifica concorrente), la transazione non scrive nulla.
  let transizione: boolean;
  try {
    transizione = await db.$transaction(async (tx) => {
      const result = await tx.segnalazione.updateMany({
        where: { id, stato: "approvata", invioPecLockToken: token },
        data: { stato: "inviata", numeroProtocollo, dataInvio: new Date() },
      });
      if (result.count === 0) return false;
      await tx.storicoStato.create({
        data: {
          segnalazioneId: id,
          statoPrecedente: "approvata",
          statoNuovo: "inviata",
          userId: user.id,
          nota: `PEC inviata a: ${destinatari.join(", ")}. Protocollo: ${numeroProtocollo}`,
        },
      });
      return true;
    });
  } catch (e) {
    logger.error({ err: e, segnalazioneId: id }, "Aggiornamento stato dopo invio PEC fallito");
    return NextResponse.json(
      {
        error: `La PEC è stata inviata ma lo stato della segnalazione non è stato aggiornato. Non ritentare l'invio. Protocollo assegnato: ${numeroProtocollo}. Contatta l'amministrazione.`,
        protocolloAssegnato: numeroProtocollo,
        invioSmtpAvvenuto: true,
      },
      { status: 500 },
    );
  }

  if (!transizione) {
    return NextResponse.json(
      {
        error:
          "La segnalazione non è più in stato 'approvata' (modifica concorrente). " +
          `ATTENZIONE: l'invio SMTP è AVVENUTO con protocollo "${numeroProtocollo}", ` +
          "ma lo stato NON è transitato a 'inviata'. Il protocollo resta assegnato alla pratica. " +
          "Non ritentare l'invio (genererebbe un duplicato PEC). " +
          "Ricarica la pagina e verifica lo stato attuale, o contatta l'amministrazione.",
        protocolloAssegnato: numeroProtocollo,
        invioSmtpAvvenuto: true,
      },
      { status: 409 },
    );
  }

  const aggiornata = await db.segnalazione.findUnique({ where: { id } });

  // Notifica email al volontario e al referente. Non bloccante: gli errori sono loggati.
  notificaPecInviata(id).catch((e: unknown) => {
    logger.error({ err: e, segnalazioneId: id }, "Notifica dopo invio PEC fallita");
  });

  return NextResponse.json({
    segnalazione: aggiornata,
    destinatari,
    numeroProtocollo,
  });
}
