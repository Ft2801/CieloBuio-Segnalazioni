/**
 * API: DELETE /api/allegati?id=<allegatoId>
 * Eliminazione di un allegato di una segnalazione.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro } from "@/lib/path-guard";
import { unlink } from "fs/promises";

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID obbligatorio" }, { status: 400 });
  }

  const allegato = await db.allegato.findUnique({
    where: { id },
    include: { segnalazione: true },
  });
  if (!allegato) {
    return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  }

  const segnalazione = allegato.segnalazione;

  // L'eliminazione di un allegato richiede il diritto di MODIFICA, non la
  // sola visibilità in lettura. Inoltre è permessa solo negli stati
  // modificabili della segnalazione (bozza, in_revisione): dopo l'invio
  // o la chiusura, nessun allegato può essere rimosso (vedi anche
  // PUT /api/segnalazioni/[id] e POST /api/upload che applicano lo
  // stesso vincolo).
  //
  // Permesso concesso a:
  // - proprietario (volontario) se la segnalazione è ancora in bozza
  // - referente/admin con competenza territoriale se la segnalazione è
  //   in bozza o in_revisione
  const STATI_MODIFICABILI = ["bozza", "in_revisione"];
  if (!STATI_MODIFICABILI.includes(segnalazione.stato)) {
    return NextResponse.json(
      { error: "Non si possono eliminare allegati dopo l'invio della segnalazione" },
      { status: 400 }
    );
  }

  // Il proprietario (volontario) può eliminare un allegato SOLO se la
  // segnalazione è ancora in "bozza": una volta inviata in revisione al
  // referente, il pacchetto probatorio è "congelato" e non può più essere
  // alterato dal volontario (coerente con PUT /api/segnalazioni/[id] che
  // nega la modifica al proprietario in stato "in_revisione").
  // I referenti con competenza territoriale e gli admin possono invece
  // eliminare allegati sia in "bozza" sia in "in_revisione" (es. per
  // rimuovere contenuto inappropriato prima dell'approvazione).
  const isOwnerInBozza =
    segnalazione.volontarioId === user.id && segnalazione.stato === "bozza";
  const isReviewer = canReviewSegnalazioni(user);
  // Usa l'helper centralizzato hasTerritorialCompetence da auth.ts (DRY).
  // L'admin ha competenza totale, i referenti solo sul proprio territorio.
  const hasCompetence =
    user.ruolo === "admin" ||
    (isReviewer && hasTerritorialCompetence(user, segnalazione));

  if (!isOwnerInBozza && !hasCompetence) {
    return NextResponse.json(
      { error: "Non autorizzato a eliminare questo allegato" },
      { status: 403 }
    );
  }

  // L4: path traversal protection centralizzata in path-guard.ts.
  const parsed = parseUrlStorageSicuro(allegato.urlStorage);
  if (parsed && parsed.segnalazioneId === allegato.segnalazioneId) {
    const filePath = risolviPathAllegatoSicuro(parsed.segnalazioneId, parsed.filename);
    if (filePath) {
      try {
        await unlink(filePath);
      } catch {
        // Se il file non esiste, ignora
      }
    }
  }

  await db.allegato.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
