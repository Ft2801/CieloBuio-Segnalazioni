/**
 * API: GET/POST /api/config/regioni
 * Gestione delle regioni e relative leggi (solo admin per scrittura).
 * Per modifica ed eliminazione: PUT/DELETE /api/config/regioni/[id]
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovaRegioneSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const regioni = await db.regioneLegge.findMany({
    orderBy: { regione: "asc" },
    include: { _count: { select: { province: true, segnalazioni: true } } },
  });
  return NextResponse.json({ regioni });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const validation = validate(nuovaRegioneSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const regione = await db.regioneLegge.create({
      data: {
        regione: data.regione.toUpperCase(),
        riferimentoLegge: data.riferimentoLegge,
        titoloLegge: data.titoloLegge,
        testoProgettoIlluminotecnico: data.testoProgettoIlluminotecnico,
        testoDeroghe: data.testoDeroghe,
        testoDatiFotometrici: data.testoDatiFotometrici,
        testoApprovazione: data.testoApprovazione,
        testoInstallazione: data.testoInstallazione,
        testoControllo: data.testoControllo,
        testoSanzioni: data.testoSanzioni,
        pecArpaRegionale: data.pecArpaRegionale,
      },
    });
    return NextResponse.json({ regione }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore creazione regione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
