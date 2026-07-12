/**
 * API: GET /api/segnalazioni/[id]/lettera
 * Restituisce l'HTML della lettera PEC pronta per la stampa (window.print() lato client).
 *
 * Parametri query:
 * - with_attachments=1: include le immagini degli allegati in fondo alla lettera
 *
 * Sicurezza:
 * - Verifica autenticazione
 * - Verifica visibilità segnalazione (canViewSegnalazione) - previene IDOR
 * - HTML escape del nomeOriginale allegati - previene XSS stored
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canViewSegnalazione } from "@/lib/auth";
import { buildLetteraContextFromSegnalazione, generaHtmlLettera } from "@/lib/lettera";
import { parseUrlStorageSicuro, risolviPathAllegatoSicuro } from "@/lib/path-guard";
import { readFile } from "fs/promises";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

// C3: HTML escape helper per prevenire XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const withAttachments = url.searchParams.get("with_attachments") === "1";

  // C1: verifica visibilità prima di procedere
  const segnalazione = await db.segnalazione.findUnique({
    where: { id },
    select: { id: true, volontarioId: true, provinciaId: true, regioneId: true },
  });
  if (!segnalazione) {
    return NextResponse.json({ error: "Segnalazione non trovata" }, { status: 404 });
  }
  if (!canViewSegnalazione(user, segnalazione)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const ctx = await buildLetteraContextFromSegnalazione(id);
    let html = generaHtmlLettera(ctx);

    // Se richiesto, incorpora le immagini degli allegati in fondo alla lettera
    if (withAttachments) {
      const allegati = await db.allegato.findMany({
        where: { segnalazioneId: id, tipo: "foto" },
        orderBy: { createdAt: "asc" },
      });

      if (allegati.length > 0) {
        const immaginiHtml: string[] = [];
        for (const a of allegati) {
          try {
            // L4: path traversal protection centralizzata in path-guard.ts.
            // Parse + validazione segmenti (nessun `..`, `/`, `\`).
            const parsed = parseUrlStorageSicuro(a.urlStorage);
            if (!parsed) continue;
            // Verifica coerenza: l'ID estratto dall'urlStorage deve
            // corrispondere all'ID della segnalazione corrente.
            if (parsed.segnalazioneId !== id) continue;
            // parsed è già validato, risolviPathAllegatoSicuro restituisce
            // sempre un path non null. Cast sicuro.
            const filePath = risolviPathAllegatoSicuro(
              parsed.segnalazioneId,
              parsed.filename
            ) as string;

            const buffer = await readFile(filePath);
            const ext = parsed.filename.slice(parsed.filename.lastIndexOf(".")).toLowerCase();
            const mime =
              ext === ".png" ? "image/png" :
              ext === ".webp" ? "image/webp" :
              "image/jpeg";
            const base64 = buffer.toString("base64");
            // C3: escape del nomeOriginale per prevenire XSS
            const safeNome = escapeHtml(a.nomeOriginale);
            immaginiHtml.push(`
              <div class="allegato">
                <img src="data:${mime};base64,${base64}" alt="${safeNome}" />
                <p class="caption">${safeNome}</p>
              </div>
            `);
          } catch {
            // Ignora file mancanti
          }
        }
        if (immaginiHtml.length > 0) {
          const allegatiSection = `
            <div class="allegati-section">
              <h2>Allegati fotografici</h2>
              <div class="allegati-grid">
                ${immaginiHtml.join("")}
              </div>
            </div>
          `;
          // Inserisci prima del </body>
          html = html.replace("</body>", `${allegatiSection}\n</body>`);
        }
      }
    }

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    // M4: non rivelare dettagli dell'errore al client
    logger.error({ err: e }, "Errore generazione lettera");
    return NextResponse.json(
      { error: "Errore durante la generazione della lettera" },
      { status: 500 }
    );
  }
}
