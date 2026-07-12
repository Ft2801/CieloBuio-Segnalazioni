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

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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
  // Un referente senza territorio assegnato non può rifiutare segnalazioni.
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

  const body = await req.json().catch(() => ({}));
  const notaRifiuto = (body.nota ?? "").toString().trim();
  if (!notaRifiuto) {
    return NextResponse.json(
      { error: "La nota di rifiuto è obbligatoria" },
      { status: 400 }
    );
  }
  // Validazione lunghezza: previene abusi (stringhe enormi nel DB e nello storico)
  if (notaRifiuto.length > 2000) {
    return NextResponse.json(
      { error: "La nota di rifiuto è troppo lunga (massimo 2000 caratteri)" },
      { status: 400 }
    );
  }

  try {
    // Update atomica con clausola WHERE su stato="in_revisione": previene
    // race condition tra findUnique e update (lo stato potrebbe cambiare
    // concorrentemente, ad es. un altro referente approva nello stesso
    // istante). Se count=0, lo stato è cambiato: rispondiamo 409 Conflict.
    const result = await db.segnalazione.updateMany({
      where: { id, stato: "in_revisione" },
      data: {
        stato: "bozza",
        referenteApprovatoreId: user.id,
        notaRifiuto,
      },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "La segnalazione non è più in stato di revisione (potrebbe essere stata modificata concorrentemente). Ricarica la pagina." },
        { status: 409 }
      );
    }

    const aggiornata = await db.segnalazione.findUnique({ where: { id } });

    await db.storicoStato.create({
      data: {
        segnalazioneId: id,
        statoPrecedente: "in_revisione",
        statoNuovo: "bozza",
        userId: user.id,
        nota: `Rifiutata dal referente: ${notaRifiuto}`,
      },
    });

    // Notifica email al volontario (async, non bloccante)
    void notificaVolontarioRifiuto(id, notaRifiuto);

    return NextResponse.json({ segnalazione: aggiornata });
  } catch (e) {
    logger.error({ err: e }, "Errore rifiuto");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
