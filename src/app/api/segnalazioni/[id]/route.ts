/**
 * API: GET    /api/segnalazioni/[id]
 *      PUT    /api/segnalazioni/[id]
 *      DELETE /api/segnalazioni/[id]
 *
 * Dettaglio, modifica ed eliminazione di una segnalazione.
 * - Volontario: può modificare solo le proprie bozze
 * - Referente: può modificare bozze/in_revisione della propria zona
 * - Admin: accesso completo
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, canViewSegnalazione, hasTerritorialCompetence } from "@/lib/auth";
import {
  segnalazionePecSchema,
  segnalazioneFlagSchema,
  validaPecCcAggiuntive,
  validate,
  capSchema,
} from "@/lib/validation";
import { isSafePathSegment, UPLOADS_ROOT } from "@/lib/path-guard";
import { rm } from "fs/promises";
import path from "path";
import { logger } from "@/lib/logger";
import { prossimaVersione, versioneCorrisponde } from "@/lib/versione";
import { MAX_ID_DB } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

const STATI_NON_MODIFICABILI = ["approvata", "inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"];

// Minimizzazione dei dati (GDPR, art. 5 c. 1 lett. c): la risposta contiene
// solo identificativo e nome del volontario e del referente approvatore.
// PEC, e-mail, indirizzo, firma, passwordHash e campi TOTP non vengono mai
// trasmessi con il dettaglio della segnalazione. Le comunicazioni con il
// volontario avvengono server-side (notifiche e invio PEC).
const VOLONTARIO_PUBBLICO = {
  select: { id: true, nomeCognome: true },
} as const;

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({
    where: { id },
    include: {
      comune: true,
      provincia: { include: { regione: true } },
      regione: true,
      // select esplicita: esclude passwordHash, totpSecret, totpVerifiedAt
      volontario: VOLONTARIO_PUBBLICO,
      referenteApprovatore: VOLONTARIO_PUBBLICO,
      allegati: true,
      storicoStati: {
        orderBy: { timestamp: "asc" },
        include: { user: { select: { id: true, nomeCognome: true, ruolo: true } } },
      },
    },
  });

  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // Verifica visibilità con helper centralizzato (canViewSegnalazione).
  // Il comportamento è fail-closed: un referente senza territorio
  // assegnato non vede segnalazioni slegate dal territorio.
  if (!canViewSegnalazione(user, segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Impedisci caching della risposta (contiene PII del volontario):
  // un cache hit in un proxy intermedio potrebbe servire i dati di un
  // utente a un altro. private=no-store è la policy più restrittiva.
  return NextResponse.json({ segnalazione }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({ where: { id } });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // Solo il volontario proprietario può modificare le proprie bozze.
  // I referenti possono modificare in fase di revisione, con competenza
  // territoriale verificata tramite l'helper centralizzato (fail-closed).
  // Il volontario proprietario può modificare SOLO in stato "bozza":
  // una volta inviata in revisione, il pacchetto probatorio è congelato
  // (coerente con DELETE /api/allegati che usa isOwnerInBozza).
  const isOwner = segnalazione.volontarioId === user.id;
  const isReviewerForThis = canReviewSegnalazioni(user) && hasTerritorialCompetence(user, segnalazione);

  if (!isOwner && !isReviewerForThis) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Il volontario proprietario può modificare solo in stato "bozza".
  // In "in_revisione" solo il referente può modificare (modifiche testuali
  // alla segnalazione durante la fase di revisione).
  if (isOwner && !isReviewerForThis && segnalazione.stato !== "bozza") {
    return NextResponse.json(
      { error: "Il volontario può modificare la segnalazione solo in stato bozza" },
      { status: 400 },
    );
  }

  // Stati terminali: nessuno può modificare dopo approvazione o invio.
  if (STATI_NON_MODIFICABILI.includes(segnalazione.stato)) {
    return NextResponse.json(
      { error: "Segnalazione non più modificabile dopo l'approvazione o l'invio" },
      { status: 400 },
    );
  }

  if (!versioneCorrisponde(req.headers.get("if-match"), segnalazione.updatedAt)) {
    return NextResponse.json({ error: "La segnalazione è cambiata. Ricarica la pagina." }, { status: 409 });
  }

  try {
    const body: Record<string, unknown> | null = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
    }

    // Il confronto include la versione caricata dal client: leggere soltanto
    // updatedAt qui non rileverebbe una modifica già conclusa in un'altra scheda.
    if (body.updatedAt !== undefined) {
      if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) {
        return NextResponse.json({ error: "Versione della segnalazione non valida" }, { status: 400 });
      }
      if (Date.parse(body.updatedAt) !== segnalazione.updatedAt.getTime()) {
        return NextResponse.json(
          { error: "La segnalazione è stata modificata. Ricarica la pagina prima di salvare." },
          { status: 409 },
        );
      }
    }

    // Validazione dei campi PEC con zod (anti-CRLF injection), coerente
    // con la POST: la stessa protezione vale anche in modifica.
    const pecValidation = validate(segnalazionePecSchema, {
      oggettoPec: body.oggettoPec,
      testoIntroduttivoPec: body.testoIntroduttivoPec,
      pecCcAggiuntive: body.pecCcAggiuntive,
      destinatarioNome: body.destinatarioNome,
    });
    if (!pecValidation.success) {
      return NextResponse.json({ error: pecValidation.error }, { status: 400 });
    }
    const flagValidation = validate(segnalazioneFlagSchema, body);
    if (!flagValidation.success) {
      return NextResponse.json({ error: flagValidation.error }, { status: 400 });
    }
    const ccValidation = validaPecCcAggiuntive(body.pecCcAggiuntive);
    if (!ccValidation.ok) {
      return NextResponse.json({ error: ccValidation.error }, { status: 400 });
    }
    const pecCcAggiuntiveNormalized = ccValidation.emails.length > 0 ? ccValidation.emails.join("; ") : null;

    // provinciaId, regioneId derivano SEMPRE dal comune associato,
    // mai dal body. Questo previene che un volontario (via chiamata API
    // diretta) assegni la segnalazione a una provincia/regione diversa da
    // quella del comune reale, alterando il routing PEC e la competenza
    // territoriale.
    let provinciaId = segnalazione.provinciaId;
    let regioneId = segnalazione.regioneId;
    let destinatarioNome =
      body.destinatarioNome !== undefined ? pecValidation.data.destinatarioNome : segnalazione.destinatarioNome;

    // Il Comune resta obbligatorio anche in modifica. Rimuoverlo farebbe
    // perdere il routing territoriale e la destinazione della lettera PEC.
    let comuneIdValue: number | undefined;
    if (body.comuneId !== undefined) {
      if (
        typeof body.comuneId !== "number" ||
        !Number.isSafeInteger(body.comuneId) ||
        body.comuneId <= 0 ||
        body.comuneId > MAX_ID_DB
      ) {
        return NextResponse.json({ error: "comuneId non valido (deve essere un intero positivo)" }, { status: 400 });
      }
      comuneIdValue = body.comuneId;
    } else if (segnalazione.comuneId === null) {
      return NextResponse.json({ error: "Comune obbligatorio" }, { status: 400 });
    }

    // Indirizzo: se fornito deve essere non vuoto e non superare 500 caratteri,
    // come in creazione (POST /api/segnalazioni).
    let indirizzoVia = segnalazione.indirizzoVia;
    if (body.indirizzoVia !== undefined) {
      const indirizzoTrim = typeof body.indirizzoVia === "string" ? body.indirizzoVia.trim() : "";
      if (!indirizzoTrim || indirizzoTrim.length > 500) {
        return NextResponse.json({ error: "Indirizzo obbligatorio (max 500 caratteri)" }, { status: 400 });
      }
      indirizzoVia = indirizzoTrim;
    }

    // CAP: validato tramite capSchema (5 cifre) quando fornito dal body.
    // Se non fornito, viene derivato dal comune (sotto) o mantenuto esistente.
    let cap: string | null = segnalazione.cap;
    if (body.cap !== undefined && body.cap !== null && typeof body.cap !== "string") {
      return NextResponse.json({ error: "CAP non valido: deve essere una stringa di 5 cifre" }, { status: 400 });
    }
    if (typeof body.cap === "string" && body.cap.trim() !== "") {
      const capResult = capSchema.safeParse(body.cap.trim());
      if (!capResult.success) {
        return NextResponse.json({ error: capResult.error.issues[0].message }, { status: 400 });
      }
      cap = capResult.data;
    } else if (body.cap === null) {
      cap = null;
    }

    if (comuneIdValue !== undefined && comuneIdValue !== segnalazione.comuneId) {
      const comune = await db.comune.findUnique({
        where: { id: comuneIdValue },
        include: { provincia: { include: { regione: true } } },
      });
      if (!comune) {
        return NextResponse.json({ error: "Comune non trovato" }, { status: 400 });
      }
      // Un referente può scegliere solo un Comune nella propria area.
      // Altrimenti la pratica uscirebbe dalla sua competenza durante il salvataggio.
      if (
        canReviewSegnalazioni(user) &&
        !hasTerritorialCompetence(user, {
          provinciaId: comune.provinciaId,
          regioneId: comune.provincia.regioneId,
        })
      ) {
        return NextResponse.json({ error: "Comune fuori dalla propria competenza territoriale" }, { status: 403 });
      }
      // Quando il comune cambia, deriviamo cap, provincia e regione
      // dal nuovo comune SOLO se il body non ha fornito un CAP esplicito.
      // Il CAP fornito dall'utente prevale sul default del comune.
      if (typeof body.cap !== "string" || body.cap.trim() === "") {
        cap = comune.cap;
      }
      provinciaId = comune.provinciaId;
      regioneId = comune.provincia.regioneId;
      if (!destinatarioNome && comune.nomeSindaco) {
        destinatarioNome = `Sindaco ${comune.nomeSindaco}`;
      }
    }

    // Validazione range latitudine/longitudine nei valori geografici reali.
    // Coordinate: entrambe numeriche e finite, oppure entrambe null per
    // rimuoverle. Se il campo è omesso si mantiene il valore esistente.
    let latitudine = segnalazione.latitudine;
    let longitudine = segnalazione.longitudine;
    if (body.latitudine === null && body.longitudine === null) {
      latitudine = null;
      longitudine = null;
    } else if (typeof body.latitudine === "number" && typeof body.longitudine === "number") {
      if (!Number.isFinite(body.latitudine) || body.latitudine < -90 || body.latitudine > 90) {
        return NextResponse.json({ error: "Latitudine non valida (deve essere tra -90 e +90)" }, { status: 400 });
      }
      if (!Number.isFinite(body.longitudine) || body.longitudine < -180 || body.longitudine > 180) {
        return NextResponse.json({ error: "Longitudine non valida (deve essere tra -180 e +180)" }, { status: 400 });
      }
      latitudine = body.latitudine;
      longitudine = body.longitudine;
    } else if (body.latitudine !== undefined || body.longitudine !== undefined) {
      return NextResponse.json(
        { error: "Latitudine e longitudine devono essere entrambe numeriche o entrambe assenti" },
        { status: 400 },
      );
    }

    // Confronto ottimistico sul record letto: anche due autosalvataggi nello
    // stesso stato non devono sovrascriversi a vicenda con valori obsoleti.
    // PostgreSQL conserva updatedAt con precisione al millisecondo: se due
    // salvataggi avvengono nello stesso millisecondo, l'@updatedAt automatico
    // può restare uguale e permettere a entrambi di superare il confronto.
    // La versione esplicita cresce sempre di almeno 1 ms, anche con clock
    // fermo, e Prisma la conserva senza sostituirla con il timestamp automatico.
    // Il controllo su proprietario e territorio impedisce inoltre che un
    // cambio concorrente di assegnazione applichi dati fuori competenza.
    const nuovoAggiornamento = prossimaVersione(segnalazione.updatedAt);
    const result = await db.segnalazione.updateMany({
      where: {
        id,
        stato: segnalazione.stato,
        updatedAt: segnalazione.updatedAt,
        volontarioId: segnalazione.volontarioId,
        provinciaId: segnalazione.provinciaId,
        regioneId: segnalazione.regioneId,
      },
      data: {
        updatedAt: nuovoAggiornamento,
        indirizzoVia,
        comuneId: comuneIdValue !== undefined ? comuneIdValue : segnalazione.comuneId,
        cap,
        provinciaId,
        regioneId,
        latitudine,
        longitudine,
        nomeEsercizio:
          typeof body.nomeEsercizio === "string" ? body.nomeEsercizio.slice(0, 200) : segnalazione.nomeEsercizio,
        // I flag sono già validati come booleani JSON: ?? mantiene false
        // quando l'utente deseleziona una casella e preserva il valore
        // esistente soltanto se il campo è assente.
        chkVetroPianoInclinato: flagValidation.data.chkVetroPianoInclinato ?? segnalazione.chkVetroPianoInclinato,
        chkVetroCurvo: flagValidation.data.chkVetroCurvo ?? segnalazione.chkVetroCurvo,
        chkAltroTipologia: flagValidation.data.chkAltroTipologia ?? segnalazione.chkAltroTipologia,
        notaAltroTipologia:
          typeof body.notaAltroTipologia === "string"
            ? body.notaAltroTipologia.slice(0, 500)
            : segnalazione.notaAltroTipologia,
        chkLuceVersoAlto: flagValidation.data.chkLuceVersoAlto ?? segnalazione.chkLuceVersoAlto,
        chkAbbagliamento: flagValidation.data.chkAbbagliamento ?? segnalazione.chkAbbagliamento,
        chkLuceIntrusiva: flagValidation.data.chkLuceIntrusiva ?? segnalazione.chkLuceIntrusiva,
        chkAltroProblema: flagValidation.data.chkAltroProblema ?? segnalazione.chkAltroProblema,
        notaAltroProblema:
          typeof body.notaAltroProblema === "string"
            ? body.notaAltroProblema.slice(0, 500)
            : segnalazione.notaAltroProblema,
        descrizioneLibera:
          typeof body.descrizioneLibera === "string"
            ? body.descrizioneLibera.slice(0, 5000)
            : segnalazione.descrizioneLibera,
        destinatarioNome,
        includiArpa: flagValidation.data.includiArpa ?? segnalazione.includiArpa,
        pecCcAggiuntive: body.pecCcAggiuntive !== undefined ? pecCcAggiuntiveNormalized : segnalazione.pecCcAggiuntive,
        oggettoPec: body.oggettoPec !== undefined ? pecValidation.data.oggettoPec : segnalazione.oggettoPec,
        testoIntroduttivoPec:
          body.testoIntroduttivoPec !== undefined
            ? pecValidation.data.testoIntroduttivoPec
            : segnalazione.testoIntroduttivoPec,
        mittenteVisibile:
          flagValidation.data.mittenteVisibile !== undefined
            ? flagValidation.data.mittenteVisibile !== false && flagValidation.data.mittenteVisibile !== "false"
            : segnalazione.mittenteVisibile,
      },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "La segnalazione è stata modificata concorrentemente. Ricarica la pagina." },
        { status: 409 },
      );
    }

    // updateMany restituisce solo il conteggio: si rilegge il record aggiornato.
    const aggiornata = await db.segnalazione.findUnique({
      where: { id },
      include: {
        comune: true,
        provincia: { include: { regione: true } },
        regione: true,
        volontario: VOLONTARIO_PUBBLICO,
        referenteApprovatore: VOLONTARIO_PUBBLICO,
        allegati: true,
      },
    });

    return NextResponse.json({ segnalazione: aggiornata }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    logger.error({ err: e }, "Errore aggiornamento segnalazione");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({ where: { id } });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // Solo il volontario proprietario può eliminare le proprie bozze, o admin
  if (segnalazione.volontarioId !== user.id && user.ruolo !== "admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  if (segnalazione.stato !== "bozza") {
    return NextResponse.json({ error: "Solo le bozze possono essere eliminate" }, { status: 400 });
  }

  if (!versioneCorrisponde(req.headers.get("if-match"), segnalazione.updatedAt)) {
    return NextResponse.json(
      { error: "La bozza è cambiata. Ricarica la pagina prima di eliminarla." },
      { status: 409 },
    );
  }

  // Usa deleteMany con clausola WHERE su stato="bozza" per evitare
  // race condition tra findUnique e delete (lo stato potrebbe cambiare
  // tra le due chiamate). Se deleteMany ritorna count=0, qualcuno ha
  // cambiato stato concorrentemente: rispondiamo 409 Conflict.
  const result = await db.segnalazione.deleteMany({
    where: {
      id,
      stato: "bozza",
      volontarioId: segnalazione.volontarioId,
      updatedAt: segnalazione.updatedAt,
      invioPecLockToken: null,
    },
  });
  if (result.count === 0) {
    return NextResponse.json(
      {
        error:
          "La segnalazione non è più una bozza (potrebbe essere stata modificata concorrentemente). Ricarica la pagina.",
      },
      { status: 409 },
    );
  }

  // Pulizia fisica degli allegati e della directory della segnalazione.
  // Eseguiamo in background per non bloccare la risposta, e ignoriamo
  // gli errori (il DB è già stato aggiornato; eventuali file orfani
  // saranno rimossi dal cron cleanupFileOrfani).
  //
  // L'ID della segnalazione è validato come segmento di path sicuro
  // (nessun `..`, `/`, `\`, `\0`, caratteri di controllo) prima di
  // essere usato in path.join, per difesa in profondità coerente
  // con path-guard.ts. Il path risultante viene verificato
  // esplicitamente dentro UPLOADS_ROOT come ulteriore defense-in-depth.
  // Gli allegati sono in storage/uploads/, directory privata fuori da public/,
  // quindi non servita come statica.
  void (async () => {
    try {
      if (isSafePathSegment(id)) {
        const uploadDir = path.join(UPLOADS_ROOT, id);
        // Doppio check defense-in-depth: il path risultante deve
        // essere dentro UPLOADS_ROOT (coerenza con path-guard.ts).
        if (uploadDir.startsWith(UPLOADS_ROOT + path.sep)) {
          await rm(uploadDir, { recursive: true, force: true });
        }
      }
    } catch (e) {
      // Logga ma non bloccare: il record DB è già eliminato.
      logger.warn(
        { segnalazioneId: id, err: e },
        "Impossibile eliminare la directory degli allegati durante DELETE segnalazione",
      );
    }
  })();

  return NextResponse.json({ ok: true });
}
