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
import {
  getSessionUser,
  canReviewSegnalazioni,
  canViewSegnalazione,
  hasTerritorialCompetence,
} from "@/lib/auth";
import { segnalazionePecSchema, validaPecCcAggiuntive, validate } from "@/lib/validation";
import { isSafePathSegment, UPLOADS_ROOT } from "@/lib/path-guard";
import { rm } from "fs/promises";
import path from "path";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

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
      volontario: true,
      referenteApprovatore: true,
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

  return NextResponse.json({ segnalazione });
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
  // In "in_revisione" solo il referente può modificare (fix minori).
  if (isOwner && segnalazione.stato !== "bozza") {
    return NextResponse.json(
      { error: "Il volontario può modificare la segnalazione solo in stato bozza" },
      { status: 400 }
    );
  }

  // Stati terminali: nessuno può modificare dopo approvazione o invio.
  if (["approvata", "inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"].includes(segnalazione.stato)) {
    return NextResponse.json(
      { error: "Segnalazione non più modificabile dopo l'approvazione o l'invio" },
      { status: 400 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Validazione dei campi PEC con zod (anti-CRLF injection), coerente
    // con la POST. In assenza di questa validazione, un client malevolo
    // potrebbe iniettare CRLF nei campi oggettoPec/destinatarioNome/
    // pecCcAggiuntive via PUT bypassando le protezioni della creazione.
    const pecValidation = validate(segnalazionePecSchema, {
      oggettoPec: body.oggettoPec,
      testoIntroduttivoPec: body.testoIntroduttivoPec,
      pecCcAggiuntive: body.pecCcAggiuntive,
      destinatarioNome: body.destinatarioNome,
    });
    if (!pecValidation.success) {
      return NextResponse.json({ error: pecValidation.error }, { status: 400 });
    }
    const ccValidation = validaPecCcAggiuntive(body.pecCcAggiuntive);
    if (!ccValidation.ok) {
      return NextResponse.json({ error: ccValidation.error }, { status: 400 });
    }
    const pecCcAggiuntiveNormalized =
      ccValidation.emails.length > 0 ? ccValidation.emails.join("; ") : null;

    // provinciaId, regioneId, cap derivano SEMPRE dal comune associato,
    // mai dal body. Questo previene che un volontario (via chiamata API
    // diretta) assegni la segnalazione a una provincia/regione diversa da
    // quella del comune reale, alterando il routing PEC e la competenza
    // territoriale.
    let provinciaId = segnalazione.provinciaId;
    let regioneId = segnalazione.regioneId;
    let cap = segnalazione.cap;
    let destinatarioNome = body.destinatarioNome !== undefined ? pecValidation.data.destinatarioNome : segnalazione.destinatarioNome;

    if (body.comuneId && body.comuneId !== segnalazione.comuneId) {
      const comune = await db.comune.findUnique({
        where: { id: Number(body.comuneId) },
        include: { provincia: { include: { regione: true } } },
      });
      if (comune) {
        cap = cap || comune.cap;
        provinciaId = comune.provinciaId;
        regioneId = comune.provincia.regioneId;
        if (!destinatarioNome && comune.nomeSindaco) {
          destinatarioNome = `Sindaco ${comune.nomeSindaco}`;
        }
      }
    }

    // Validazione range latitudine/longitudine nei valori geografici reali.
    let latitudine = segnalazione.latitudine;
    let longitudine = segnalazione.longitudine;
    if (typeof body.latitudine === "number" && typeof body.longitudine === "number") {
      if (body.latitudine < -90 || body.latitudine > 90) {
        return NextResponse.json(
          { error: "Latitudine non valida (deve essere tra -90 e +90)" },
          { status: 400 }
        );
      }
      if (body.longitudine < -180 || body.longitudine > 180) {
        return NextResponse.json(
          { error: "Longitudine non valida (deve essere tra -180 e +180)" },
          { status: 400 }
        );
      }
      latitudine = body.latitudine;
      longitudine = body.longitudine;
    } else if (body.latitudine != null || body.longitudine != null) {
      return NextResponse.json(
        { error: "Latitudine e longitudine devono essere entrambe numeriche o entrambe assenti" },
        { status: 400 }
      );
    }

    const aggiornata = await db.segnalazione.update({
      where: { id },
      data: {
        indirizzoVia: typeof body.indirizzoVia === "string" ? body.indirizzoVia.trim().slice(0, 500) : segnalazione.indirizzoVia,
        comuneId: body.comuneId !== undefined ? Number(body.comuneId) : segnalazione.comuneId,
        cap,
        provinciaId,
        regioneId,
        latitudine,
        longitudine,
        nomeEsercizio: typeof body.nomeEsercizio === "string" ? body.nomeEsercizio.slice(0, 200) : segnalazione.nomeEsercizio,
        // Per i boolean usiamo un check esplicito su undefined:
        // false ?? fallback restituirebbe false, ma se il campo manca del tutto
        // (undefined) manteniamo il valore esistente. Questo permette di
        // deselezionare correttamente una checkbox inviando false.
        chkVetroPianoInclinato: body.chkVetroPianoInclinato !== undefined ? !!body.chkVetroPianoInclinato : segnalazione.chkVetroPianoInclinato,
        chkVetroCurvo: body.chkVetroCurvo !== undefined ? !!body.chkVetroCurvo : segnalazione.chkVetroCurvo,
        chkAltroTipologia: body.chkAltroTipologia !== undefined ? !!body.chkAltroTipologia : segnalazione.chkAltroTipologia,
        notaAltroTipologia: typeof body.notaAltroTipologia === "string" ? body.notaAltroTipologia.slice(0, 500) : segnalazione.notaAltroTipologia,
        chkLuceVersoAlto: body.chkLuceVersoAlto !== undefined ? !!body.chkLuceVersoAlto : segnalazione.chkLuceVersoAlto,
        chkAbbagliamento: body.chkAbbagliamento !== undefined ? !!body.chkAbbagliamento : segnalazione.chkAbbagliamento,
        chkLuceIntrusiva: body.chkLuceIntrusiva !== undefined ? !!body.chkLuceIntrusiva : segnalazione.chkLuceIntrusiva,
        chkAltroProblema: body.chkAltroProblema !== undefined ? !!body.chkAltroProblema : segnalazione.chkAltroProblema,
        notaAltroProblema: typeof body.notaAltroProblema === "string" ? body.notaAltroProblema.slice(0, 500) : segnalazione.notaAltroProblema,
        descrizioneLibera: typeof body.descrizioneLibera === "string" ? body.descrizioneLibera.slice(0, 5000) : segnalazione.descrizioneLibera,
        destinatarioNome,
        includiArpa: body.includiArpa !== undefined ? !!body.includiArpa : segnalazione.includiArpa,
        pecCcAggiuntive: body.pecCcAggiuntive !== undefined ? pecCcAggiuntiveNormalized : segnalazione.pecCcAggiuntive,
        oggettoPec: body.oggettoPec !== undefined ? pecValidation.data.oggettoPec : segnalazione.oggettoPec,
        testoIntroduttivoPec: body.testoIntroduttivoPec !== undefined ? pecValidation.data.testoIntroduttivoPec : segnalazione.testoIntroduttivoPec,
        mittenteVisibile: body.mittenteVisibile !== undefined ? !!body.mittenteVisibile : segnalazione.mittenteVisibile,
      },
    });

    return NextResponse.json({ segnalazione: aggiornata });
  } catch (e) {
    logger.error({ err: e }, "Errore aggiornamento segnalazione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
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

  if (!["bozza"].includes(segnalazione.stato)) {
    return NextResponse.json(
      { error: "Solo le bozze possono essere eliminate" },
      { status: 400 }
    );
  }

  // Usa deleteMany con clausola WHERE su stato="bozza" per evitare
  // race condition tra findUnique e delete (lo stato potrebbe cambiare
  // tra le due chiamate). Se deleteMany ritorna count=0, qualcuno ha
  // cambiato stato concorrentemente: rispondiamo 409 Conflict.
  const result = await db.segnalazione.deleteMany({
    where: { id, stato: "bozza" },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { error: "La segnalazione non è più una bozza (potrebbe essere stata modificata concorrentemente). Ricarica la pagina." },
      { status: 409 }
    );
  }

  // Pulizia fisica degli allegati e della directory della segnalazione.
  // Eseguiamo in background per non bloccare la risposta, e ignoriamo
  // gli errori (il DB è già stato aggiornato; eventuali file orfani
  // saranno rimossi manualmente dall'admin, vedi nota nel cron-jobs.ts).
  //
  // L'ID della segnalazione è validato come segmento di path sicuro
  // (nessun `..`, `/`, `\`, `\0`) prima di essere usato in path.join,
  // per difesa in profondità coerente con path-guard.ts usato in tutte
  // le altre route che manipolano file di allegati.
  // Gli allegati reali sono in storage/uploads/ (directory PRIVATA,
  // fuori da public/), non in public/uploads/ che è vuota/legacy.
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
      logger.warn({ segnalazioneId: id, err: e }, "Impossibile eliminare la directory degli allegati durante DELETE segnalazione");
    }
  })();

  return NextResponse.json({ ok: true });
}
