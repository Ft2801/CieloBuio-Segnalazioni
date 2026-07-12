/**
 * Logica di anonimizzazione GDPR per le segnalazioni.
 * Chiamata da `anonimizzaSegnalazioniGdpr` in cron-utils.ts, che è
 * condivisa tra cron-jobs.ts (esecuzione schedulata) e
 * /api/reminder (esecuzione manuale admin) per evitare drift.
 *
 * Autore: Fabio Tempera (2026)
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isSafePathSegment, UPLOADS_ROOT } from "@/lib/path-guard";
import { rm } from "fs/promises";
import path from "path";

/**
 * Anonimizza una singola segnalazione rimuovendo tutti i PII.
 * Utilizzata sia dal cron job automatico che dall'endpoint admin manuale.
 *
 * Oltre a cancellare i record DB degli allegati, cancella anche i file
 * fisici su disco in storage/uploads/<segnalazioneId>/, coerente
 * con quanto dichiarato in PRIVACY.md e SECURITY.md.
 */
export async function anonimizzaSegnalazione(
  segnalazioneId: string,
  retentionAnni: number,
  userId: string | null = null
): Promise<void> {
  // Recupera gli allegati prima di cancellarli dal DB (per avere gli urlStorage)
  const allegati = await db.allegato.findMany({
    where: { segnalazioneId },
    select: { id: true, urlStorage: true },
  });

  // Elimina i record DB degli allegati
  await db.allegato.deleteMany({
    where: { segnalazioneId },
  });

  // Elimina i file fisici su disco
  const segnalazioneDir = path.resolve(UPLOADS_ROOT, segnalazioneId);

  // Verifica che il path sia dentro UPLOADS_ROOT (defense-in-depth)
  // e che il segnalazioneId sia un segmento di path sicuro (no `..`, `/`, `\`).
  if (
    isSafePathSegment(segnalazioneId) &&
    segnalazioneDir.startsWith(UPLOADS_ROOT + path.sep)
  ) {
    try {
      // Elimina l'intera directory della segnalazione (tutti gli allegati)
      await rm(segnalazioneDir, { recursive: true, force: true });
      logger.info({ segnalazioneId, filesDeleted: allegati.length }, "File fisici allegati eliminati durante anonimizzazione GDPR");
    } catch (e) {
      // La directory potrebbe non esistere (allegati caricati ma poi mossi)
      // o esser già stata cancellata. Logga ma non bloccare l'anonimizzazione.
      logger.warn({ segnalazioneId, err: e }, "Impossibile eliminare file fisici durante anonimizzazione GDPR (non bloccante)");
    }
  }

  // Anonimizza la segnalazione
  await db.segnalazione.update({
    where: { id: segnalazioneId },
    data: {
      volontarioId: null,
      indirizzoVia: "[ANONIMIZZATA]",
      // Il CAP viene azzerato: in comuni piccoli con pochi CAP, il CAP
      // residuo potrebbe restringere sensibilmente l'area geografica
      // anche dopo l'anonimizzazione di indirizzo e coordinate.
      // comuneId/provinciaId/regioneId restano per valore statistico,
      // ma a livello di regione/provincia (non singolo CAP).
      cap: null,
      nomeEsercizio: null,
      latitudine: null,
      longitudine: null,
      descrizioneLibera: "[ANONIMIZZATA per scadenza retention]",
      notaAltroTipologia: null,
      notaAltroProblema: null,
      testoIntroduttivoPec: null,
      pecCcAggiuntive: null,
    },
  });

  // Registra l'evento di anonimizzazione nello storico
  await db.storicoStato.create({
    data: {
      segnalazioneId,
      statoPrecedente: null,
      statoNuovo: null,
      userId,
      nota: `Anonimizzazione GDPR: segnalazione chiusa da più di ${retentionAnni} anni. Dati personali rimossi, allegati eliminati (DB e file fisici).`,
    },
  });

  logger.info({ segnalazioneId, retentionAnni }, "Segnalazione anonimizzata per GDPR retention");
}
