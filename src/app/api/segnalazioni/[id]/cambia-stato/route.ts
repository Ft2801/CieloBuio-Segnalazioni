/**
 * API: POST /api/segnalazioni/[id]/cambia-stato
 * Cambio di stato generico (utile per chiudere una pratica, riaprire, ecc.)
 *
 * Stati ammessi: bozza, in_revisione, approvata, inviata, in_attesa,
 *                chiusa_positiva, chiusa_negativa
 *
 * Matrice delle transizioni lecite (definite dalla logica di business
 * delle specifiche, sezione 7). L'admin può forzare qualsiasi transizione
 * con ?force=1, ma viene registrata nello storico.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { notificaReferenteNuovaRevisione } from "@/lib/notifiche";
import { TRANSIZIONI_LECITE } from "@/lib/types";
import { logger } from "@/lib/logger";

type Params = { params: Promise<{ id: string }> };

const STATI_VALIDI = [
  "bozza",
  "in_revisione",
  "approvata",
  "inviata",
  "in_attesa",
  "chiusa_positiva",
  "chiusa_negativa",
];

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const segnalazione = await db.segnalazione.findUnique({ where: { id } });
  if (!segnalazione) {
    return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const nuovoStato = typeof body.stato === "string" ? body.stato : "";
  const nota = (body.nota ?? "").toString().trim() || null;
  // Validazione lunghezza: previene abusi (stringhe enormi nello storico)
  if (nota && nota.length > 2000) {
    return NextResponse.json(
      { error: "La nota è troppo lunga (massimo 2000 caratteri)" },
      { status: 400 }
    );
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1" && user.ruolo === "admin";

  if (!STATI_VALIDI.includes(nuovoStato)) {
    return NextResponse.json({ error: "Stato non valido" }, { status: 400 });
  }

  // Lo stato "inviata" non è MAI raggiungibile via cambia-stato, nemmeno
  // con ?force=1: per passare ad "inviata" si DEVE usare /invia-pec che
  // genera il numero di protocollo, imposta dataInvio e crea il log PEC.
  // Consentire il force qui bypasserebbe il flusso PEC lasciando una
  // segnalazione in stato "inviata" senza protocollo, senza dataInvio
  // e senza log PEC (stato incoerente nei dashboard e nei report).
  if (nuovoStato === "inviata") {
    return NextResponse.json(
      { error: "Lo stato 'inviata' è raggiungibile solo tramite l'endpoint /invia-pec, che genera il numero di protocollo e il log PEC." },
      { status: 400 }
    );
  }

  // Verifica che la transizione sia lecita (matrice)
  const transizioniAmmesse = TRANSIZIONI_LECITE[segnalazione.stato as keyof typeof TRANSIZIONI_LECITE] ?? [];
  if (!transizioniAmmesse.includes(nuovoStato as never) && !force) {
    return NextResponse.json(
      {
        error: `Transizione non ammessa da "${segnalazione.stato}" a "${nuovoStato}". L'amministratore può forzarla con ?force=1.`,
      },
      { status: 400 }
    );
  }

  // Permessi:
  // - volontario: può inviare in revisione (bozza -> in_revisione) solo sulle proprie
  // - referente/admin: può cambiare stato su tutto il proprio ambito
  const isOwner = segnalazione.volontarioId === user.id;
  const isReviewer = canReviewSegnalazioni(user);

  // Transizione bozza -> in_revisione: solo il volontario proprietario
  if (nuovoStato === "in_revisione" && segnalazione.stato === "bozza") {
    if (!isOwner) {
      return NextResponse.json(
        { error: "Solo il volontario può inviare in revisione" },
        { status: 403 }
      );
    }
  } else {
    // Tutti gli altri cambi di stato richiedono ruolo referente/admin
    if (!isReviewer) {
      return NextResponse.json(
        { error: "Non autorizzato al cambio stato" },
        { status: 403 }
      );
    }
    // H2-style: verifica competenza territoriale per referenti (usa helper centralizzato)
    if (!hasTerritorialCompetence(user, segnalazione)) {
      return NextResponse.json(
        { error: "Non autorizzato per questa segnalazione" },
        { status: 403 }
      );
    }
  }

  // I5: pulizia notaRifiuto al passaggio bozza -> in_revisione
  const datiUpdate: Record<string, unknown> = { stato: nuovoStato };
  if (segnalazione.stato === "bozza" && nuovoStato === "in_revisione") {
    datiUpdate.notaRifiuto = null;
  }

  // GDPR: registra la data di chiusura quando lo stato transita a
  // chiusa_positiva o chiusa_negativa. Il job di anonimizzazione usa
  // questo campo (NON updatedAt, che si aggiorna ad ogni modifica) per
  // calcolare la retention reale di 10 anni dalla chiusura, coerente
  // con quanto dichiarato in PRIVACY.md. Se la pratica viene riaperta
  // (es. chiusa_negativa -> in_attesa), il campo viene azzerato.
  if (nuovoStato === "chiusa_positiva" || nuovoStato === "chiusa_negativa") {
    datiUpdate.dataChiusura = new Date();
  } else if (
    (segnalazione.stato === "chiusa_positiva" || segnalazione.stato === "chiusa_negativa") &&
    (nuovoStato === "in_attesa" || nuovoStato === "in_revisione" || nuovoStato === "approvata")
  ) {
    // Riapertura di una pratica chiusa: azzera dataChiusura per
    // ripristinare la finestra di retention corretta quando verrà
    // richiusa in futuro.
    datiUpdate.dataChiusura = null;
  }

  const vecchioStato = segnalazione.stato;
  // Transazione interattiva: updateMany + storicoStato.create nello stesso
  // blocco atomico. Se la create di storicoStato fallisce, anche l'updateMany
  // viene rollbackato, preservando l'invariante "ogni transizione di stato
  // ha il suo audit record".
  // L'admin con force=1 bypassa la matrice delle transizioni lecite ma
  // resta soggetto al check di atomicità (se lo stato cambia concorrentemente,
  // anche la transizione forzata fallisce con 409).
  let aggiornata;
  try {
    aggiornata = await db.$transaction(async (tx) => {
      const result = await tx.segnalazione.updateMany({
        where: { id, stato: vecchioStato },
        data: datiUpdate,
      });
      if (result.count === 0) {
        return null;
      }
      const seg = await tx.segnalazione.findUnique({ where: { id } });
      await tx.storicoStato.create({
        data: {
          segnalazioneId: id,
          statoPrecedente: vecchioStato,
          statoNuovo: nuovoStato,
          userId: user.id,
          nota: force && !transizioniAmmesse.includes(nuovoStato)
            ? `Transizione forzata dall'admin${nota ? `: ${nota}` : ""}`
            : nota,
        },
      });
      return seg;
    });
  } catch (e) {
    logger.error({ err: e }, "Errore cambia-stato");
    return NextResponse.json(
      { error: "Errore interno del server durante la transazione di stato" },
      { status: 500 }
    );
  }
  if (aggiornata === null) {
    return NextResponse.json(
      { error: "La segnalazione è stata modificata concorrentemente. Ricarica la pagina e riprova." },
      { status: 409 }
    );
  }

  // Notifiche email (async, non bloccanti)
  if (vecchioStato === "bozza" && nuovoStato === "in_revisione") {
    void notificaReferenteNuovaRevisione(id);
  }

  return NextResponse.json(
    { segnalazione: aggiornata },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
