/**
 * API: GET/POST /api/config/comuni
 * Elenco e creazione comuni (solo admin per scrittura).
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovoComuneSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { normalizzaStringaFacoltativa, leggiBodyOggetto, normalizzaIdNumerico, parseIdIntero } from "@/lib/http";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const provinciaId = url.searchParams.get("provinciaId");
  const search = url.searchParams.get("search");

  const where: Record<string, unknown> = {};
  if (provinciaId) {
    const provinciaIdNum = parseIdIntero(provinciaId);
    if (provinciaIdNum === null) {
      return NextResponse.json({ error: "provinciaId non valido" }, { status: 400 });
    }
    where.provinciaId = provinciaIdNum;
  }
  if (search) {
    // Limite difensivo sulla lunghezza del termine di ricerca: previene
    // abusi (stringhe enormi che sforzano il planner di query PostgreSQL)
    // senza impattare i casi d'uso reali (un nome comune raramente supera
    // i 50 caratteri, 200 è un margine ampio).
    const searchTrimmed = search.slice(0, 200);
    where.nome = { contains: searchTrimmed, mode: "insensitive" as const };
  }

  const limit = search ? 50 : 500;
  const [comuni, total] = await Promise.all([
    db.comune.findMany({
      where,
      orderBy: { nome: "asc" },
      include: {
        provincia: {
          select: { sigla: true, nome: true, regione: { select: { regione: true, riferimentoLegge: true } } },
        },
      },
      take: limit,
    }),
    db.comune.count({ where }),
  ]);
  return NextResponse.json({
    comuni,
    truncated: total > limit,
    total,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await leggiBodyOggetto(req);
  if (!body) {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }
  const normalized = {
    ...body,
    provinciaId: normalizzaIdNumerico(body.provinciaId),
    nomeSindaco: normalizzaStringaFacoltativa(body.nomeSindaco),
    noteAggiornamento: normalizzaStringaFacoltativa(body.noteAggiornamento),
  };
  const validation = validate(nuovoComuneSchema, normalized);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const comune = await db.comune.create({
      data: {
        nome: data.nome,
        provinciaId: data.provinciaId,
        cap: data.cap,
        pecComune: data.pecComune,
        nomeSindaco: data.nomeSindaco ?? null,
        noteAggiornamento: data.noteAggiornamento ?? null,
      },
    });
    return NextResponse.json({ comune }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Comune già presente in questa provincia" }, { status: 400 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json({ error: "Provincia non trovata" }, { status: 400 });
    }
    logger.error({ err: e }, "Errore creazione comune");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
