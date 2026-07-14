/**
 * API: GET /api/auth/me
 * Restituisce i dati dell'utente attualmente autenticato.
 *
 * La risposta contiene PII (email, ruolo, provinciaId, regioneId, PEC,
 * indirizzo, firma) e NON deve mai essere memorizzata in cache condivisa:
 * un cache hit in un proxy intermedio potrebbe servire i dati di un
 * utente a un altro. Impostiamo Cache-Control: private, no-store su
 * entrambe le risposte (autenticato e non autenticato) per prevenire
 * qualsiasi forma di caching.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ user }, { headers: NO_STORE_HEADERS });
}
