/**
 * Logica di maintenance centralizzata per evitare drift tra
 * `scripts/cron-jobs.ts` (esecuzione schedulata) e
 * `src/app/api/reminder/route.ts` (esecuzione manuale admin).
 *
 * Storico: la logica era duplicata nei due punti con codice quasi
 * identico, con rischio di drift se una veniva modificata e l'altra no.
 * Ora entrambi i chiamanti invocano le stesse funzioni esportate da qui.
 *
 * Autore: Fabio Tempera (2026)
 */
import { PrismaClient } from "@prisma/client";
import { anonimizzaSegnalazione } from "./gdpr";
import { UPLOADS_ROOT, isSafePathSegment } from "./path-guard";
import { readdir, stat, rm } from "fs/promises";
import path from "path";

// Tipo del client Prisma usato internamente. Accettiamo sia il client
// base PrismaClient (usato negli script standalone come cron-jobs.ts e
// backup-db.ts che girano fuori dal runtime Next.js) sia il client
// esteso con $extends (usato nell'app via src/lib/db.ts). Prisma genera
// tipi diversi per le due varianti, ma i metodi che usiamo qui
// (deleteMany, findMany, updateMany, storicoStato.create) hanno firme
// compatibili in entrambi. Usiamo un tipo permissivo per pragmatismo:
// il type-safety è garantito dai test di integrazione su entrambi i
// chiamanti (cron-jobs.test.ts e reminder.test.ts).
type DbClient = PrismaClient | { [key: string]: any };

/**
 * Default values per le soglie configurabili via env. Centralizzati
 * qui per garantire che cron e API manuale usino gli stessi default.
 */
export const TRANSIZIONE_INVIATA_GIORNI_DEFAULT = 7;
export const RETENTION_SEGNALAZIONI_ANNI_DEFAULT = 10;

export function getTransizioneGiorni(): number {
  return Number(
    process.env.TRANSIZIONE_INVIATA_GIORNI ?? TRANSIZIONE_INVIATA_GIORNI_DEFAULT
  );
}

export function getRetentionAnni(): number {
  return Number(
    process.env.RETENTION_SEGNALAZIONI_ANNI ?? RETENTION_SEGNALAZIONI_ANNI_DEFAULT
  );
}

/**
 * Cleanup delle sessioni scadute. Ritorna il numero di record eliminati.
 */
export async function cleanupSessioniScadute(
  db: DbClient
): Promise<number> {
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
 * @param userId ID utente che ha innescato l'azione (null per cron automatico)
 */
export async function transizioneAutomaticaInviata(
  db: DbClient,
  userId: string | null = null
): Promise<number> {
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
    const result = await db.segnalazione.updateMany({
      where: { id: s.id, stato: "inviata" },
      data: { stato: "in_attesa" },
    });
    if (result.count > 0) {
      await db.storicoStato.create({
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
      transitate++;
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
 * Per garantire la backward-compatibilità con segnalazioni chiuse prima
 * dell'introduzione del campo `dataChiusura`, viene usato un fallback
 * su `updatedAt` solo se `dataChiusura` è null.
 *
 * @param userId ID utente che ha innescato l'azione (null per cron automatico)
 */
export async function anonimizzaSegnalazioniGdpr(
  db: DbClient,
  userId: string | null = null
): Promise<number> {
  const retentionAnni = getRetentionAnni();
  const sogliaRetention = new Date();
  sogliaRetention.setFullYear(sogliaRetention.getFullYear() - retentionAnni);

  // Anonimizza le segnalazioni chiuse da più di RETENTION_SEGNALAZIONI_ANNI.
  // Usa `dataChiusura` come filtro principale (campo dedicato, registrato
  // alla chiusura della pratica). Per le segnalazioni chiuse prima
  // dell'introduzione del campo (dataChiusura = null), usa `updatedAt`
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
    await anonimizzaSegnalazione(s.id, retentionAnni, userId);
    anonimizzate++;
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
 * @returns numero di file/directory orfani rimossi
 */
export async function cleanupFileOrfani(db: DbClient): Promise<number> {
  let rimossi = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(UPLOADS_ROOT);
  } catch {
    // La directory non esiste (setup fresco senza upload): ok.
    return 0;
  }

  // Recupera tutti gli ID segnalazione che hanno almeno un allegato nel DB.
  const allegati = await db.allegato.findMany({
    select: { urlStorage: true },
  });
  // Set di "segnalazioneId/filename" validi (formato attuale).
  const validUrlStorage = new Set<string>(
    allegati.map((a: { urlStorage: string }) => a.urlStorage)
  );

  // Verifica anche le segnalazioni esistenti (anche se non hanno allegati,
  // la directory può esistere per una segnalazione in bozza che non ha
  // ancora caricato allegati).
  const segnalazioniEsistenti = await db.segnalazione.findMany({
    select: { id: true },
  });
  const segnalazioniIdSet = new Set(segnalazioniEsistenti.map((s: { id: string }) => s.id));

  for (const entry of entries) {
    // Valida il nome directory: deve essere un segmento sicuro.
    if (!isSafePathSegment(entry)) continue;
    // Con segmenti sicuri, path.resolve è garantito dentro UPLOADS_ROOT.
    const dirPath = path.resolve(UPLOADS_ROOT, entry);

    let s;
    try {
      s = await stat(dirPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    // Se la directory non corrisponde a nessuna segnalazione esistente,
    // è orfana: rimuovila.
    if (!segnalazioniIdSet.has(entry)) {
      try {
        await rm(dirPath, { recursive: true, force: true });
        rimossi++;
      } catch {
        // ignore
      }
      continue;
    }

    // La segnalazione esiste: verifica i singoli file dentro la directory.
    // Se un file non ha record in `allegato`, è orfano.
    let files: string[] = [];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!isSafePathSegment(file)) continue;
      // Con segmenti sicuri, path.resolve è garantito dentro dirPath.
      const filePath = path.resolve(dirPath, file);
      const urlStorage = `${entry}/${file}`;
      if (!validUrlStorage.has(urlStorage)) {
        try {
          await rm(filePath, { force: true });
          rimossi++;
        } catch {
          // ignore
        }
      }
    }
  }

  return rimossi;
}
