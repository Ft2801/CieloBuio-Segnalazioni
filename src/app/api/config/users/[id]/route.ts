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
import {
  emailSchema,
  ruoloSchema,
  strongPasswordSchema,
  validate,
  vincoliRuoloTerritorioSchema,
  idDbSchema,
} from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { normalizzaStringaFacoltativa, leggiBodyOggetto, normalizzaIdNumerico } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

class UltimoAmministratoreAttivo extends Error {}

const patchUserSchema = z.object({
  email: emailSchema.optional(),
  nomeCognome: z
    .string()
    .min(1, "Nome e cognome obbligatori")
    .max(200)
    .regex(/^[^\r\n]*$/, "Il nome non può contenere a capo")
    .optional(),
  ruolo: ruoloSchema.optional(),
  provinciaId: idDbSchema.optional().nullable(),
  regioneId: idDbSchema.optional().nullable(),
  pec: z.email("PEC non valida").optional().nullable().or(z.literal("")),
  emailOrdinaria: z.email("Email ordinaria non valida").optional().nullable().or(z.literal("")),
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
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Rate limiting: 30 modifiche utenti per ora per admin. Difesa in
  // profondità contro script automatizzati in caso di compromissione
  // del token admin.
  const rl = checkRateLimit(`config-users-update:${user.id}`, 30, 60 * 60 * 1000, 60 * 60 * 1000, 15 * 60 * 1000);
  if (!rl.allowed) {
    const minuti = Math.ceil(rl.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Troppe modifiche utenti. Riprova tra ${minuti} minuti.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  const { id } = await params;
  const body = await leggiBodyOggetto(req);
  if (!body) {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }

  // Un campo assente resta undefined (nessuna modifica); una stringa vuota
  // diventa null (cancellazione esplicita del valore).
  const normalized = {
    ...body,
    provinciaId: normalizzaIdNumerico(body.provinciaId),
    regioneId: normalizzaIdNumerico(body.regioneId),
    pec: normalizzaStringaFacoltativa(body.pec),
    emailOrdinaria: normalizzaStringaFacoltativa(body.emailOrdinaria),
    indirizzo: normalizzaStringaFacoltativa(body.indirizzo),
    firma: normalizzaStringaFacoltativa(body.firma),
    inizialiProtocollo: normalizzaStringaFacoltativa(body.inizialiProtocollo),
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

    // Territorio e ruolo sullo stato EFFETTIVO dell'utente (dopo la modifica),
    // non sui soli campi inviati. Il territorio non indicato esplicitamente
    // viene azzerato quando il ruolo non lo prevede.
    const ruoloEffettivo = data.ruolo ?? existing.ruolo;
    let provinciaEffettiva = data.provinciaId !== undefined ? data.provinciaId : existing.provinciaId;
    let regioneEffettiva = data.regioneId !== undefined ? data.regioneId : existing.regioneId;
    if (ruoloEffettivo === "volontario" || ruoloEffettivo === "admin") {
      if (data.provinciaId === undefined) provinciaEffettiva = null;
      if (data.regioneId === undefined) regioneEffettiva = null;
    } else if (ruoloEffettivo === "referente_provinciale" && data.regioneId === undefined) {
      regioneEffettiva = null;
    } else if (ruoloEffettivo === "referente_regionale" && data.provinciaId === undefined) {
      provinciaEffettiva = null;
    }
    const vincoli = validate(vincoliRuoloTerritorioSchema, {
      ruolo: ruoloEffettivo,
      provinciaId: provinciaEffettiva,
      regioneId: regioneEffettiva,
    });
    if (!vincoli.success) {
      return NextResponse.json({ error: vincoli.error }, { status: 400 });
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
          { status: 400 },
        );
      }
      if (data.ruolo !== undefined && data.ruolo !== "admin") {
        return NextResponse.json(
          { error: "Non puoi rimuovere il tuo ruolo amministratore. Chiedi a un altro amministratore di farlo." },
          { status: 400 },
        );
      }
    }

    // La verifica sull'ultimo admin si esegue nella stessa transazione
    // serializzabile dell'aggiornamento per evitare due declassamenti
    // simultanei che lascerebbero il sistema senza amministratori.
    const declassaAdmin =
      existing.ruolo === "admin" && (data.attivo === false || (data.ruolo !== undefined && data.ruolo !== "admin"));

    // Costruisci l'oggetto data per l'update, includendo solo i campi forniti
    const updateData: Record<string, unknown> = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.nomeCognome !== undefined) updateData.nomeCognome = data.nomeCognome;
    if (data.ruolo !== undefined) updateData.ruolo = data.ruolo;
    if (data.ruolo !== undefined || data.provinciaId !== undefined || data.regioneId !== undefined) {
      updateData.provinciaId = provinciaEffettiva;
      updateData.regioneId = regioneEffettiva;
    }
    if (data.pec !== undefined) updateData.pec = data.pec;
    if (data.emailOrdinaria !== undefined) updateData.emailOrdinaria = data.emailOrdinaria;
    if (data.indirizzo !== undefined) updateData.indirizzo = data.indirizzo;
    if (data.firma !== undefined) updateData.firma = data.firma;
    if (data.inizialiProtocollo !== undefined)
      updateData.inizialiProtocollo = data.inizialiProtocollo?.toUpperCase() ?? null;
    if (data.attivo !== undefined) updateData.attivo = data.attivo;

    // Reset password se fornita
    if (data.newPassword) {
      updateData.passwordHash = await hashPassword(data.newPassword);
    }

    const invalidareSessioni =
      data.newPassword !== undefined ||
      data.ruolo !== undefined ||
      data.attivo !== undefined ||
      data.provinciaId !== undefined ||
      data.regioneId !== undefined;

    // Aggiornamento e invalidazione sono indivisibili. Se la cancellazione
    // delle sessioni fallisce, la password e i privilegi restano invariati;
    // non si dichiara riuscita un'operazione con sessioni ancora valide.
    const aggiornato = await db.$transaction(
      async (tx) => {
        if (declassaAdmin) {
          const altriAdmin = await tx.user.count({ where: { ruolo: "admin", attivo: true, NOT: { id } } });
          if (altriAdmin === 0) throw new UltimoAmministratoreAttivo();
        }
        const modificato = await tx.user.update({
          where: {
            id,
            ruolo: existing.ruolo,
            attivo: existing.attivo,
            provinciaId: existing.provinciaId,
            regioneId: existing.regioneId,
            updatedAt: existing.updatedAt,
          },
          data: updateData,
          select: {
            id: true,
            email: true,
            nomeCognome: true,
            ruolo: true,
            attivo: true,
            provinciaId: true,
            regioneId: true,
          },
        });
        if (invalidareSessioni) await tx.sessione.deleteMany({ where: { userId: id } });
        return modificato;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json({ user: aggiornato });
  } catch (e) {
    if (e instanceof UltimoAmministratoreAttivo) {
      return NextResponse.json(
        { error: "Impossibile: è l'ultimo amministratore attivo del sistema. Creare prima un secondo amministratore." },
        { status: 400 },
      );
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Email già in uso" }, { status: 400 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2034")) {
      return NextResponse.json(
        { error: "Utente modificato concorrentemente. Ricarica la pagina e riprova." },
        { status: 409 },
      );
    }
    logger.error({ err: e }, "Errore modifica utente");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  if (!canManageConfiguration(user)) {
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
      return NextResponse.json({ error: "Non puoi eliminare il tuo stesso account" }, { status: 400 });
    }

    if (existing._count.segnalazioni > 0 || existing._count.segnalazioniApprovate > 0) {
      return NextResponse.json(
        {
          error: `Impossibile eliminare: l'utente ha segnalazioni collegate. Disattivarlo invece (imposta attivo=false via PATCH).`,
        },
        { status: 400 },
      );
    }

    await db.$transaction(
      async (tx) => {
        const corrente = await tx.user.findUnique({ where: { id } });
        if (!corrente)
          throw new Prisma.PrismaClientKnownRequestError("Utente non trovato", {
            code: "P2025",
            clientVersion: Prisma.prismaVersion.client,
          });
        if (corrente.ruolo === "admin" && corrente.attivo) {
          const altriAdmin = await tx.user.count({ where: { ruolo: "admin", attivo: true, NOT: { id } } });
          if (altriAdmin === 0) throw new UltimoAmministratoreAttivo();
        }
        await tx.user.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        {
          error:
            "Impossibile eliminare: l'utente è collegato ad altri dati. Disattivarlo invece (imposta attivo=false via PATCH).",
        },
        { status: 409 },
      );
    }
    if (e instanceof UltimoAmministratoreAttivo) {
      return NextResponse.json({ error: "Impossibile eliminare l'ultimo amministratore attivo." }, { status: 400 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2025" || e.code === "P2034")) {
      return NextResponse.json(
        { error: "Utente modificato o eliminato concorrentemente. Ricarica la pagina." },
        { status: 409 },
      );
    }
    logger.error({ err: e }, "Errore eliminazione utente");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
