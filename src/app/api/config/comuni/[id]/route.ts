/**
 * API: PUT    /api/config/comuni/[id]
 *      DELETE /api/config/comuni/[id]
 *
 * Modifica ed eliminazione di un comune (solo admin).
 * - Il cambio di provincia è bloccato se il comune ha segnalazioni collegate:
 *   le segnalazioni conservano la provincia di origine e il routing resterebbe
 *   incoerente.
 * - L'eliminazione è bloccata se il comune ha segnalazioni collegate.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovoComuneSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { normalizzaStringaFacoltativa, leggiBodyOggetto, normalizzaIdNumerico, parseIdIntero } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Segnalato dentro la transazione di DELETE se compaiono segnalazioni collegate. */
class CollegateError extends Error {
  constructor(readonly count: number) {
    super("SEGNALAZIONI_COLLEGATE");
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const comuneId = parseIdIntero(id);
  if (comuneId === null) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
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
    const existing = await db.comune.findUnique({
      where: { id: comuneId },
      include: { _count: { select: { segnalazioni: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Comune non trovato" }, { status: 404 });
    }
    if (data.provinciaId !== existing.provinciaId && existing._count.segnalazioni > 0) {
      return NextResponse.json(
        {
          error: `Impossibile cambiare provincia: il comune ha ${existing._count.segnalazioni} segnalazione/i collegate, che manterrebbero la provincia di origine.`,
        },
        { status: 400 },
      );
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
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json({ error: "Comune già presente in questa provincia" }, { status: 400 });
      }
      if (e.code === "P2003") {
        return NextResponse.json(
          {
            error:
              "Provincia non trovata o territorio collegato a segnalazioni. Verificare i dati e ricaricare la pagina.",
          },
          { status: 400 },
        );
      }
      if (e.code === "P2025") {
        return NextResponse.json({ error: "Comune non trovato" }, { status: 404 });
      }
    }
    logger.error({ err: e }, "Errore modifica comune");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const comuneId = parseIdIntero(id);
  if (comuneId === null) {
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
        { status: 400 },
      );
    }

    // Ri-verifica delle dipendenze e delete in un'unica transazione: una
    // segnalazione creata nel frattempo viene rilevata invece di causare una
    // violazione di FK.
    await db.$transaction(async (tx) => {
      const segnalazioniCount = await tx.segnalazione.count({ where: { comuneId } });
      if (segnalazioniCount > 0) {
        throw new CollegateError(segnalazioniCount);
      }
      await tx.comune.delete({ where: { id: comuneId } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CollegateError) {
      return NextResponse.json(
        { error: `Impossibile eliminare: il comune ha ${e.count} segnalazione/i collegate.` },
        { status: 400 },
      );
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        {
          error:
            "Impossibile eliminare: una nuova dipendenza è stata creata concorrentemente. Ricarica la pagina e riprova.",
        },
        { status: 409 },
      );
    }
    logger.error({ err: e }, "Errore eliminazione comune");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
