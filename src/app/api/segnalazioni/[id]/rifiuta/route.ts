/**
 * API: POST /api/segnalazioni/[id]/rifiuta
 * Rifiuto da parte del referente territoriale.
 * Transizione: in_revisione -> bozza (con nota del referente)
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { notificaVolontarioRifiuto } from "@/lib/notifiche";
import { logger } from "@/lib/logger";

import { versioneCorrisponde } from "@/lib/versione";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canReviewSegnalazioni(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({ where: { id } });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  // Verifica competenza territoriale con helper centralizzato (fail-closed).
  // Un referente senza territorio assegnato non può rifiutare segnalazioni.
  if (!hasTerritorialCompetence(user, segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato per questa segnalazione" }, { status: 403 });
  }

  if (!versioneCorrisponde(req.headers.get("if-match"), segnalazione.updatedAt)) {
    return NextResponse.json(
      { error: "La segnalazione è cambiata. Ricarica e verifica i dati prima di procedere." },
      { status: 409 },
    );
  }

  if (segnalazione.stato !== "in_revisione") {
    return NextResponse.json({ error: "La segnalazione non è in stato di revisione" }, { status: 400 });
  }

  const body: Record<string, unknown> | null = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }
  const notaRifiuto = typeof body.nota === "string" ? body.nota.trim() : "";
  if (!notaRifiuto) {
    return NextResponse.json({ error: "La nota di rifiuto è obbligatoria" }, { status: 400 });
  }
  // Validazione lunghezza: previene abusi (stringhe enormi nel DB e nello storico)
  if (notaRifiuto.length > 2000) {
    return NextResponse.json({ error: "La nota di rifiuto è troppo lunga (massimo 2000 caratteri)" }, { status: 400 });
  }

  try {
    // Transazione interattiva: updateMany e storicoStato.create nello stesso
    // blocco atomico. Se la create dello storico fallisce, anche l'updateMany
    // viene annullato: ogni transizione di stato ha il suo record di audit.
    const aggiornata = await db.$transaction(async (tx) => {
      // Update atomica con clausola WHERE su stato="in_revisione": previene
      // race condition tra findUnique e update (lo stato potrebbe cambiare
      // concorrentemente, ad es. un altro referente approva nello stesso
      // istante). Se count=0, lo stato è cambiato: rispondiamo 409 Conflict.
      const result = await tx.segnalazione.updateMany({
        where: {
          id,
          stato: "in_revisione",
          updatedAt: segnalazione.updatedAt,
          volontarioId: segnalazione.volontarioId,
          provinciaId: segnalazione.provinciaId,
          regioneId: segnalazione.regioneId,
          invioPecLockToken: null,
        },
        data: {
          stato: "bozza",
          // Un rifiuto non è un'approvazione: il referente resta nello
          // storico, ma il campo mostrato come "Approvata da" deve essere vuoto.
          referenteApprovatoreId: null,
          notaRifiuto,
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
          statoNuovo: "bozza",
          userId: user.id,
          nota: `Rifiutata dal referente: ${notaRifiuto}`,
        },
      });
      return seg;
    });
    if (aggiornata === null) {
      return NextResponse.json(
        {
          error:
            "La segnalazione non è più in stato di revisione (potrebbe essere stata modificata concorrentemente). Ricarica la pagina.",
        },
        { status: 409 },
      );
    }

    // Notifica email al volontario: non bloccante, gli errori sono loggati.
    notificaVolontarioRifiuto(id, notaRifiuto, user.nomeCognome).catch((e: unknown) => {
      logger.error({ err: e, segnalazioneId: id }, "Notifica rifiuto al volontario fallita");
    });

    return NextResponse.json({ segnalazione: aggiornata }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    logger.error({ err: e }, "Errore rifiuto");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
