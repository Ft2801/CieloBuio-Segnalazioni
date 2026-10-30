/**
 * API: DELETE /api/allegati?id=<allegatoId>
 * Eliminazione di un allegato di una segnalazione.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro, verificaPercorsoFisicoAllegato } from "@/lib/path-guard";
import { unlink } from "fs/promises";
import { logger } from "@/lib/logger";

import { prossimaVersione, versioneCorrisponde } from "@/lib/versione";

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
      { status: 400 },
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
    user.ruolo === "volontario" && segnalazione.volontarioId === user.id && segnalazione.stato === "bozza";
  const isReviewer = canReviewSegnalazioni(user);
  // Usa l'helper centralizzato hasTerritorialCompetence da auth.ts (DRY).
  // L'admin ha competenza totale, i referenti solo sul proprio territorio.
  const hasCompetence = user.ruolo === "admin" || (isReviewer && hasTerritorialCompetence(user, segnalazione));

  if (!isOwnerInBozza && !hasCompetence) {
    return NextResponse.json({ error: "Non autorizzato a eliminare questo allegato" }, { status: 403 });
  }

  // Elimina PRIMA il record DB, poi il file fisico: in caso di fallimento
  // del filesystem, il DB resta consistente e il cron cleanupFileOrfani
  // rimuoverà il file residuo in un secondo momento.
  // La protezione da path traversal è centralizzata in path-guard.ts.
  //
  // Blocca la riga della pratica: una modifica di stato concorrente deve
  // attendere questa DELETE, oppure la DELETE vede lo stato già aggiornato.
  // La sola condizione relazionale nella DELETE non bloccherebbe la riga
  // parent e potrebbe leggere uno stato obsoleto in READ COMMITTED.
  const deleteResult = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM segnalazioni WHERE id = ${allegato.segnalazioneId} FOR UPDATE`;
    const corrente = await tx.allegato.findUnique({ where: { id }, include: { segnalazione: true } });
    if (!corrente || corrente.segnalazioneId !== allegato.segnalazioneId)
      return { count: 0, updatedAt: undefined, conflitto: false };
    const pratica = corrente.segnalazione;
    if (!STATI_MODIFICABILI.includes(pratica.stato)) return { count: 0, updatedAt: undefined, conflitto: false };
    const proprietario = user.ruolo === "volontario" && pratica.volontarioId === user.id && pratica.stato === "bozza";
    const referente = canReviewSegnalazioni(user) && hasTerritorialCompetence(user, pratica);
    if (!proprietario && !referente) return { count: 0, updatedAt: undefined, conflitto: false };
    if (!versioneCorrisponde(req.headers.get("if-match"), pratica.updatedAt))
      return { count: 0, updatedAt: undefined, conflitto: true };
    const risultato = await tx.allegato.deleteMany({ where: { id, segnalazioneId: allegato.segnalazioneId } });
    if (risultato.count === 0) return { count: 0, updatedAt: undefined, conflitto: false };
    const updatedAt = prossimaVersione(pratica.updatedAt);
    await tx.segnalazione.update({ where: { id: allegato.segnalazioneId }, data: { updatedAt } });
    return { count: risultato.count, updatedAt, conflitto: false };
  });
  if (deleteResult.conflitto) {
    return NextResponse.json(
      { error: "La segnalazione è cambiata. Ricarica prima di eliminare l'allegato." },
      { status: 409 },
    );
  }
  if (deleteResult.count === 0) {
    return NextResponse.json({ error: "Allegato non trovato o segnalazione non più modificabile" }, { status: 404 });
  }

  const parsed = parseUrlStorageSicuro(allegato.urlStorage);
  if (parsed && parsed.segnalazioneId === allegato.segnalazioneId) {
    const filePath = risolviPathAllegatoSicuro(parsed.segnalazioneId, parsed.filename);
    if (filePath) {
      try {
        await verificaPercorsoFisicoAllegato(filePath);
        await unlink(filePath);
      } catch (e) {
        // Se il file non esiste (ENOENT), ignora: è già stato rimosso.
        // Altri errori (permessi, I/O) vengono loggati come warning per
        // dare visibilità: il cron cleanupFileOrfani ripulirà in seguito.
        logger.warn({ err: e, filePath, allegatoId: id }, "Errore non bloccante durante eliminazione file allegato");
      }
    }
  }

  return NextResponse.json({ ok: true, updatedAt: deleteResult.updatedAt });
}
