/**
 * API: GET/POST /api/config/users
 * Elenco e creazione utenti (solo admin).
 * Validazione input con zod.
 * Rate limiting su POST (30/ora per admin) come difesa in profondità
 * contro script automatizzati in caso di compromissione del token admin.
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration, hashPassword } from "@/lib/auth";
import { nuovoUtenteSchema, validate } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      nomeCognome: true,
      ruolo: true,
      provinciaId: true,
      regioneId: true,
      pec: true,
      emailOrdinaria: true,
      indirizzo: true,
      firma: true,
      inizialiProtocollo: true,
      attivo: true,
      createdAt: true,
      provincia: { select: { sigla: true, nome: true } },
      regione: { select: { regione: true } },
    },
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Rate limiting: 30 creazioni utenti per ora per admin. Questi endpoint
  // sono admin-only quindi il rischio è limitato, ma in caso di
  // compromissione del token di sessione admin, un rate limit leggero
  // riduce l'impatto di scripting automatizzato (es. creazione massiva
  // di account malevoli).
  const rl = checkRateLimit(
    `config-users-create:${user.id}`,
    30, // maxAttempts
    60 * 60 * 1000, // windowMs = 1 ora
    60 * 60 * 1000, // blockResetMs = 1 ora
    15 * 60 * 1000 // lockMs = 15 minuti
  );
  if (!rl.allowed) {
    const minuti = Math.ceil(rl.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Troppe creazioni utenti. Riprova tra ${minuti} minuti.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  const body = await req.json().catch(() => ({}));

  // Normalizza: campi stringa vuota -> undefined per i campi nullable
  const normalized = {
    ...body,
    provinciaId: body.provinciaId ? Number(body.provinciaId) : null,
    regioneId: body.regioneId ? Number(body.regioneId) : null,
    pec: body.pec || null,
    emailOrdinaria: body.emailOrdinaria || null,
    indirizzo: body.indirizzo || null,
    firma: body.firma || null,
    inizialiProtocollo: body.inizialiProtocollo || null,
  };

  const validation = validate(nuovoUtenteSchema, normalized);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;

  try {
    const exists = await db.user.findUnique({ where: { email: data.email } });
    if (exists) {
      return NextResponse.json({ error: "Email già in uso" }, { status: 400 });
    }

    const passwordHash = await hashPassword(data.password);
    const newUser = await db.user.create({
      data: {
        email: data.email,
        nomeCognome: data.nomeCognome,
        passwordHash,
        ruolo: data.ruolo,
        provinciaId: data.provinciaId ?? null,
        regioneId: data.regioneId ?? null,
        indirizzo: data.indirizzo ?? null,
        pec: data.pec ?? null,
        emailOrdinaria: data.emailOrdinaria ?? null,
        firma: data.firma ?? null,
        inizialiProtocollo: data.inizialiProtocollo?.toUpperCase() ?? null,
        attivo: data.attivo,
      },
      select: { id: true, email: true, nomeCognome: true, ruolo: true },
    });
    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (e) {
    // Gestisce race condition su email duplicata (P2002) e altri errori DB
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Email già in uso" }, { status: 400 });
    }
    logger.error({ err: e }, "Errore creazione utente");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
