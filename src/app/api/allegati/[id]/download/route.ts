/**
 * API: GET /api/allegati/[id]/download
 *
 * Scarica un allegato. Verifica:
 * - Autenticazione
 * - Visibilità della segnalazione collegata (canViewSegnalazione)
 * - Path traversal protection
 *
 * Imposta header di sicurezza: Content-Disposition: attachment,
 * X-Content-Type-Options: nosniff, Content-Type dal tipo file.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canViewSegnalazione } from "@/lib/auth";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro, verificaPercorsoFisicoAllegato } from "@/lib/path-guard";
import { readFile, stat } from "fs/promises";

type Params = { params: Promise<{ id: string }> };

// Mappa estensione -> content-type
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

  // Verifica visibilità della segnalazione
  if (!canViewSegnalazione(user, allegato.segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // La protezione da path traversal è centralizzata in path-guard.ts.
  // Parse + validazione segmenti (nessun `..`, `/`, `\`, `\0`).
  // Coerenza con segnalazioneId del record DB.
  const parsed = parseUrlStorageSicuro(allegato.urlStorage);
  if (!parsed) {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }
  if (parsed.segnalazioneId !== allegato.segnalazioneId) {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }
  // risolviPathAllegatoSicuro restituisce null solo per segmenti non sicuri:
  // il controllo è una difesa in profondità e non un caso ordinario.
  const filePath = risolviPathAllegatoSicuro(parsed.segnalazioneId, parsed.filename);
  if (!filePath) {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }

  try {
    await verificaPercorsoFisicoAllegato(filePath);
    const s = await stat(filePath);
    if (!s.isFile()) {
      return NextResponse.json({ error: "File non trovato" }, { status: 404 });
    }
    const buffer = await readFile(filePath);
    const dotIdx = parsed.filename.lastIndexOf(".");
    const ext = dotIdx >= 0 ? parsed.filename.slice(dotIdx).toLowerCase() : "";
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";

    // Sanitizza il nome originale per Content-Disposition
    const safeName = allegato.nomeOriginale.replace(/[^\w.\- ]/g, "_").slice(0, 100);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }
}
