/**
 * API: POST /api/auth/logout
 * Logout: cancella la sessione corrente
 * Autore: Fabio Tempera (2026)
 */

import { NextResponse } from "next/server";
import { destroySession, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  // destroySession() è best-effort: logga internamente i fallimenti DB
  // come warning ma non propaga l'errore, così il client riceve sempre
  // una risposta 200 e cancella comunque il cookie lato browser. Anche
  // se il record della sessione restasse nel DB (es. DB transient down),
  // la sessione sarebbe inutilizzabile dal client (cookie cancellato)
  // e verrebbe eliminata dal cron cleanupSessioniScadute.
  await destroySession();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
