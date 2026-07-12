/**
 * API: GET/POST /api/config/province
 * Elenco e creazione province (solo admin per scrittura).
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovaProvinciaSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const regioneId = url.searchParams.get("regioneId");

  const where: Record<string, unknown> = {};
  if (regioneId) {
    const regioneIdNum = Number(regioneId);
    if (isNaN(regioneIdNum)) {
      return NextResponse.json(
        { error: "regioneId non valido" },
        { status: 400 }
      );
    }
    where.regioneId = regioneIdNum;
  }

  const province = await db.provincia.findMany({
    where,
    orderBy: { nome: "asc" },
    include: {
      regione: { select: { regione: true, id: true } },
      _count: { select: { comuni: true, segnalazioni: true } },
    },
  });
  return NextResponse.json({ province });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const regioneIdNum = body.regioneId ? Number(body.regioneId) : null;
  // Validazione: Number("abc") produce NaN, che non è un ID valido
  if (regioneIdNum !== null && isNaN(regioneIdNum)) {
    return NextResponse.json({ error: "regioneId non valido" }, { status: 400 });
  }
  const normalized = {
    ...body,
    regioneId: regioneIdNum,
    pecArpaProvinciale: body.pecArpaProvinciale || null,
  };
  const validation = validate(nuovaProvinciaSchema, normalized);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const provincia = await db.provincia.create({
      data: {
        sigla: data.sigla.toUpperCase(),
        nome: data.nome,
        regioneId: data.regioneId,
        pecArpaProvinciale: data.pecArpaProvinciale ?? null,
      },
    });
    return NextResponse.json({ provincia }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore creazione provincia");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
