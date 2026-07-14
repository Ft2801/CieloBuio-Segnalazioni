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
    const provinciaIdNum = Number(provinciaId);
    if (isNaN(provinciaIdNum)) {
      return NextResponse.json(
        { error: "provinciaId non valido" },
        { status: 400 }
      );
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
          select: { sigla: true, nome: true, regione: { select: { regione: true } } },
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
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const provinciaIdNum = body.provinciaId ? Number(body.provinciaId) : null;
  // Validazione: Number("abc") produce NaN, che non è un ID valido
  if (provinciaIdNum !== null && isNaN(provinciaIdNum)) {
    return NextResponse.json({ error: "provinciaId non valido" }, { status: 400 });
  }
  const normalized = {
    ...body,
    provinciaId: provinciaIdNum,
    nomeSindaco: body.nomeSindaco || null,
    noteAggiornamento: body.noteAggiornamento || null,
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
    logger.error({ err: e }, "Errore creazione comune");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
