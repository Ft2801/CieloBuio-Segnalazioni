/**
 * API: POST /api/segnalazioni/[id]/approva
 * Approvazione da parte del referente territoriale.
 * Transizione: in_revisione -> approvata
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canReviewSegnalazioni(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({ where: { id } });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // Verifica competenza territoriale con helper centralizzato (fail-closed).
  // Un referente senza territorio assegnato non può approvare segnalazioni.
  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json(
      { error: "Non autorizzato per questa segnalazione" },
      { status: 403 }
    );
  }

  if (segnalazione.stato !== "in_revisione") {
    return NextResponse.json(
      { error: "La segnalazione non è in stato di revisione" },
      { status: 400 }
    );
  }

  try {
    // Transazione interattiva: updateMany + storicoStato.create nello
    // stesso blocco atomico. Se la create di storicoStato fallisce, anche
    // l'updateMany viene rollbackato, preservando l'invariante "ogni
    // transizione di stato ha il suo audit record".
    const aggiornata = await db.$transaction(async (tx) => {
      // Update atomica con clausola WHERE su stato="in_revisione": previene
      // race condition tra findUnique e update (lo stato potrebbe cambiare
      // concorrentemente, ad es. un altro referente rifiuta nello stesso
      // istante). Se count=0, lo stato è cambiato: rispondiamo 409 Conflict.
      const result = await tx.segnalazione.updateMany({
        where: { id, stato: "in_revisione" },
        data: {
          stato: "approvata",
          referenteApprovatoreId: user.id,
          notaRifiuto: null,
        },
      });
      if (result.count === 0) {
        return null;
      }

      const seg = await tx.segnalazione.findUnique({ where: { id } });

      await tx.storicoStato.create({
        data: {
          segnalazioneId: id,
          statoPrecedente: "in_revisione",
          statoNuovo: "approvata",
          userId: user.id,
          nota: "Approvata dal referente territoriale",
        },
      });
      return seg;
    });
    if (aggiornata === null) {
      return NextResponse.json(
        { error: "La segnalazione non è più in stato di revisione (potrebbe essere stata modificata concorrentemente). Ricarica la pagina." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { segnalazione: aggiornata },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    logger.error({ err: e }, "Errore approvazione");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
