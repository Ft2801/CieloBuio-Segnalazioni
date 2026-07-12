/**
 * API: POST /api/auth/logout
 * Logout: cancella la sessione corrente
 * Autore: Fabio Tempera (2026)
 */

import { NextResponse } from "next/server";
import { destroySession, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  await destroySession();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
