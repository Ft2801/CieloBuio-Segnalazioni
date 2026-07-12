/**
 * API: POST /api/upload
 *
 * Caricamento di un allegato (foto o documento) per una segnalazione.
 *
 * Flusso:
 *  1. Autenticazione (getSessionUser)
 *  2. Rate limiting: 20 upload/minuto per utente
 *  3. Parsing multipart/form-data
 *  4. Validazione campi obbligatori: file, segnalazioneId
 *  5. Validazione tipo (foto|documento, default "foto" se omesso)
 *  6. Validazione dimensione (max 10 MB)
 *  7. Validazione estensione (.jpg/.jpeg/.png/.webp/.pdf)
 *  8. Verifica esistenza e visibilità segnalazione (canViewSegnalazione)
 *  9. Blocco upload dopo stati finali (approvata, inviata, in_attesa,
 *     chiusa_positiva, chiusa_negativa): il pacchetto probatorio è
 *     congelato e non può essere alterato.
 * 10. Limite di 4 allegati per segnalazione
 * 11. Verifica magic bytes (JPG/PNG/WebP/PDF) per prevenire upload di
 *     file mascherati con estensione innocua (es. eseguibile rinominato .jpg)
 * 12. Salvataggio su filesystem in storage/uploads/<segnalazioneId>/<uuid>.<ext>
 * 13. Creazione record in db.allegato
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
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";

// Configurazione dei limiti e delle estensioni ammesse.
const MAX_FILE_SIZE = MAX_ALLEGATO_BYTE; // 10 MB (centralizzato in types.ts)
const TIPI_AMMESSI = ["foto", "documento"];
const EXT_AMMESSE = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
const STATI_BLOCCATI = [
  "approvata",
  "inviata",
  "in_attesa",
  "chiusa_positiva",
  "chiusa_negativa",
];
const RATE_LIMIT_MAX = 20; // 20 upload/minuto per utente
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto

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
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (ext === ".png") {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
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

  // 2. Rate limiting: 20 upload/minuto per utente. Il blocco dura 1 minuto
  //    (coerente con la finestra di osservazione).
  const rl = checkRateLimit(
    `upload:${user.id}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppi upload. Riprova tra ${rl.retryAfterSeconds} secondi.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  // 3. Parsing multipart/form-data. Se il body non è multipart, formData()
  //    lancia un'eccezione che catturiamo qui per restituire un 400 pulito.
  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { error: "Richiesta non multipart/form-data valida" },
      { status: 400 }
    );
  }

  // 4. Estrazione e validazione campi obbligatori (file + segnalazioneId).
  const file = formData.get("file");
  const segnalazioneIdRaw = formData.get("segnalazioneId");
  const segnalazioneId =
    typeof segnalazioneIdRaw === "string" ? segnalazioneIdRaw.trim() : "";

  if (!(file instanceof File) || !segnalazioneId) {
    return NextResponse.json(
      { error: "File e segnalazioneId sono obbligatori" },
      { status: 400 }
    );
  }

  // 4b. Validazione difensiva del formato di segnalazioneId: deve essere un
  // CUID valido (formato Prisma) e un segmento di path sicuro. La lookup
  // nel DB che segue rimane il gate principale, ma questo check previene
  // input palesemente malevoli (es. "../../etc/passwd") prima ancora di
  // interrogare il database, riducendo la superficie di attacco e rendendo
  // coerente la difesa con le altre route che manipolano path di allegati.
  if (!isValidCuid(segnalazioneId) || !isSafePathSegment(segnalazioneId)) {
    return NextResponse.json(
      { error: "segnalazioneId non valido" },
      { status: 400 }
    );
  }

  // 5. Validazione tipo (default "foto" se omesso o vuoto).
  const tipoRaw = formData.get("tipo");
  const tipoStr = typeof tipoRaw === "string" ? tipoRaw.trim() : "";
  const tipo = tipoStr === "" ? "foto" : tipoStr;
  if (!TIPI_AMMESSI.includes(tipo)) {
    return NextResponse.json(
      { error: "Tipo non valido (ammessi: foto, documento)" },
      { status: 400 }
    );
  }

  // 6. Validazione dimensione. Il check su file.size avviene prima di
  //    leggere il contenuto, per non caricare in memoria file spropositati.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File troppo grande (max 10 MB)" },
      { status: 400 }
    );
  }

  // 7. Validazione estensione dal nome del file.
  const ext = path.extname(file.name).toLowerCase();
  if (!EXT_AMMESSE.includes(ext)) {
    return NextResponse.json(
      { error: "Tipo di file non ammesso (estensioni permesse: .jpg, .jpeg, .png, .webp, .pdf)" },
      { status: 400 }
    );
  }

  try {
    // 8. Verifica esistenza e visibilità della segnalazione.
    const segnalazione = await db.segnalazione.findUnique({
      where: { id: segnalazioneId },
    });
    if (!segnalazione) {
      return NextResponse.json(
        { error: "Segnalazione non trovata" },
        { status: 404 }
      );
    }
    if (!canViewSegnalazione(user, segnalazione)) {
      return NextResponse.json(
        { error: "Non autorizzato a caricare allegati su questa segnalazione" },
        { status: 403 }
      );
    }

    // 9. Blocco upload dopo stati finali: il pacchetto probatorio è
    //    congelato (coerente con DELETE /api/allegati e PUT /api/segnalazioni/[id]).
    if (STATI_BLOCCATI.includes(segnalazione.stato)) {
      return NextResponse.json(
        { error: "Non si possono aggiungere allegati dopo l'invio della segnalazione" },
        { status: 400 }
      );
    }

    // 9b. Il volontario proprietario può caricare allegati solo in stato "bozza".
    // In "in_revisione" solo i referenti/admin possono aggiungere allegati
    // (coerente con PUT segnalazioni e DELETE allegati).
    const isOwnerUpload = segnalazione.volontarioId === user.id;
    if (isOwnerUpload && segnalazione.stato !== "bozza") {
      return NextResponse.json(
        { error: "Il volontario può caricare allegati solo in stato bozza" },
        { status: 400 }
      );
    }

    // 10. Limite di 4 allegati per segnalazione, con race condition
    //     prevention via transazione + lock. Senza transazione, due
    //     upload concorrenti potrebbero entrambi passare il check
    //     count >= MAX e inserire 5+ allegati. Usiamo una transazione
    //     che fa count + create in modo atomico.
    // 11. Verifica magic bytes. Leggiamo il contenuto solo dopo tutti i
    //     check precedenti, per minimizzare I/O e CPU nei casi di rifiuto.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!verificaMagicBytes(buffer, ext)) {
      return NextResponse.json(
        { error: "Il contenuto del file non corrisponde all'estensione dichiarata" },
        { status: 400 }
      );
    }

    // 12. Salvataggio su filesystem. Il nome del file è generato server-side
    //     (randomUUID) per prevenire path traversal e collisioni. Il
    //     segnalazioneId è già validato come CUID valido e segmento sicuro
    //     al punto 4b (isValidCuid + isSafePathSegment), quindi
    //     path.resolve(UPLOADS_ROOT, segnalazioneId) è garantito dentro
    //     UPLOADS_ROOT senza bisogno di ulteriori check startsWith.
    const segnalazioneDir = path.resolve(UPLOADS_ROOT, segnalazioneId);
    const fileName = `${randomUUID()}${ext}`;
    const filePath = path.join(segnalazioneDir, fileName);

    // Transazione atomica: count + create + writeFile (logica).
    // Il file fisico viene scritto FUORI dalla transazione DB (writeFile
    // non è un'operazione DB), ma solo DOPO che la transazione DB ha
    // confermato il limite. Se la transazione fallisce (race condition
    // vinta dall'altro upload), il file non viene scritto.
    let allegato;
    try {
      allegato = await db.$transaction(async (tx) => {
        const count = await tx.allegato.count({
          where: { segnalazioneId },
        });
        if (count >= MAX_ALLEGATI_PER_SEGNALAZIONE) {
          throw new Error("LIMITE_SUPERATO");
        }
        const urlStorage = `${segnalazioneId}/${fileName}`;
        return await tx.allegato.create({
          data: {
            segnalazioneId,
            tipo,
            urlStorage,
            nomeOriginale: file.name,
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "LIMITE_SUPERATO") {
        return NextResponse.json(
          { error: "Limite massimo di 4 allegati per segnalazione raggiunto" },
          { status: 400 }
        );
      }
      throw e;
    }

    // 13. La transazione DB ha avuto successo: ora scriviamo il file
    //     fisico. Se la writeFile fallisce (es. disco pieno), il record
    //     DB resta come orfano: sarà pulito dal job di manutenzione.
    await mkdir(segnalazioneDir, { recursive: true });
    await writeFile(filePath, buffer);

    // Il mime type è derivato dall'estensione tramite la mappa EXT_TO_MIME.
    // L'estensione è già stata validata contro EXT_AMMESSE, le cui chiavi
    // coincidono con quelle di EXT_TO_MIME: la lookup è dunque sempre
    // definita e non richiede fallback difensivo.
    const mime = EXT_TO_MIME[ext];
    return NextResponse.json({ allegato, mime }, { status: 201 });
  } catch (e) {
    logger.error({ err: e }, "Errore upload allegato");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
