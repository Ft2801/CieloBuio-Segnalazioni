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
import {
  segnalazionePecSchema,
  segnalazioneFlagSchema,
  validaPecCcAggiuntive,
  validate,
  capSchema,
} from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { leggiBodyOggetto, MAX_ID_DB } from "@/lib/http";

// Stati ammessi per la segnalazione precedente di una recidiva.
const STATI_RECIDIVA_VALIDI = ["inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"];

// Stati ammessi nel filtro della lista (whitelist: nessuna stringa arbitraria
// arriva a Prisma).
const STATI_VALIDI = [
  "bozza",
  "in_revisione",
  "approvata",
  "inviata",
  "in_attesa",
  "chiusa_positiva",
  "chiusa_negativa",
];

/**
 * Legge un parametro numerico intero della query string. Valori assenti,
 * vuoti o non composti solo da cifre ricevono il default; il risultato è
 * limitato all'intervallo [min, max].
 */
function leggiIntero(valore: string | null, predefinito: number, min: number, max: number): number {
  if (valore === null || !/^\d+$/.test(valore.trim())) return predefinito;
  return Math.min(Math.max(Number(valore.trim()), min), max);
}

// GET: elenco con filtri opzionali + paginazione
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const stato = url.searchParams.get("stato");
  const search = url.searchParams.get("search");

  // Prisma rifiuta take/skip non interi con un errore di validazione (500):
  // i parametri vengono letti come interi limitati, con default per i valori
  // mancanti o non numerici.
  const limit = leggiIntero(url.searchParams.get("limit"), 50, 1, 200);
  const offset = leggiIntero(url.searchParams.get("offset"), 0, 0, 2147483647);

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

  try {
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
          // Il frontend legge solo il conteggio (s._count?.allegati), non i
          // dettagli, quindi caricare urlStorage e nomeOriginale per ogni
          // allegato sarebbe uno spreco di banda e CPU. _count fa una query
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
  } catch (err) {
    logger.error({ err, userId: user.id }, "[segnalazioni] lettura lista fallita");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}

// POST: crea nuova segnalazione
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limit per utente: 20 segnalazioni all'ora.
  const rl = checkRateLimit(`create-segn:${user.id}`, 20, 60 * 60 * 1000, 60 * 60 * 1000, 30 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe segnalazioni create. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  try {
    const body = await leggiBodyOggetto(req);
    if (!body) {
      return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
    }

    // Validazione minima: indirizzo e comune obbligatori (per derivare
    // provincia e regione, necessarie per la lettera PEC e il routing
    // al referente territoriale competente). L'indirizzo viene trimmato
    // per evitare che una stringa di soli spazi superi il check.
    const indirizzoVia = typeof body.indirizzoVia === "string" ? body.indirizzoVia.trim() : "";
    if (!indirizzoVia || indirizzoVia.length > 500) {
      return NextResponse.json({ error: "Indirizzo obbligatorio (max 500 caratteri)" }, { status: 400 });
    }
    if (body.comuneId === undefined || body.comuneId === null || body.comuneId === "") {
      return NextResponse.json(
        {
          error: "Comune obbligatorio: necessario per derivare provincia, regione, legge applicabile e PEC del Comune",
        },
        { status: 400 },
      );
    }
    if (
      typeof body.comuneId !== "number" ||
      !Number.isSafeInteger(body.comuneId) ||
      body.comuneId <= 0 ||
      body.comuneId > MAX_ID_DB
    ) {
      return NextResponse.json({ error: "comuneId non valido" }, { status: 400 });
    }
    const comuneIdNum = body.comuneId;

    // Valida i campi PEC con zod (previene l'iniezione di header email).
    const pecValidation = validate(segnalazionePecSchema, {
      oggettoPec: body.oggettoPec,
      testoIntroduttivoPec: body.testoIntroduttivoPec,
      pecCcAggiuntive: body.pecCcAggiuntive,
      destinatarioNome: body.destinatarioNome,
    });
    if (!pecValidation.success) {
      return NextResponse.json({ error: pecValidation.error }, { status: 400 });
    }

    // Rifiuta valori non booleani, invece di convertirli con !!: una
    // stringa "false" è truthy e attiverebbe ARPA o altre spunte per errore.
    const flagValidation = validate(segnalazioneFlagSchema, body);
    if (!flagValidation.success) {
      return NextResponse.json({ error: flagValidation.error }, { status: 400 });
    }

    // Valida il formato email dei CC e salva quelle normalizzate.
    const ccValidation = validaPecCcAggiuntive(body.pecCcAggiuntive);
    if (!ccValidation.ok) {
      return NextResponse.json({ error: ccValidation.error }, { status: 400 });
    }
    const pecCcAggiuntiveNormalized = ccValidation.emails.length > 0 ? ccValidation.emails.join("; ") : null;

    // Deriva provincia/regione dal comune
    let provinciaId: number | null = null;
    let regioneId: number | null = null;
    // Il CAP viene validato dallo schema zod a 5 cifre esatte in fase di
    // creazione/modifica comune; qui ereditiamo quello del comune se non fornito.
    // Se fornito dal volontario, deve comunque passare la validazione
    // capSchema (5 cifre) per coerenza con il comune e per evitare
    // che vengano persistiti CAP malformati che poi rompono la lettera PEC.
    let cap: string | null = null;
    let destinatarioNome = pecValidation.data.destinatarioNome ?? null;

    const comune = await db.comune.findUnique({
      where: { id: comuneIdNum },
      include: { provincia: { include: { regione: true } } },
    });
    if (!comune) {
      return NextResponse.json({ error: "Comune non trovato" }, { status: 400 });
    }
    if (body.cap !== undefined && body.cap !== null && typeof body.cap !== "string") {
      return NextResponse.json({ error: "CAP non valido: deve essere una stringa di 5 cifre" }, { status: 400 });
    }
    if (typeof body.cap === "string" && body.cap.trim() !== "") {
      const capResult = capSchema.safeParse(body.cap.trim());
      if (!capResult.success) {
        return NextResponse.json({ error: capResult.error.issues[0].message }, { status: 400 });
      }
      cap = capResult.data;
    } else {
      cap = comune.cap;
    }
    provinciaId = comune.provinciaId;
    regioneId = comune.provincia.regioneId;
    if (!destinatarioNome && comune.nomeSindaco) {
      destinatarioNome = `Sindaco ${comune.nomeSindaco}`;
    }

    // Validazione range latitudine/longitudine nei valori geografici reali.
    let latitudine: number | null = null;
    let longitudine: number | null = null;
    if (typeof body.latitudine === "number" && typeof body.longitudine === "number") {
      if (!Number.isFinite(body.latitudine) || body.latitudine < -90 || body.latitudine > 90) {
        return NextResponse.json({ error: "Latitudine non valida (deve essere tra -90 e +90)" }, { status: 400 });
      }
      if (!Number.isFinite(body.longitudine) || body.longitudine < -180 || body.longitudine > 180) {
        return NextResponse.json({ error: "Longitudine non valida (deve essere tra -180 e +180)" }, { status: 400 });
      }
      latitudine = body.latitudine;
      longitudine = body.longitudine;
    } else if (body.latitudine != null || body.longitudine != null) {
      // Se uno dei due è fornito ma non entrambi come number, errore
      return NextResponse.json(
        { error: "Latitudine e longitudine devono essere entrambe numeriche o entrambe assenti" },
        { status: 400 },
      );
    }

    // livelloRecidiva non è impostabile dal client: viene calcolato lato server
    // a partire dalla segnalazione precedente collegata.
    let livelloRecidiva = 1;
    let segnalazionePrecedenteId: string | null = null;

    if (body.segnalazionePrecedenteId !== undefined && body.segnalazionePrecedenteId !== null) {
      if (typeof body.segnalazionePrecedenteId !== "string" || !body.segnalazionePrecedenteId.trim()) {
        // Non trasformare silenziosamente una recidiva richiesta dal client
        // in una pratica scollegata se l'identificativo è malformato.
        return NextResponse.json({ error: "segnalazionePrecedenteId non valido" }, { status: 400 });
      }
      // La segnalazione precedente deve esistere, appartenere allo stesso
      // utente ed essere già stata inviata o chiusa: una recidiva di una
      // bozza o di una segnalazione ancora in revisione non ha senso.
      const precedente = await db.segnalazione.findUnique({
        where: { id: body.segnalazionePrecedenteId.trim() },
        select: { id: true, volontarioId: true, livelloRecidiva: true, stato: true },
      });
      if (precedente && precedente.volontarioId === user.id && STATI_RECIDIVA_VALIDI.includes(precedente.stato)) {
        segnalazionePrecedenteId = precedente.id;
        livelloRecidiva = (precedente.livelloRecidiva ?? 1) + 1;
      } else {
        return NextResponse.json({ error: "Segnalazione precedente non trovata o non accessibile" }, { status: 400 });
      }
    }

    const segnalazione = await db.$transaction(async (tx) => {
      const creata = await tx.segnalazione.create({
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
          chkVetroPianoInclinato: flagValidation.data.chkVetroPianoInclinato ?? false,
          chkVetroCurvo: flagValidation.data.chkVetroCurvo ?? false,
          chkAltroTipologia: flagValidation.data.chkAltroTipologia ?? false,
          notaAltroTipologia:
            typeof body.notaAltroTipologia === "string" ? body.notaAltroTipologia.slice(0, 500) : null,
          chkLuceVersoAlto: flagValidation.data.chkLuceVersoAlto ?? false,
          chkAbbagliamento: flagValidation.data.chkAbbagliamento ?? false,
          chkLuceIntrusiva: flagValidation.data.chkLuceIntrusiva ?? false,
          chkAltroProblema: flagValidation.data.chkAltroProblema ?? false,
          notaAltroProblema: typeof body.notaAltroProblema === "string" ? body.notaAltroProblema.slice(0, 500) : null,
          descrizioneLibera: typeof body.descrizioneLibera === "string" ? body.descrizioneLibera.slice(0, 5000) : null,
          destinatarioNome,
          includiArpa: flagValidation.data.includiArpa ?? false,
          pecCcAggiuntive: pecCcAggiuntiveNormalized,
          oggettoPec: pecValidation.data.oggettoPec ?? null,
          testoIntroduttivoPec: pecValidation.data.testoIntroduttivoPec ?? null,
          // La visibilità è attiva per default. La stringa "false" resta
          // accettata per compatibilità, ma gli altri tipi sono rifiutati.
          mittenteVisibile:
            flagValidation.data.mittenteVisibile !== false && flagValidation.data.mittenteVisibile !== "false",
          segnalazionePrecedenteId,
          livelloRecidiva,
        },
      });
      await tx.storicoStato.create({
        data: {
          segnalazioneId: creata.id,
          statoPrecedente: null,
          statoNuovo: "bozza",
          userId: user.id,
        },
      });
      return creata;
    });

    return NextResponse.json({ segnalazione }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore creazione segnalazione");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
