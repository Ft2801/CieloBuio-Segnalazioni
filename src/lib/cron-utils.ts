/**
 * Logica di maintenance centralizzata per evitare drift tra
 * `scripts/cron-jobs.ts` (esecuzione schedulata) e
 * `src/app/api/reminder/route.ts` (esecuzione manuale admin).
 *
 * Entrambi i chiamanti (cron e route manuale) invocano le stesse funzioni
 * esportate da qui, così la logica non può divergere.
 *
 * Autore: Fabio Tempera (2026)
 */
import { anonimizzaSegnalazione, type DbClient } from "./gdpr";
import { UPLOADS_ROOT, isSafePathSegment, parseUrlStorageSicuro } from "./path-guard";
import { logger } from "./logger";
import { readdir, lstat, rm } from "fs/promises";
import path from "path";

/**
 * Default values per le soglie configurabili via env. Centralizzati
 * qui per garantire che cron e API manuale usino gli stessi default.
 */
export const TRANSIZIONE_INVIATA_GIORNI_DEFAULT = 7;
export const RETENTION_SEGNALAZIONI_ANNI_DEFAULT = 10;
export const REMINDER_GIORNI_DEFAULT = 30;

/** Limiti superiori: oltre questi valori le date calcolate non sono affidabili. */
const MAX_GIORNI = 36500;
const MAX_ANNI = 100;

/**
 * Legge una soglia intera positiva dalle variabili d'ambiente. Valori assenti,
 * vuoti, non interi, <= 0 o oltre `max` producono il default con un warning.
 * I decimali non sono ammessi: una soglia come 7.5 giorni o 10.5 anni
 * produrrebbe date calcolate in modo non prevedibile.
 */
function leggiSogliaIntera(nomeVariabile: string, valoreDefault: number, max: number): number {
  const raw = process.env[nomeVariabile];
  if (raw === undefined || raw.trim() === "") return valoreDefault;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > max) {
    logger.warn(
      { raw, default: valoreDefault, max },
      `[cron-utils] ${nomeVariabile} non valido (atteso intero tra 1 e ${max}), uso default`,
    );
    return valoreDefault;
  }
  return n;
}

/**
 * Soglia giorni oltre la quale una pratica in stato "in_attesa" genera un
 * reminder. Valore non valido: default e warning.
 */
export function getReminderGiorni(): number {
  return leggiSogliaIntera("REMINDER_GIORNI", REMINDER_GIORNI_DEFAULT, MAX_GIORNI);
}

/**
 * Soglia giorni per la transizione automatica "inviata" -> "in_attesa".
 * Un valore malformato (es. "abc") produrrebbe NaN e la findMany non
 * troverebbe nulla, silenziando il cron: per questo il valore viene validato
 * e, se non valido, si usa il default con un warning.
 */
export function getTransizioneGiorni(): number {
  return leggiSogliaIntera("TRANSIZIONE_INVIATA_GIORNI", TRANSIZIONE_INVIATA_GIORNI_DEFAULT, MAX_GIORNI);
}

/** Anni di retention GDPR delle segnalazioni chiuse. Valore non valido: default e warning. */
export function getRetentionAnni(): number {
  return leggiSogliaIntera("RETENTION_SEGNALAZIONI_ANNI", RETENTION_SEGNALAZIONI_ANNI_DEFAULT, MAX_ANNI);
}

/**
 * Cleanup delle sessioni scadute. Ritorna il numero di record eliminati.
 */
export async function cleanupSessioniScadute(db: DbClient): Promise<number> {
  const result = await db.sessione.deleteMany({
    where: { scadenza: { lt: new Date() } },
  });
  return result.count;
}

/**
 * Transizione automatica "inviata" -> "in_attesa" dopo N giorni dall'invio.
 * Usa updateMany con clausola WHERE su stato="inviata" per evitare race
 * condition: se lo stato è cambiato concorrentemente, count=0 e lo storico
 * non viene creato.
 *
 * L'updateMany e la creazione dello storicoStato sono racchiusi in una
 * transazione per garantire coerenza: se la create di storicoStato
 * fallisce, anche l'updateMany viene rollbackato, preservando
 * l'invariante "ogni transizione di stato ha il suo audit record".
 *
 * @param userId ID utente che ha innescato l'azione (null per cron automatico)
 */
export async function transizioneAutomaticaInviata(db: DbClient, userId: string | null = null): Promise<number> {
  const transizioneGiorni = getTransizioneGiorni();
  const sogliaTransizione = new Date();
  sogliaTransizione.setDate(sogliaTransizione.getDate() - transizioneGiorni);
  const daTransitare = await db.segnalazione.findMany({
    where: {
      stato: "inviata",
      dataInvio: { lt: sogliaTransizione },
    },
    select: { id: true },
  });
  let transitate = 0;
  for (const s of daTransitare) {
    try {
      // Transazione interattiva: updateMany + storicoStato.create nello stesso
      // blocco atomico. Se uno dei due step fallisce, l'intera operazione viene
      // annullata, mantenendo coerenza tra stato della segnalazione e audit trail.
      // Il tipo di `tx` è inferito dal client: i metodi chiamati sono verificati
      // dal compilatore.
      const completata = await db.$transaction(async (tx) => {
        const updateResult = await tx.segnalazione.updateMany({
          where: { id: s.id, stato: "inviata", dataInvio: { lt: sogliaTransizione } },
          data: { stato: "in_attesa" },
        });
        if (updateResult && typeof updateResult.count === "number" && updateResult.count > 0) {
          await tx.storicoStato.create({
            data: {
              segnalazioneId: s.id,
              statoPrecedente: "inviata",
              statoNuovo: "in_attesa",
              userId,
              nota:
                userId === null
                  ? `[CRON AUTOMATICO] Transizione eseguita dal job schedulato: nessuna risposta dopo ${transizioneGiorni} giorni dall'invio.`
                  : `Transizione automatica: nessuna risposta dopo ${transizioneGiorni} giorni dall'invio`,
            },
          });
          return true;
        }
        return false;
      });
      // Si conta solo un commit riuscito. Se il commit fallisce dopo la
      // callback, il catch registra l'errore e non dichiara una transizione.
      if (completata) transitate++;
    } catch (e) {
      // Isola l'errore del singolo record: logga e continua con il prossimo.
      // L'alternativa (propagare l'errore) bloccherebbe l'intero cron,
      // lasciando le segnalazioni successive non transitate.
      logger.error(
        { err: e, segnalazioneId: s.id },
        "[cron-utils] Errore transizione automatica singola segnalazione, continuo col prossimo",
      );
    }
  }
  return transitate;
}

/**
 * Anonimizzazione GDPR delle segnalazioni chiuse oltre il periodo di
 * retention (default 10 anni).
 *
 * **Importante**: usa il campo `dataChiusura` (registrato quando lo stato
 * transita a chiusa_positiva/chiusa_negativa) e NON `updatedAt`, perché
 * `updatedAt` si aggiorna ad ogni modifica del record (es. aggiunta di una
 * nota admin) e posticiperebbe falsamente la finestra di retention,
 * ritardando un obbligo GDPR dichiarato in PRIVACY.md come "10 anni dalla
 * chiusura".
 *
 * Le segnalazioni chiuse senza `dataChiusura` valorizzato usano `updatedAt`
 * come riferimento temporale: il fallback si applica solo se `dataChiusura`
 * è null.
 *
 * Ogni segnalazione viene anonimizzata in un blocco try/catch separato:
 * un errore su una singola segnalazione (es. permessi FS, transient DB)
 * non blocca l'anonimizzazione delle restanti, garantendo che il job
 * GDPR rispetti la retention per il maggior numero possibile di record.
 *
 * @param userId ID utente che ha innescato l'azione (null per cron automatico)
 */
export async function anonimizzaSegnalazioniGdpr(db: DbClient, userId: string | null = null): Promise<number> {
  const retentionAnni = getRetentionAnni();
  const sogliaRetention = new Date();
  sogliaRetention.setFullYear(sogliaRetention.getFullYear() - retentionAnni);

  // Anonimizza le segnalazioni chiuse da più di RETENTION_SEGNALAZIONI_ANNI.
  // Usa `dataChiusura` come filtro principale (campo dedicato, registrato
  // alla chiusura della pratica). Se dataChiusura è null, usa `updatedAt`
  // come fallback (vedi commento sopra).
  const daAnonimizzare = await db.segnalazione.findMany({
    where: {
      stato: { in: ["chiusa_positiva", "chiusa_negativa"] },
      OR: [
        { dataChiusura: { lt: sogliaRetention } },
        {
          dataChiusura: null,
          updatedAt: { lt: sogliaRetention },
        },
      ],
      // Evita di processare due volte la stessa segnalazione: identifica
      // quelle già anonimizzate tramite il campo volontarioId null
      NOT: { volontarioId: null },
    },
    select: { id: true },
  });

  let anonimizzate = 0;
  for (const s of daAnonimizzare) {
    try {
      if (await anonimizzaSegnalazione(db, s.id, retentionAnni, userId)) {
        anonimizzate++;
      }
    } catch (e) {
      // Isola l'errore del singolo record: logga e continua. L'obbligo
      // GDPR di anonimizzare entro la retention va bilanciato con la
      // resilienza del job: bloccare tutto su un singolo errore lascerebbe
      // le segnalazioni successive non anonimizzate, prolungando la
      // violazione della retention per tutte loro.
      logger.error(
        { err: e, segnalazioneId: s.id },
        "[cron-utils] Errore anonimizzazione GDPR singola segnalazione, continuo col prossimo",
      );
    }
  }
  return anonimizzate;
}

/**
 * Pulizia dei file orfani in storage/uploads/.
 *
 * Un file orfano è un file presente sul filesystem ma senza un record
 * corrispondente in tabella `allegato`. Si verificano quando:
 *  - Il `rm()` asincrono in DELETE /api/segnalazioni/[id] fallisce
 *    (es. permessi, race, crash del processo prima che il void-async
 *    completi).
 *  - L'anonimizzazione GDPR elimina i record DB ma il `rm()` dei file
 *    fisici fallisce.
 *
 * Questa funzione:
 *  1. Elenca le directory in UPLOADS_ROOT (una per segnalazione).
 *  2. Per ogni directory, recupera tutti i `segnalazioneId` dal DB.
 *  3. Se una directory non corrisponde a nessuna segnalazione esistente,
 *     è orfana e viene rimossa.
 *  4. Per le directory corrispondenti a segnalazioni esistenti, verifica
 *     anche i singoli file: se un file non ha record in `allegato`, è
 *     orfano e viene rimosso.
 *
 * Sicurezza: valida ogni nome directory/file con `isSafePathSegment`
 * prima di qualsiasi operazione, per prevenire path traversal.
 *
 * Gli urlStorage dei record vengono confrontati nel formato
 * `<segnalazioneId>/<filename>` tramite `parseUrlStorageSicuro`: un file
 * referenziato da un record valido non viene mai considerato orfano.
 *
 * @returns numero di file/directory orfani rimossi
 */
export async function cleanupFileOrfani(db: DbClient): Promise<number> {
  let rimossi = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(UPLOADS_ROOT);
  } catch (e) {
    // Directory assente (setup senza upload): nessun orfano da rimuovere.
    // Qualunque altro errore (permessi, I/O) va segnalato, non ignorato.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      logger.debug({ err: e }, "[cron-utils] UPLOADS_ROOT assente: nessun file orfano");
    } else {
      logger.warn({ err: e }, "[cron-utils] lettura di UPLOADS_ROOT fallita: pulizia orfani saltata");
    }
    return 0;
  }

  // Recupera tutti gli urlStorage dal DB e li normalizza nel formato
  // `<segnalazioneId>/<filename>`. Un urlStorage non parsabile non
  // corrisponde ad alcun file su disco e quindi non entra nel set.
  const allegati = await db.allegato.findMany({
    select: { urlStorage: true },
  });
  const validUrlStorage = new Set<string>();
  for (const a of allegati) {
    const parsed = parseUrlStorageSicuro(a.urlStorage);
    if (parsed) {
      validUrlStorage.add(`${parsed.segnalazioneId}/${parsed.filename}`);
    }
  }

  // Verifica anche le segnalazioni esistenti (anche se non hanno allegati,
  // la directory può esistere per una segnalazione in bozza che non ha
  // ancora caricato allegati).
  const segnalazioniEsistenti = await db.segnalazione.findMany({
    select: { id: true },
  });
  const segnalazioniIdSet = new Set(segnalazioniEsistenti.map((s: { id: string }) => s.id));

  // Soglia di sicurezza: non consideriamo "orfani" i file modificati negli
  // ultimi 5 minuti. Questo previene la cancellazione di file appena scritti
  // da un upload concorrente che non ha ancora creato il record DB
  // (race condition tra la scrittura del file su disco e la INSERT in
  // tabella allegato). 5 minuti è un margine ampio rispetto al tempo
  // tipico di una INSERT, ma abbastanza corto da non accumulare troppi
  // falsi negativi tra un'esecuzione del cron e la successiva.
  const SOGLIA_RECENTE_MS = 5 * 60 * 1000;
  const ora = Date.now();

  for (const entry of entries) {
    // Valida il nome directory: deve essere un segmento sicuro.
    if (!isSafePathSegment(entry)) continue;
    // Con segmenti sicuri, path.resolve è garantito dentro UPLOADS_ROOT.
    const dirPath = path.resolve(UPLOADS_ROOT, entry);

    let s;
    try {
      // lstat non segue una directory simbolica verso file esterni allo storage.
      s = await lstat(dirPath);
    } catch (e) {
      logger.debug({ err: e, dirPath }, "[cron-utils] stat directory fallito, skip");
      continue;
    }
    if (!s.isDirectory()) continue;

    // Se la directory non corrisponde a nessuna segnalazione esistente,
    // è orfana: rimuovila solo se non è stata modificata di recente
    // (upload in corso con file scritto ma INSERT non ancora avvenuta).
    if (!segnalazioniIdSet.has(entry)) {
      if (ora - s.mtimeMs < SOGLIA_RECENTE_MS) {
        logger.debug({ dirPath }, "[cron-utils] directory orfana recente (possibile upload in corso), skip");
        continue;
      }
      try {
        await rm(dirPath, { recursive: true, force: true });
        rimossi++;
      } catch (e) {
        logger.warn({ err: e, dirPath }, "[cron-utils] rm directory orfana fallito");
      }
      continue;
    }

    // La segnalazione esiste: verifica i singoli file dentro la directory.
    // Se un file non ha record in `allegato`, è orfano.
    let files: string[] = [];
    try {
      files = await readdir(dirPath);
    } catch (e) {
      logger.debug({ err: e, dirPath }, "[cron-utils] readdir files fallito, skip");
      continue;
    }
    for (const file of files) {
      if (!isSafePathSegment(file)) continue;
      // Con segmenti sicuri, path.resolve è garantito dentro dirPath.
      const filePath = path.resolve(dirPath, file);
      const urlStorage = `${entry}/${file}`;
      if (!validUrlStorage.has(urlStorage)) {
        // Check mtime anche sui singoli file: un upload appena completato
        // potrebbe aver scritto il file ma non ancora commititato il
        // record in tabella allegato.
        try {
          const fileStat = await lstat(filePath);
          if (ora - fileStat.mtimeMs < SOGLIA_RECENTE_MS) {
            logger.debug({ filePath }, "[cron-utils] file orfano recente (possibile upload in corso), skip");
            continue;
          }
        } catch (e) {
          logger.debug({ err: e, filePath }, "[cron-utils] stat file fallito, skip");
          continue;
        }
        try {
          await rm(filePath, { force: true });
          rimossi++;
        } catch (e) {
          logger.warn({ err: e, filePath }, "[cron-utils] rm file orfano fallito");
        }
      }
    }
  }

  return rimossi;
}
