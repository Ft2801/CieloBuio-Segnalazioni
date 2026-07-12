/**
 * API: GET /api/auth/me
 * Restituisce i dati dell'utente attualmente autenticato
 * Autore: Fabio Tempera (2026)
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({ user });
}
