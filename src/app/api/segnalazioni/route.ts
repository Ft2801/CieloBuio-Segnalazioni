/**
 * API: GET /api/segnalazioni
 *      POST /api/segnalazioni
 *
 * GET: elenco segnalazioni visibili dall'utente (filtrate per ruolo)
 * POST: crea una nuova segnalazione in stato "bozza"
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getVisibilityFilter } from "@/lib/auth";
import { segnalazionePecSchema, validaPecCcAggiuntive, validate } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// GET: elenco con filtri opzionali + paginazione
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const stato = url.searchParams.get("stato");
  const search = url.searchParams.get("search");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  // Validazione del parametro stato contro whitelist (evita di passare a
  // Prisma stringhe arbitrarie, anche se Prisma le ignora silenziosamente).
  const STATI_VALIDI = [
    "bozza", "in_revisione", "approvata", "inviata",
    "in_attesa", "chiusa_positiva", "chiusa_negativa",
  ];

  const where: Record<string, unknown> = { ...getVisibilityFilter(user) };
  if (stato && stato !== "all" && STATI_VALIDI.includes(stato)) where.stato = stato;
  if (search) {
    const q = search.slice(0, 200); // limita lunghezza per prevenire abusi
    where.OR = [
      { numeroProtocollo: { contains: q, mode: "insensitive" as const } },
      { indirizzoVia: { contains: q, mode: "insensitive" as const } },
      { nomeEsercizio: { contains: q, mode: "insensitive" as const } },
      { comune: { nome: { contains: q, mode: "insensitive" as const } } },
    ];
  }

  const [segnalazioni, total] = await Promise.all([
    db.segnalazione.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        comune: true,
        provincia: true,
        regione: true,
        volontario: { select: { id: true, nomeCognome: true, email: true } },
        referenteApprovatore: { select: { id: true, nomeCognome: true } },
        // Usa _count invece di caricare tutti i record allegati completi.
        // Il frontend mostra solo il conteggio (s.allegati.length), non i
        // dettagli, quindi caricare urlStorage e nomeOriginale per ogni
        // allegato è uno spreco di banda e CPU. _count fa una query
        // aggregata ottimizzata.
        _count: { select: { allegati: true } },
      },
      take: limit,
      skip: offset,
    }),
    db.segnalazione.count({ where }),
  ]);

  return NextResponse.json({
    segnalazioni,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + segnalazioni.length < total,
    },
  });
}

// POST: crea nuova segnalazione
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // H5: rate limiting per utente (20 segnalazioni/ora)
  const rl = checkRateLimit(`create-segn:${user.id}`, 20, 60 * 60 * 1000, 60 * 60 * 1000, 30 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe segnalazioni create. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Validazione minima: indirizzo e comune obbligatori (per derivare
    // provincia e regione, necessarie per la lettera PEC e il routing
    // al referente territoriale competente). L'indirizzo viene trimmato
    // per evitare che una stringa di soli spazi superi il check.
    const indirizzoVia =
      typeof body.indirizzoVia === "string" ? body.indirizzoVia.trim() : "";
    if (!indirizzoVia || indirizzoVia.length > 500) {
      return NextResponse.json(
        { error: "Indirizzo obbligatorio (max 500 caratteri)" },
        { status: 400 }
      );
    }
    if (!body.comuneId) {
      return NextResponse.json(
        { error: "Comune obbligatorio: necessario per derivare provincia, regione, legge applicabile e PEC del Comune" },
        { status: 400 }
      );
    }
    const comuneIdNum = Number(body.comuneId);
    if (isNaN(comuneIdNum)) {
      return NextResponse.json(
        { error: "comuneId non valido" },
        { status: 400 }
      );
    }

    // H6: valida campi PEC con zod (previene email header injection)
    const pecValidation = validate(segnalazionePecSchema, {
      oggettoPec: body.oggettoPec,
      testoIntroduttivoPec: body.testoIntroduttivoPec,
      pecCcAggiuntive: body.pecCcAggiuntive,
      destinatarioNome: body.destinatarioNome,
    });
    if (!pecValidation.success) {
      return NextResponse.json({ error: pecValidation.error }, { status: 400 });
    }

    // H6: valida format email dei CC. Salviamo le email normalizzate.
    const ccValidation = validaPecCcAggiuntive(body.pecCcAggiuntive);
    if (!ccValidation.ok) {
      return NextResponse.json({ error: ccValidation.error }, { status: 400 });
    }
    const pecCcAggiuntiveNormalized =
      ccValidation.emails.length > 0 ? ccValidation.emails.join("; ") : null;

    // Deriva provincia/regione dal comune
    let provinciaId: number | null = null;
    let regioneId: number | null = null;
    // Il CAP viene validato dallo schema zod a 5 cifre esatte in fase di
    // creazione/modifica comune; qui ereditiamo quello del comune se non fornito.
    let cap = typeof body.cap === "string" ? body.cap.trim() : "";
    let destinatarioNome = pecValidation.data.destinatarioNome ?? null;

    const comune = await db.comune.findUnique({
      where: { id: comuneIdNum },
      include: { provincia: { include: { regione: true } } },
    });
    if (!comune) {
      return NextResponse.json(
        { error: "Comune non trovato" },
        { status: 400 }
      );
    }
    cap = cap || comune.cap;
    provinciaId = comune.provinciaId;
    regioneId = comune.provincia.regioneId;
    if (!destinatarioNome && comune.nomeSindaco) {
      destinatarioNome = `Sindaco ${comune.nomeSindaco}`;
    }

    // Validazione range latitudine/longitudine nei valori geografici reali.
    let latitudine: number | null = null;
    let longitudine: number | null = null;
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
      // Se uno dei due è fornito ma non entrambi come number, errore
      return NextResponse.json(
        { error: "Latitudine e longitudine devono essere entrambe numeriche o entrambe assenti" },
        { status: 400 }
      );
    }

    // M6: livelloRecidiva NON è impostabile dal client. Viene calcolato
    // server-side in base alla segnalazione precedente collegata.
    let livelloRecidiva = 1;
    let segnalazionePrecedenteId: string | null = null;

    if (body.segnalazionePrecedenteId && typeof body.segnalazionePrecedenteId === "string") {
      // Verifica che la segnalazione precedente esista e appartenga allo stesso utente
      const precedente = await db.segnalazione.findUnique({
        where: { id: body.segnalazionePrecedenteId },
        select: { id: true, volontarioId: true, livelloRecidiva: true },
      });
      if (precedente && precedente.volontarioId === user.id) {
        segnalazionePrecedenteId = precedente.id;
        livelloRecidiva = (precedente.livelloRecidiva ?? 1) + 1;
      } else {
        return NextResponse.json(
          { error: "Segnalazione precedente non trovata o non accessibile" },
          { status: 400 }
        );
      }
    }

    const segnalazione = await db.segnalazione.create({
      data: {
        stato: "bozza",
        volontarioId: user.id,
        indirizzoVia,
        comuneId: comuneIdNum,
        cap,
        provinciaId,
        regioneId,
        latitudine,
        longitudine,
        nomeEsercizio: typeof body.nomeEsercizio === "string" ? body.nomeEsercizio.slice(0, 200) : null,
        chkVetroPianoInclinato: !!body.chkVetroPianoInclinato,
        chkVetroCurvo: !!body.chkVetroCurvo,
        chkAltroTipologia: !!body.chkAltroTipologia,
        notaAltroTipologia: typeof body.notaAltroTipologia === "string" ? body.notaAltroTipologia.slice(0, 500) : null,
        chkLuceVersoAlto: !!body.chkLuceVersoAlto,
        chkAbbagliamento: !!body.chkAbbagliamento,
        chkLuceIntrusiva: !!body.chkLuceIntrusiva,
        chkAltroProblema: !!body.chkAltroProblema,
        notaAltroProblema: typeof body.notaAltroProblema === "string" ? body.notaAltroProblema.slice(0, 500) : null,
        descrizioneLibera: typeof body.descrizioneLibera === "string" ? body.descrizioneLibera.slice(0, 5000) : null,
        destinatarioNome,
        includiArpa: !!body.includiArpa,
        pecCcAggiuntive: pecCcAggiuntiveNormalized,
        oggettoPec: pecValidation.data.oggettoPec ?? null,
        testoIntroduttivoPec: pecValidation.data.testoIntroduttivoPec ?? null,
        mittenteVisibile: body.mittenteVisibile !== false,
        segnalazionePrecedenteId,
        livelloRecidiva,
      },
    });

    // Storico: bozza iniziale
    await db.storicoStato.create({
      data: {
        segnalazioneId: segnalazione.id,
        statoPrecedente: null,
        statoNuovo: "bozza",
        userId: user.id,
      },
    });

    return NextResponse.json({ segnalazione }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore creazione segnalazione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
