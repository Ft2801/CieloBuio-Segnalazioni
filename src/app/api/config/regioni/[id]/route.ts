/**
 * API: PUT    /api/config/regioni/[id]
 *      DELETE /api/config/regioni/[id]
 *
 * Modifica ed eliminazione di una regione (solo admin).
 * L'eliminazione è bloccata se la regione ha province o segnalazioni collegate.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovaRegioneSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const regioneId = Number(id);
  if (isNaN(regioneId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const validation = validate(nuovaRegioneSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const existing = await db.regioneLegge.findUnique({ where: { id: regioneId } });
    if (!existing) {
      return NextResponse.json({ error: "Regione non trovata" }, { status: 404 });
    }

    const aggiornata = await db.regioneLegge.update({
      where: { id: regioneId },
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
    return NextResponse.json({ regione: aggiornata });
  } catch (e) {
    logger.error({ err: e }, "Errore modifica regione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const regioneId = Number(id);
  if (isNaN(regioneId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  try {
    const existing = await db.regioneLegge.findUnique({
      where: { id: regioneId },
      include: { _count: { select: { province: true, segnalazioni: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Regione non trovata" }, { status: 404 });
    }

    if (existing._count.province > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: la regione ha ${existing._count.province} provincia/e collegate. Eliminare prima le province.` },
        { status: 400 }
      );
    }
    if (existing._count.segnalazioni > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: la regione ha ${existing._count.segnalazioni} segnalazione/i collegate. Le segnalazioni mantengono il riferimento per tracciabilità storica.` },
        { status: 400 }
      );
    }

    // Verifica che non ci siano referenti regionali assegnati a questa regione
    const referentiCount = await db.user.count({
      where: { regioneId: regioneId, ruolo: "referente_regionale" },
    });
    if (referentiCount > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: la regione ha ${referentiCount} referente/i regionale/i assegnato/i. Riassegna o disattiva prima i referenti.` },
        { status: 400 }
      );
    }

    await db.regioneLegge.delete({ where: { id: regioneId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "Errore eliminazione regione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
