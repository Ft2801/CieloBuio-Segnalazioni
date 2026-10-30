/**
 * Anonimizzazione GDPR di una singola segnalazione.
 * Usata dal job schedulato e dall'azione amministrativa di manutenzione.
 * La pratica viene verificata di nuovo nella transazione prima di rimuovere
 * i dati, così una riapertura concorrente non anonimizza una pratica attiva.
 */
import type { db as AppDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isSafePathSegment, UPLOADS_ROOT } from "@/lib/path-guard";
import { rm } from "fs/promises";
import path from "path";

export type DbClient = typeof AppDb;

const PLACEHOLDER_ANONIMIZZATO = "[ANONIMIZZATA]";

/**
 * Anonimizza una pratica chiusa oltre la soglia di conservazione.
 * Restituisce false se lo stato, la data di chiusura o il collegamento al
 * volontario sono cambiati nel frattempo. I file sono rimossi dopo il commit;
 * il job di pulizia recupera eventuali file residui in caso di errore I/O.
 */
export async function anonimizzaSegnalazione(
  client: DbClient,
  segnalazioneId: string,
  retentionAnni: number,
  userId: string | null = null,
): Promise<boolean> {
  const soglia = new Date();
  soglia.setFullYear(soglia.getFullYear() - retentionAnni);

  const eliminati = await client.$transaction(async (tx) => {
    const { count } = await tx.segnalazione.updateMany({
      where: {
        id: segnalazioneId,
        volontarioId: { not: null },
        stato: { in: ["chiusa_positiva", "chiusa_negativa"] },
        OR: [{ dataChiusura: { lt: soglia } }, { dataChiusura: null, updatedAt: { lt: soglia } }],
      },
      data: {
        volontarioId: null,
        indirizzoVia: PLACEHOLDER_ANONIMIZZATO,
        cap: null,
        nomeEsercizio: null,
        latitudine: null,
        longitudine: null,
        descrizioneLibera: PLACEHOLDER_ANONIMIZZATO,
        notaAltroTipologia: null,
        notaAltroProblema: null,
        testoIntroduttivoPec: null,
        pecCcAggiuntive: null,
        notaRifiuto: null,
        destinatarioNome: null,
        oggettoPec: null,
      },
    });
    if (count === 0) return null;

    const allegati = await tx.allegato.deleteMany({ where: { segnalazioneId } });
    await tx.storicoStato.updateMany({ where: { segnalazioneId }, data: { nota: null } });
    await tx.logInvioPec.updateMany({
      where: { segnalazioneId, tipo: "simula" },
      data: { destinatari: PLACEHOLDER_ANONIMIZZATO, oggetto: PLACEHOLDER_ANONIMIZZATO, messaggioErrore: null },
    });
    // I destinatari delle PEC reali restano per la prova dell'invio; l'oggetto
    // è testo libero e può contenere PII, perciò viene anonimizzato.
    await tx.logInvioPec.updateMany({
      where: { segnalazioneId, tipo: { not: "simula" } },
      data: { oggetto: PLACEHOLDER_ANONIMIZZATO, messaggioErrore: null },
    });
    await tx.storicoStato.create({
      data: {
        segnalazioneId,
        statoPrecedente: null,
        statoNuovo: null,
        userId,
        nota: `Anonimizzazione GDPR: segnalazione chiusa da più di ${retentionAnni} anni. Dati personali rimossi, allegati eliminati (DB e file fisici).`,
      },
    });
    return allegati.count;
  });
  if (eliminati === null) return false;

  const segnalazioneDir = path.resolve(UPLOADS_ROOT, segnalazioneId);
  if (isSafePathSegment(segnalazioneId) && segnalazioneDir.startsWith(UPLOADS_ROOT + path.sep)) {
    try {
      await rm(segnalazioneDir, { recursive: true, force: true });
      logger.info(
        { segnalazioneId, filesDeleted: eliminati },
        "File fisici allegati eliminati durante anonimizzazione GDPR",
      );
    } catch (e) {
      logger.warn(
        { segnalazioneId, err: e },
        "Impossibile eliminare file fisici durante anonimizzazione GDPR (non bloccante, cleanupFileOrfani rimuoverà gli orfani)",
      );
    }
  }

  logger.info({ segnalazioneId, retentionAnni }, "Segnalazione anonimizzata per GDPR retention");
  return true;
}
