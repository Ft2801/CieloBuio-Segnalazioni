/**
 * API: GET /api/allegati/[id]/preview
 *
 * Serve un allegato per visualizzazione inline (anteprima immagini).
 * A differenza di /download che imposta Content-Disposition: attachment,
 * questa route imposta Content-Disposition: inline per permettere al
 * browser di renderizzare l'immagine in un tag <img>.
 *
 * Stessa verifica di permessi del download.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canViewSegnalazione } from "@/lib/auth";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro } from "@/lib/path-guard";
import { readFile, stat } from "fs/promises";

type Params = { params: Promise<{ id: string }> };

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const allegato = await db.allegato.findUnique({
    where: { id },
    include: { segnalazione: true },
  });
  if (!allegato) {
    return NextResponse.json({ error: "Allegato non trovato" }, { status: 404 });
  }

  if (!canViewSegnalazione(user, allegato.segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // L4: path traversal protection centralizzata in path-guard.ts.
  const parsed = parseUrlStorageSicuro(allegato.urlStorage);
  if (!parsed) {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }
  if (parsed.segnalazioneId !== allegato.segnalazioneId) {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }
  // parsed è già validato da parseUrlStorageSicuro (segmenti sicuri),
  // quindi risolviPathAllegatoSicuro restituisce sempre un path non null.
  const filePath = risolviPathAllegatoSicuro(parsed.segnalazioneId, parsed.filename) as string;

  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      return NextResponse.json({ error: "File non trovato" }, { status: 404 });
    }
    const buffer = await readFile(filePath);
    const ext = parsed.filename.slice(parsed.filename.lastIndexOf(".")).toLowerCase();
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
    const safeName = allegato.nomeOriginale.replace(/[^\w.\- ]/g, "_").slice(0, 100);

    // I PDF vengono serviti come attachment (non inline) per prevenire
    // l'esecuzione di JavaScript embedded nel PDF stesso (PDF.js/Acrobat
    // possono eseguire script nei PDF renderizzati same-origin).
    // Le immagini (JPEG, PNG, WebP) vengono servite inline per l'anteprima.
    const isPdf = ext === ".pdf";
    const disposition = isPdf ? "attachment" : "inline";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }
}
