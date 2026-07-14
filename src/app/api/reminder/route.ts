/**
 * API: GET /api/reminder
 *      POST /api/reminder (con body { action: "auto-transition" | "cleanup" | "gdpr-anonymize" })
 *
 * GET: elenca le pratiche in stato "in_attesa" che superano la soglia
 * configurabile di giorni senza risposta (default 30). Solo lettura.
 *
 * POST: esegue azioni di maintenance (richiede ruolo admin):
 * - { action: "auto-transition" }: transizione automatica "inviata" ->
 *   "in_attesa" dopo TRANSIZIONE_INVIATA_GIORNI (default 7)
 * - { action: "cleanup" }: pulizia sessioni scadute
 * - { action: "gdpr-anonymize" }: anonimizza le segnalazioni più vecchie
 *   di RETENTION_SEGNALAZIONI_ANNI (default 10) come da PRIVACY.md.
 *   Rimuove i dati personali del volontario (indirizzo, GPS, descrizioni,
 *   allegati) mantenendo il record per audit/statistica.
 *
 * La logica delle azioni è centralizzata in `src/lib/cron-utils.ts` e
 * condivisa con `scripts/cron-jobs.ts` per evitare drift tra le due
 * implementazioni.
 *
 * La protezione CSRF su operazioni mutative è garantita dal cookie
 * SameSite=Strict + verifica Origin/Referer nel middleware globale, NON
 * dalla semplice separazione GET/POST.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni } from "@/lib/auth";
import {
  cleanupSessioniScadute,
  transizioneAutomaticaInviata,
  anonimizzaSegnalazioniGdpr,
  getReminderGiorni,
  getTransizioneGiorni,
} from "@/lib/cron-utils";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canReviewSegnalazioni(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // Validatori centralizzati in cron-utils: prevengono NaN su valori malformati
  // nel .env (es. REMINDER_GIORNI=abc), che produrrebbero Invalid Date e query
  // rotte. Stesso comportamento del cron automatico.
  const sogliaGiorni = getReminderGiorni();
  const transizioneGiorni = getTransizioneGiorni();

  // Lista pratiche in attesa oltre soglia (solo lettura)
  const sogliaDate = new Date();
  sogliaDate.setDate(sogliaDate.getDate() - sogliaGiorni);

  const where: Record<string, unknown> = {
    stato: "in_attesa",
    dataInvio: { lt: sogliaDate },
  };
  // Filtro territoriale fail-closed: un referente senza territorio assegnato
  // (provinciaId/regioneId null) non vede alcuna pratica, coerente con
  // getVisibilityFilter() usato nelle altre route di lista.
  if (user.ruolo === "referente_provinciale") {
    if (user.provinciaId === null) {
      return NextResponse.json({ sogliaGiorni, transizioneGiorni, count: 0, pratiche: [] });
    }
    where.provinciaId = user.provinciaId;
  } else if (user.ruolo === "referente_regionale") {
    if (user.regioneId === null) {
      return NextResponse.json({ sogliaGiorni, transizioneGiorni, count: 0, pratiche: [] });
    }
    where.regioneId = user.regioneId;
  }

  const pratiche = await db.segnalazione.findMany({
    where,
    orderBy: { dataInvio: "asc" },
    include: {
      comune: true,
      provincia: true,
      volontario: { select: { id: true, nomeCognome: true, email: true } },
    },
    take: 100,
  });

  return NextResponse.json(
    {
      sogliaGiorni,
      transizioneGiorni,
      count: pratiche.length,
      pratiche,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canReviewSegnalazioni(user)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  // Validazione di `action` PRIMA di eseguire qualunque side-effect.
  if (!action || !["cleanup", "auto-transition", "gdpr-anonymize"].includes(action)) {
    return NextResponse.json(
      { error: "Azione non valida. Valori ammessi: cleanup, auto-transition, gdpr-anonymize" },
      { status: 400 }
    );
  }

  // Le azioni `cleanup` (elimina tutte le sessioni scadute di tutti gli
  // utenti) e `auto-transition` (transita tutte le segnalazioni
  // "inviata"→"in_attesa" a livello nazionale) sono operazioni globali di
  // manutenzione che impattano l'intero database, non solo l'ambito
  // territoriale del referente. Devono essere riservate al solo admin.
  if (user.ruolo !== "admin") {
    return NextResponse.json(
      { error: "Solo l'amministratore può eseguire operazioni di manutenzione globali" },
      { status: 403 }
    );
  }

  let transizioniAutomatiche = 0;
  let sessioniPulite = 0;
  let segnalazioniAnonimizzate = 0;

  // Delega a funzioni centralizzate in src/lib/cron-utils.ts, condivise
  // con scripts/cron-jobs.ts per evitare drift tra le due implementazioni.
  if (action === "cleanup") {
    sessioniPulite = await cleanupSessioniScadute(db);
  } else if (action === "auto-transition") {
    transizioniAutomatiche = await transizioneAutomaticaInviata(db, user.id);
  } else if (action === "gdpr-anonymize") {
    segnalazioniAnonimizzate = await anonimizzaSegnalazioniGdpr(db, user.id);
  }

  return NextResponse.json({
    action,
    transizioniAutomatiche,
    sessioniPulite,
    segnalazioniAnonimizzate,
  });
}
