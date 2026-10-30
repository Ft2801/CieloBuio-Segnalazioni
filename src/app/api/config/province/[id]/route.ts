/**
 * API: PUT    /api/config/province/[id]
 *      DELETE /api/config/province/[id]
 *
 * Modifica ed eliminazione di una provincia (solo admin).
 * L'eliminazione è bloccata se la provincia ha comuni o segnalazioni collegate.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSessionUser, canManageConfiguration } from "@/lib/auth";
import { nuovaProvinciaSchema, validate } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { normalizzaStringaFacoltativa, leggiBodyOggetto, normalizzaIdNumerico, parseIdIntero } from "@/lib/http";
import { messaggioDaErrore } from "@/lib/errori";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const provinciaId = parseIdIntero(id);
  if (provinciaId === null) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  const body = await leggiBodyOggetto(req);
  if (!body) {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }
  const normalized = {
    ...body,
    regioneId: normalizzaIdNumerico(body.regioneId),
    pecArpaProvinciale: normalizzaStringaFacoltativa(body.pecArpaProvinciale),
  };
  const validation = validate(nuovaProvinciaSchema, normalized);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const existing = await db.provincia.findUnique({
      where: { id: provinciaId },
      include: { _count: { select: { segnalazioni: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Provincia non trovata" }, { status: 404 });
    }
    // Le segnalazioni conservano la regione di origine: cambiarla con
    // segnalazioni collegate renderebbe incoerente il routing territoriale.
    if (data.regioneId !== existing.regioneId && existing._count.segnalazioni > 0) {
      return NextResponse.json(
        {
          error: `Impossibile cambiare regione: la provincia ha ${existing._count.segnalazioni} segnalazione/i collegate, che manterrebbero la regione di origine.`,
        },
        { status: 400 },
      );
    }

    const aggiornata = await db.provincia.update({
      where: { id: provinciaId },
      data: {
        sigla: data.sigla.toUpperCase(),
        nome: data.nome,
        regioneId: data.regioneId,
        pecArpaProvinciale: data.pecArpaProvinciale ?? null,
      },
    });
    return NextResponse.json({ provincia: aggiornata });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json({ error: "Sigla già presente" }, { status: 400 });
      }
      if (e.code === "P2003") {
        return NextResponse.json(
          {
            error:
              "Regione non trovata o territorio collegato a segnalazioni. Verificare i dati e ricaricare la pagina.",
          },
          { status: 400 },
        );
      }
      if (e.code === "P2025") {
        return NextResponse.json({ error: "Provincia non trovata" }, { status: 404 });
      }
    }
    logger.error({ err: e }, "Errore modifica provincia");
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
  const provinciaId = parseIdIntero(id);
  if (provinciaId === null) {
    return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  }

  try {
    const existing = await db.provincia.findUnique({
      where: { id: provinciaId },
      include: { _count: { select: { comuni: true, segnalazioni: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Provincia non trovata" }, { status: 404 });
    }

    if (existing._count.comuni > 0) {
      return NextResponse.json(
        {
          error: `Impossibile eliminare: la provincia ha ${existing._count.comuni} comune/i collegati. Eliminare prima i comuni.`,
        },
        { status: 400 },
      );
    }
    if (existing._count.segnalazioni > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: la provincia ha ${existing._count.segnalazioni} segnalazione/i collegate.` },
        { status: 400 },
      );
    }

    // Verifica che non ci siano referenti provinciali assegnati a questa provincia
    const referentiCount = await db.user.count({
      where: { provinciaId: provinciaId, ruolo: "referente_provinciale" },
    });
    if (referentiCount > 0) {
      return NextResponse.json(
        {
          error: `Impossibile eliminare: la provincia ha ${referentiCount} referente/i provinciale/i assegnato/i. Riassegna o disattiva prima i referenti.`,
        },
        { status: 400 },
      );
    }

    // Wrap atomico: ri-verifica delle dipendenze e delete in transazione.
    // Previene race condition in cui un nuovo record dipendente viene
    // creato tra il count-check iniziale e la delete (P2003 FK violation).
    try {
      await db.$transaction(async (tx) => {
        const comuniCount = await tx.comune.count({ where: { provinciaId } });
        if (comuniCount > 0) {
          throw new Error(`COMUNI_COLLEGATI:${comuniCount}`);
        }
        const segnalazioniCount = await tx.segnalazione.count({ where: { provinciaId } });
        if (segnalazioniCount > 0) {
          throw new Error(`SEGNALAZIONI_COLLEGATE:${segnalazioniCount}`);
        }
        const referentiCount = await tx.user.count({
          where: { provinciaId, ruolo: "referente_provinciale" },
        });
        if (referentiCount > 0) {
          throw new Error(`REFERENTI_ASSEGNATI:${referentiCount}`);
        }
        await tx.provincia.delete({ where: { id: provinciaId } });
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = messaggioDaErrore(e);
      if (msg.startsWith("COMUNI_COLLEGATI:")) {
        const n = msg.split(":")[1];
        return NextResponse.json(
          { error: `Impossibile eliminare: la provincia ha ${n} comune/i collegati. Eliminare prima i comuni.` },
          { status: 400 },
        );
      }
      if (msg.startsWith("SEGNALAZIONI_COLLEGATE:")) {
        const n = msg.split(":")[1];
        return NextResponse.json(
          { error: `Impossibile eliminare: la provincia ha ${n} segnalazione/i collegate.` },
          { status: 400 },
        );
      }
      if (msg.startsWith("REFERENTI_ASSEGNATI:")) {
        const n = msg.split(":")[1];
        return NextResponse.json(
          {
            error: `Impossibile eliminare: la provincia ha ${n} referente/i provinciale/i assegnato/i. Riassegna o disattiva prima i referenti.`,
          },
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
      logger.error({ err: e }, "Errore eliminazione provincia");
      return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
    }
  } catch (e) {
    logger.error({ err: e }, "Errore eliminazione provincia");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
