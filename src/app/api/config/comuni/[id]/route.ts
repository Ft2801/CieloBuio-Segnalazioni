/**
 * API: PUT    /api/config/comuni/[id]
 *      DELETE /api/config/comuni/[id]
 *
 * Modifica ed eliminazione di un comune (solo admin).
 * L'eliminazione è bloccata se il comune ha segnalazioni collegate.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovoComuneSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const comuneId = Number(id);
  if (isNaN(comuneId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const provinciaIdNum = body.provinciaId ? Number(body.provinciaId) : null;
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
    const existing = await db.comune.findUnique({ where: { id: comuneId } });
    if (!existing) {
      return NextResponse.json({ error: "Comune non trovato" }, { status: 404 });
    }

    const aggiornato = await db.comune.update({
      where: { id: comuneId },
      data: {
        nome: data.nome,
        provinciaId: data.provinciaId,
        cap: data.cap,
        pecComune: data.pecComune,
        nomeSindaco: data.nomeSindaco ?? null,
        noteAggiornamento: data.noteAggiornamento ?? null,
      },
    });
    return NextResponse.json({ comune: aggiornato });
  } catch (e) {
    logger.error({ err: e }, "Errore modifica comune");
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
  const comuneId = Number(id);
  if (isNaN(comuneId)) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  try {
    const existing = await db.comune.findUnique({
      where: { id: comuneId },
      include: { _count: { select: { segnalazioni: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Comune non trovato" }, { status: 404 });
    }

    if (existing._count.segnalazioni > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: il comune ha ${existing._count.segnalazioni} segnalazione/i collegate.` },
        { status: 400 }
      );
    }

    // Wrap atomico: ri-verifica delle dipendenze e delete in transazione.
    // Previene race condition in cui una nuova segnalazione viene creata
    // tra il count-check iniziale e la delete (P2003 FK violation).
    try {
      await db.$transaction(async (tx) => {
        const segnalazioniCount = await tx.segnalazione.count({ where: { comuneId } });
        if (segnalazioniCount > 0) {
          throw new Error(`SEGNALAZIONI_COLLEGATE:${segnalazioniCount}`);
        }
        await tx.comune.delete({ where: { id: comuneId } });
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("SEGNALAZIONI_COLLEGATE:")) {
        const n = msg.split(":")[1];
        return NextResponse.json(
          { error: `Impossibile eliminare: il comune ha ${n} segnalazione/i collegate.` },
          { status: 400 }
        );
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return NextResponse.json(
          { error: "Impossibile eliminare: una nuova dipendenza è stata creata concorrentemente. Ricarica la pagina e riprova." },
          { status: 409 }
        );
      }
      logger.error({ err: e }, "Errore eliminazione comune");
      return NextResponse.json(
        { error: "Errore interno del server" },
        { status: 500 }
      );
    }
  } catch (e) {
    logger.error({ err: e }, "Errore eliminazione comune");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
