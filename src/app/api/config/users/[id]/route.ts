/**
 * API: PATCH  /api/config/users/[id]
 *      DELETE /api/config/users/[id]
 *
 * PATCH: modifica utente esistente (cambio ruolo, attivazione/disattivazione,
 *        cambio provincia/regione, reset password, aggiornamento dati).
 * DELETE: eliminazione utente (bloccata se ha segnalazioni collegate).
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canManageConfiguration, hashPassword } from "@/lib/auth";
import { emailSchema, ruoloSchema, strongPasswordSchema, validate } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

const patchUserSchema = z
  .object({
    email: emailSchema.optional(),
    nomeCognome: z.string().min(1, "Nome e cognome obbligatori").max(200).regex(/^[^\r\n]*$/, "Il nome non può contenere a capo").optional(),
    ruolo: ruoloSchema.optional(),
    provinciaId: z.number().int().positive().optional().nullable(),
    regioneId: z.number().int().positive().optional().nullable(),
    pec: z.string().email("PEC non valida").optional().nullable().or(z.literal("")),
    emailOrdinaria: z.string().email("Email ordinaria non valida").optional().nullable().or(z.literal("")),
    indirizzo: z.string().max(500).optional().nullable(),
    firma: z.string().max(2000).optional().nullable(),
    inizialiProtocollo: z
      .string()
      .min(2, "Iniziali protocollo devono avere 2 caratteri")
      .max(2, "Iniziali protocollo devono avere 2 caratteri")
      .regex(/^[A-Za-z]+$/, "Solo lettere ammesse")
      .optional()
      .nullable(),
    attivo: z.boolean().optional(),
    newPassword: strongPasswordSchema.optional(),
  })
  // Validazione incrociata ruolo/territorio, allineata a quella di
  // nuovoUtenteSchema in validation.ts. Senza questo check, l'admin
  // potrebbe assegnare provinciaId/regioneId a un volontario o admin,
  // o lasciare un referente senza territorio: configurazioni incoerenti
  // che produrrebbero comportamenti fuorvianti nelle query di visibilità.
  .superRefine((data, ctx) => {
    if (data.ruolo !== undefined) {
      if (data.ruolo === "referente_provinciale" && data.provinciaId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Il ruolo referente_provinciale richiede provinciaId assegnato",
          path: ["provinciaId"],
        });
      }
      if (data.ruolo === "referente_regionale" && data.regioneId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Il ruolo referente_regionale richiede regioneId assegnato",
          path: ["regioneId"],
        });
      }
      if (
        (data.ruolo === "volontario" || data.ruolo === "admin") &&
        (data.provinciaId != null || data.regioneId != null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "I ruoli volontario e admin non devono avere territorio assegnato",
          path: ["ruolo"],
        });
      }
    }
  });

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Rate limiting: 30 modifiche utenti per ora per admin. Difesa in
  // profondità contro script automatizzati in caso di compromissione
  // del token admin.
  const rl = checkRateLimit(
    `config-users-update:${user.id}`,
    30,
    60 * 60 * 1000,
    60 * 60 * 1000,
    15 * 60 * 1000
  );
  if (!rl.allowed) {
    const minuti = Math.ceil(rl.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Troppe modifiche utenti. Riprova tra ${minuti} minuti.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      }
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const normalized = {
    ...body,
    provinciaId: body.provinciaId ? Number(body.provinciaId) : body.provinciaId === null ? null : undefined,
    regioneId: body.regioneId ? Number(body.regioneId) : body.regioneId === null ? null : undefined,
    pec: body.pec || null,
    emailOrdinaria: body.emailOrdinaria || null,
    indirizzo: body.indirizzo || null,
    firma: body.firma || null,
    inizialiProtocollo: body.inizialiProtocollo || null,
  };

  const validation = validate(patchUserSchema, normalized);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;

  try {
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }

    // Verifica email duplicata se sta cambiando
    if (data.email && data.email !== existing.email) {
      const emailExists = await db.user.findUnique({ where: { email: data.email } });
      if (emailExists) {
        return NextResponse.json({ error: "Email già in uso" }, { status: 400 });
      }
    }

    // Protezione auto-blocco: un admin non può disattivare sé stesso né
    // rimuovere il proprio ruolo admin, altrimenti rischia di restare
    // escluso dal pannello di gestione senza modo di rientrare.
    if (id === user.id) {
      if (data.attivo === false) {
        return NextResponse.json(
          { error: "Non puoi disattivare il tuo stesso account. Chiedi a un altro amministratore di farlo." },
          { status: 400 }
        );
      }
      if (data.ruolo !== undefined && data.ruolo !== "admin") {
        return NextResponse.json(
          { error: "Non puoi rimuovere il tuo ruolo amministratore. Chiedi a un altro amministratore di farlo." },
          { status: 400 }
        );
      }
    }

    // Se si sta disattivando o declassando un admin, verifica che rimanga
    // almeno un altro admin attivo nel sistema.
    if (
      existing.ruolo === "admin" &&
      ((data.attivo === false) || (data.ruolo !== undefined && data.ruolo !== "admin"))
    ) {
      const adminCount = await db.user.count({
        where: { ruolo: "admin", attivo: true, NOT: { id } },
      });
      if (adminCount === 0) {
        return NextResponse.json(
          { error: "Impossibile: è l'ultimo amministratore attivo del sistema. Creare prima un secondo amministratore." },
          { status: 400 }
        );
      }
    }

    // Costruisci l'oggetto data per l'update, includendo solo i campi forniti
    const updateData: Record<string, unknown> = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.nomeCognome !== undefined) updateData.nomeCognome = data.nomeCognome;
    if (data.ruolo !== undefined) updateData.ruolo = data.ruolo;
    if (data.provinciaId !== undefined) updateData.provinciaId = data.provinciaId;
    if (data.regioneId !== undefined) updateData.regioneId = data.regioneId;
    if (data.pec !== undefined) updateData.pec = data.pec;
    if (data.emailOrdinaria !== undefined) updateData.emailOrdinaria = data.emailOrdinaria;
    if (data.indirizzo !== undefined) updateData.indirizzo = data.indirizzo;
    if (data.firma !== undefined) updateData.firma = data.firma;
    if (data.inizialiProtocollo !== undefined) updateData.inizialiProtocollo = data.inizialiProtocollo?.toUpperCase() ?? null;
    if (data.attivo !== undefined) updateData.attivo = data.attivo;

    // Reset password se fornita
    if (data.newPassword) {
      updateData.passwordHash = await hashPassword(data.newPassword);
    }

    const aggiornato = await db.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, nomeCognome: true, ruolo: true, attivo: true, provinciaId: true, regioneId: true },
    });

    // Invalidazione sessioni attive: se l'admin ha cambiato la password,
    // il ruolo, lo stato attivo o il territorio dell'utente, tutte le
    // sessioni già emesse per quell'utente vengono distrutte. Questo
    // previene che un utente compromesso mantenga accesso dopo un reset
    // password, o che un utente declassato continui ad operare con i
    // privilegi precedenti fino alla scadenza naturale della sessione
    // (8 ore). La disattivazione è già gestita da getSessionUser()
    // (check attivo), ma gli altri cambiamenti richiedono questa
    // invalidazione esplicita. È la stessa policy di session-rotation
    // applicata al login.
    const sessionInvalidationTriggers =
      data.newPassword !== undefined ||
      data.ruolo !== undefined ||
      data.attivo !== undefined ||
      data.provinciaId !== undefined ||
      data.regioneId !== undefined;
    if (sessionInvalidationTriggers) {
      await db.sessione.deleteMany({ where: { userId: id } }).catch((e: unknown) => {
        // Best-effort: non bloccare la PATCH se la invalidazione fallisce,
        // ma logga per dare visibilità al problema (l'utente modificato
        // potrebbe mantenere accesso con i vecchi privilegi fino alla
        // scadenza naturale della sessione).
        logger.warn(
          { err: e, userId: id },
          "Errore non bloccante durante invalidazione sessioni utente dopo modifica"
        );
      });
    }

    return NextResponse.json({ user: aggiornato });
  } catch (e) {
    logger.error({ err: e }, "Errore modifica utente");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user || !canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await db.user.findUnique({
      where: { id },
      include: { _count: { select: { segnalazioni: true, segnalazioniApprovate: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }

    // Non permettere l'eliminazione di se stessi
    if (id === user.id) {
      return NextResponse.json(
        { error: "Non puoi eliminare il tuo stesso account" },
        { status: 400 }
      );
    }

    if (existing._count.segnalazioni > 0 || existing._count.segnalazioniApprovate > 0) {
      return NextResponse.json(
        { error: `Impossibile eliminare: l'utente ha segnalazioni collegate. Disattivarlo invece (imposta attivo=false via PATCH).` },
        { status: 400 }
      );
    }

    await db.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "Errore eliminazione utente");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
