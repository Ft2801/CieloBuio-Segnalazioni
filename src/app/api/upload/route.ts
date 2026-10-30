/**
 * API: POST /api/upload
 *
 * Caricamento di un allegato (foto o documento) per una segnalazione.
 *
 * Flusso:
 *  1. Autenticazione (getSessionUser)
 *  2. Rate limiting: 20 upload al minuto per utente
 *  3. Controllo preventivo su Content-Length e limite sul flusso reale
 *  4. Parsing multipart/form-data entro il limite
 *  5. Validazione campi obbligatori: file, segnalazioneId (CUID sicuro)
 *  6. Validazione tipo (foto|documento, default "foto" se omesso)
 *  7. Validazione dimensione (max 10 MB)
 *  8. Validazione estensione (.jpg/.jpeg/.png/.webp/.pdf)
 *  9. Verifica esistenza e visibilità segnalazione (canViewSegnalazione)
 * 10. Blocco upload dopo stati finali (approvata, inviata, in_attesa,
 *     chiusa_positiva, chiusa_negativa): il pacchetto probatorio è
 *     congelato e non può essere alterato. Il volontario proprietario
 *     carica solo in stato "bozza".
 * 11. Verifica magic bytes (JPG/PNG/WebP/PDF) per prevenire upload di
 *     file mascherati con estensione innocua (es. eseguibile rinominato .jpg)
 * 12. Scrittura su filesystem in storage/uploads/<segnalazioneId>/<uuid>.<ext>
 * 13. Creazione del record in db.allegato in transazione, con lock di riga
 *     sulla segnalazione (SELECT ... FOR UPDATE) e limite di allegati per
 *     segnalazione. Se la scrittura o il record falliscono, il file scritto
 *     al passo 12 viene rimosso.
 *
 * Il file viene salvato con nome generato server-side (randomUUID) per
 * prevenire path traversal e collisioni. urlStorage è l'identificatore
 * logico <segnalazioneId>/<filename>, usato da download/preview per
 * ricostruire il path reale (vedi api/allegati/[id]/download).
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canViewSegnalazione } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidCuid, isSafePathSegment, UPLOADS_ROOT } from "@/lib/path-guard";
import { MAX_ALLEGATI_PER_SEGNALAZIONE, MAX_ALLEGATO_BYTE } from "@/lib/types";
import { chmod, lstat, writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";

import { prossimaVersione, versioneCorrisponde } from "@/lib/versione";

// Configurazione dei limiti e delle estensioni ammesse.
const MAX_FILE_SIZE = MAX_ALLEGATO_BYTE; // 10 MB (centralizzato in types.ts)
const TIPI_AMMESSI = ["foto", "documento"];
const EXT_AMMESSE = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
const STATI_BLOCCATI = ["approvata", "inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"];
const RATE_LIMIT_MAX = 20; // 20 upload/minuto per utente
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
// Margine per le intestazioni e i campi del form multipart oltre al file.
const MARGINE_MULTIPART_BYTE = 64 * 1024;

// Mappa estensione -> content-type per la risposta JSON.
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * Verifica che i magic bytes del buffer corrispondano all'estensione
 * dichiarata. Questo previene l'upload di file malevoli mascherati con
 * estensione innocua (es. un eseguibile rinominato .jpg).
 *
 * Controlli (signature minima sufficiente a distinguere i formati):
 *  - JPG/JPEG: FF D8 FF (primi 3 byte)
 *  - PNG: 89 50 4E 47 (primi 4 byte; la signature completa è 8 byte ma
 *    i primi 4 bastano per distinguere da altri formati)
 *  - WebP: "RIFF" ai byte 0-3 + "WEBP" ai byte 8-11 (minimo 12 byte)
 *  - PDF: "%PDF" (25 50 44 46, primi 4 byte)
 *
 * Ritorna false anche se il buffer è troppo corto per la signature attesa,
 * per non accedere a indici fuori range.
 *
 * Esportata per consentirne il test diretto con estensioni non ammesse
 * (il ramo `return false` finale è altrimenti irraggiungibile tramite
 * l'API POST, che filtra ext contro EXT_AMMESSE prima di chiamare la
 * funzione).
 */
export function verificaMagicBytes(buffer: Uint8Array, ext: string): boolean {
  if (ext === ".jpg" || ext === ".jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === ".png") {
    return buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (ext === ".webp") {
    // WebP: "RIFF" + 4 byte di size + "WEBP". Servono almeno 12 byte.
    return (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && // R
      buffer[1] === 0x49 && // I
      buffer[2] === 0x46 && // F
      buffer[3] === 0x46 && // F
      buffer[8] === 0x57 && // W
      buffer[9] === 0x45 && // E
      buffer[10] === 0x42 && // B
      buffer[11] === 0x50 // P
    );
  }
  if (ext === ".pdf") {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x25 && // %
      buffer[1] === 0x50 && // P
      buffer[2] === 0x44 && // D
      buffer[3] === 0x46 // F
    );
  }
  return false;
}

export async function POST(req: NextRequest) {
  // 1. Autenticazione.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // 2. Rate limiting: 20 upload al minuto per utente.
  const rl = checkRateLimit(
    `upload:${user.id}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppi upload. Riprova tra ${rl.retryAfterSeconds} secondi.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  // 3. Controllo preventivo sulla dimensione del corpo. Il limite di
  //    bodySizeLimit in next.config non si applica ai route handler, quindi
  //    si rifiuta prima di leggere il body un Content-Length oltre la soglia.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + MARGINE_MULTIPART_BYTE) {
    return NextResponse.json(
      { error: `Richiesta troppo grande (max ${MAX_FILE_SIZE / (1024 * 1024)} MB per allegato)` },
      { status: 413 },
    );
  }

  // 4. Non ci si può fidare del Content-Length: nelle richieste chunked è
  //    assente e un client può dichiarare una dimensione errata. Misurare i
  //    byte mentre il parser riceve il flusso evita di caricare integralmente
  //    un corpo arbitrario in memoria prima della verifica di file.size.
  if (!req.body) {
    return NextResponse.json({ error: "Richiesta non multipart/form-data valida" }, { status: 400 });
  }
  let bytesRicevuti = 0;
  let troppoGrande = false;
  const massimoBody = MAX_FILE_SIZE + MARGINE_MULTIPART_BYTE;
  const flussoLimitato = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRicevuti += chunk.byteLength;
        if (bytesRicevuti > massimoBody) {
          troppoGrande = true;
          controller.error(new Error("Corpo dell'upload troppo grande"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const richiestaLimitata = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: flussoLimitato,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const formData = await richiestaLimitata.formData().catch(() => null);
  if (troppoGrande) {
    return NextResponse.json(
      { error: `Richiesta troppo grande (max ${MAX_FILE_SIZE / (1024 * 1024)} MB per allegato)` },
      { status: 413 },
    );
  }
  if (!formData) {
    return NextResponse.json({ error: "Richiesta non multipart/form-data valida" }, { status: 400 });
  }

  // 5. Estrazione e validazione campi obbligatori (file + segnalazioneId).
  const file = formData.get("file");
  const segnalazioneIdRaw = formData.get("segnalazioneId");
  const segnalazioneId = typeof segnalazioneIdRaw === "string" ? segnalazioneIdRaw.trim() : "";

  if (!(file instanceof File) || !segnalazioneId) {
    return NextResponse.json({ error: "File e segnalazioneId sono obbligatori" }, { status: 400 });
  }

  // 5b. Validazione difensiva del formato di segnalazioneId: deve essere un
  // CUID valido (formato Prisma) e un segmento di path sicuro. La lookup
  // nel DB che segue rimane il gate principale, ma questo check previene
  // input palesemente malevoli (es. "../../etc/passwd") prima ancora di
  // interrogare il database, riducendo la superficie di attacco e rendendo
  // coerente la difesa con le altre route che manipolano path di allegati.
  if (!isValidCuid(segnalazioneId) || !isSafePathSegment(segnalazioneId)) {
    return NextResponse.json({ error: "segnalazioneId non valido" }, { status: 400 });
  }

  // 6. Validazione tipo (default "foto" se omesso o vuoto).
  const tipoRaw = formData.get("tipo");
  const tipoStr = typeof tipoRaw === "string" ? tipoRaw.trim() : "";
  const tipo = tipoStr === "" ? "foto" : tipoStr;
  if (!TIPI_AMMESSI.includes(tipo)) {
    return NextResponse.json({ error: "Tipo non valido (ammessi: foto, documento)" }, { status: 400 });
  }

  // 7. Validazione dimensione. Il check su file.size avviene prima di
  //    leggere il contenuto, per non caricare in memoria file spropositati.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File troppo grande (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)` },
      { status: 400 },
    );
  }

  // 8. Validazione estensione dal nome del file.
  const ext = path.extname(file.name).toLowerCase();
  if (!EXT_AMMESSE.includes(ext)) {
    return NextResponse.json(
      { error: "Tipo di file non ammesso (estensioni permesse: .jpg, .jpeg, .png, .webp, .pdf)" },
      { status: 400 },
    );
  }

  try {
    // 9. Verifica esistenza e visibilità della segnalazione.
    const segnalazione = await db.segnalazione.findUnique({
      where: { id: segnalazioneId },
    });
    if (!segnalazione) {
      return NextResponse.json({ error: "Segnalazione non trovata" }, { status: 404 });
    }
    if (!canViewSegnalazione(user, segnalazione)) {
      return NextResponse.json(
        { error: "Non autorizzato a caricare allegati su questa segnalazione" },
        { status: 403 },
      );
    }

    // 10. Blocco upload dopo stati finali: il pacchetto probatorio è
    //    congelato (coerente con DELETE /api/allegati e PUT /api/segnalazioni/[id]).
    if (STATI_BLOCCATI.includes(segnalazione.stato)) {
      return NextResponse.json(
        { error: "Non si possono aggiungere allegati dopo l'invio della segnalazione" },
        { status: 400 },
      );
    }

    // 10b. Il volontario proprietario può caricare allegati solo in stato "bozza".
    // In "in_revisione" solo i referenti/admin possono aggiungere allegati
    // (coerente con PUT segnalazioni e DELETE allegati).
    if (user.ruolo === "volontario" && segnalazione.stato !== "bozza") {
      return NextResponse.json({ error: "Il volontario può caricare allegati solo in stato bozza" }, { status: 400 });
    }

    // 11. Verifica magic bytes. Il contenuto viene letto solo dopo tutti i
    //     controlli precedenti, per minimizzare I/O e CPU nei casi di rifiuto.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!verificaMagicBytes(buffer, ext)) {
      return NextResponse.json(
        { error: "Il contenuto del file non corrisponde all'estensione dichiarata" },
        { status: 400 },
      );
    }

    // 12. Scrittura del file. Il nome è generato server-side (randomUUID) e il
    //     segnalazioneId è già validato come CUID e segmento sicuro (punto 4b):
    //     path.join(UPLOADS_ROOT, segnalazioneId) resta dentro UPLOADS_ROOT.
    //     Il file viene scritto PRIMA del record: se la scrittura o il record
    //     falliscono, il file viene rimosso e non resta alcun orfano.
    const segnalazioneDir = path.resolve(UPLOADS_ROOT, segnalazioneId);
    const fileName = `${randomUUID()}${ext}`;
    const filePath = path.join(segnalazioneDir, fileName);
    await mkdir(UPLOADS_ROOT, { recursive: true, mode: 0o700 });
    const radice = await lstat(UPLOADS_ROOT);
    if (!radice.isDirectory() || radice.isSymbolicLink()) {
      throw new Error("La directory degli allegati non è una directory regolare");
    }
    await chmod(UPLOADS_ROOT, 0o700);
    await mkdir(segnalazioneDir, { recursive: true, mode: 0o700 });
    const directory = await lstat(segnalazioneDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error("La directory della segnalazione non è una directory regolare");
    }
    // Protegge anche gli allegati già presenti nella directory: mkdir con
    // una directory esistente non ne modifica i permessi.
    await chmod(segnalazioneDir, 0o700);
    try {
      // wx rifiuta collisioni e collegamenti simbolici preesistenti.
      await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
    } catch (e) {
      // EEXIST indica che il file non è stato creato da questa richiesta:
      // eliminarlo cancellerebbe un allegato preesistente in caso di collisione.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(filePath, { force: true }).catch((rmErr: unknown) => {
          logger.error({ err: rmErr, filePath }, "Rimozione file parziale dopo errore upload fallita");
        });
      }
      throw e;
    }

    // 13. Record in transazione. Il limite di allegati è verificato dopo aver
    //     bloccato la riga della segnalazione con SELECT ... FOR UPDATE: due
    //     upload concorrenti vengono serializzati e non possono superare il
    //     limite (in READ COMMITTED un semplice count non basterebbe).
    let esitoUpload;
    try {
      esitoUpload = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM segnalazioni WHERE id = ${segnalazioneId} FOR UPDATE`;
        // La prima verifica di stato e permessi è avvenuta prima della
        // scrittura su disco. Ripeterla sotto il lock di riga impedisce che
        // approvazione, cambio di territorio o eliminazione concorrenti
        // inseriscano allegati in una pratica ormai non modificabile.
        const corrente = await tx.segnalazione.findUnique({
          where: { id: segnalazioneId },
          select: { volontarioId: true, provinciaId: true, regioneId: true, stato: true, updatedAt: true },
        });
        if (
          !corrente ||
          !canViewSegnalazione(user, corrente) ||
          STATI_BLOCCATI.includes(corrente.stato) ||
          (user.ruolo === "volontario" && corrente.stato !== "bozza")
        ) {
          throw new Error("SEGNALAZIONE_NON_MODIFICABILE");
        }
        if (!versioneCorrisponde(req.headers.get("if-match"), corrente.updatedAt)) {
          throw new Error("SEGNALAZIONE_NON_MODIFICABILE");
        }
        const count = await tx.allegato.count({
          where: { segnalazioneId },
        });
        if (count >= MAX_ALLEGATI_PER_SEGNALAZIONE) {
          throw new Error("LIMITE_SUPERATO");
        }
        const allegato = await tx.allegato.create({
          data: {
            segnalazioneId,
            tipo,
            urlStorage: `${segnalazioneId}/${fileName}`,
            // Limite difensivo sulla lunghezza del nome originale: alcuni
            // client possono inviare nomi molto lunghi che sforzerebbero il
            // campo del DB o la visualizzazione nella UI.
            nomeOriginale: file.name.slice(0, 255),
          },
        });
        const updatedAt = prossimaVersione(corrente.updatedAt);
        await tx.segnalazione.update({ where: { id: segnalazioneId }, data: { updatedAt } });
        return { allegato, updatedAt };
      });
    } catch (e) {
      await rm(filePath, { force: true }).catch((rmErr: unknown) => {
        logger.error({ err: rmErr, filePath }, "Rimozione file orfano dopo errore upload fallita");
      });
      if (e instanceof Error && e.message === "LIMITE_SUPERATO") {
        return NextResponse.json(
          { error: `Limite massimo di ${MAX_ALLEGATI_PER_SEGNALAZIONE} allegati per segnalazione raggiunto` },
          { status: 400 },
        );
      }
      if (e instanceof Error && e.message === "SEGNALAZIONE_NON_MODIFICABILE") {
        return NextResponse.json(
          { error: "Segnalazione modificata durante il caricamento. Ricarica la pagina prima di riprovare." },
          { status: 409 },
        );
      }
      throw e;
    }

    // Il mime type deriva dall'estensione. Le chiavi di EXT_TO_MIME coincidono
    // con EXT_AMMESSE, già verificata al punto 8: la lookup è sempre definita.
    const mime = EXT_TO_MIME[ext];
    return NextResponse.json({ ...esitoUpload, mime }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore upload allegato");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
