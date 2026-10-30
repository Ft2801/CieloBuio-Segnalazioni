/**
 * API: POST /api/segnalazioni/[id]/cambia-stato
 * Cambio di stato generico (utile per chiudere una pratica, riaprire, ecc.)
 *
 * Stati ammessi: bozza, in_revisione, approvata, inviata, in_attesa,
 *                chiusa_positiva, chiusa_negativa
 *
 * Matrice delle transizioni lecite (TRANSIZIONI_LECITE in lib/types.ts).
 * L'admin può forzare una transizione con ?force=1; la forzatura viene
 * registrata nello storico. Sono esclusi l'ingresso in "inviata"
 * (solo via /invia-pec) e le decisioni dalla revisione (solo /rifiuta e
 * /approva). La transizione bozza -> in_revisione è riservata al
 * volontario proprietario.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, canReviewSegnalazioni, hasTerritorialCompetence } from "@/lib/auth";
import { notificaReferenteNuovaRevisione } from "@/lib/notifiche";
import { TRANSIZIONI_LECITE } from "@/lib/types";
import { logger } from "@/lib/logger";

import { versioneCorrisponde } from "@/lib/versione";

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

  if (!versioneCorrisponde(req.headers.get("if-match"), segnalazione.updatedAt)) {
    return NextResponse.json(
      { error: "La segnalazione è cambiata. Ricarica e verifica i dati prima di procedere." },
      { status: 409 },
    );
  }

  const body: Record<string, unknown> | null = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Corpo della richiesta non valido" }, { status: 400 });
  }
  const nuovoStato = typeof body.stato === "string" ? body.stato : "";
  const nota = typeof body.nota === "string" ? body.nota.trim() || null : null;
  // Validazione lunghezza: previene abusi (stringhe enormi nello storico)
  if (nota && nota.length > 2000) {
    return NextResponse.json({ error: "La nota è troppo lunga (massimo 2000 caratteri)" }, { status: 400 });
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
      {
        error:
          "Lo stato 'inviata' è raggiungibile solo tramite l'endpoint /invia-pec, che genera il numero di protocollo e il log PEC.",
      },
      { status: 400 },
    );
  }

  // Dalla revisione il rifiuto richiede obbligatoriamente una nota e la
  // notifica al volontario; l'approvazione richiede l'attribuzione del
  // referente. Le route dedicate realizzano questi effetti, mentre un
  // cambio generico permetterebbe di bypassarli anche senza forzatura.
  if (segnalazione.stato === "in_revisione" && (nuovoStato === "bozza" || nuovoStato === "approvata")) {
    const azione = nuovoStato === "bozza" ? "rifiuta" : "approva";
    return NextResponse.json(
      { error: `Per questa transizione usare l'endpoint /${azione}, che registra tutti gli effetti della decisione.` },
      { status: 400 },
    );
  }

  // Verifica che la transizione sia lecita (matrice)
  const transizioniAmmesse = TRANSIZIONI_LECITE[segnalazione.stato as keyof typeof TRANSIZIONI_LECITE] ?? [];
  const transizioneAmmessa = transizioniAmmesse.some((s) => s === nuovoStato);
  if (!transizioneAmmessa && !force) {
    return NextResponse.json(
      {
        error: `Transizione non ammessa da "${segnalazione.stato}" a "${nuovoStato}". L'amministratore può forzarla con ?force=1.`,
      },
      { status: 400 },
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
      return NextResponse.json({ error: "Solo il volontario può inviare in revisione" }, { status: 403 });
    }
  } else {
    // Tutti gli altri cambi di stato richiedono ruolo referente/admin
    if (!isReviewer) {
      return NextResponse.json({ error: "Non autorizzato al cambio stato" }, { status: 403 });
    }
    // Competenza territoriale del referente (helper centralizzato, fail-closed).
    if (!hasTerritorialCompetence(user, segnalazione)) {
      return NextResponse.json({ error: "Non autorizzato per questa segnalazione" }, { status: 403 });
    }
  }

  if (segnalazione.volontarioId === null) {
    return NextResponse.json({ error: "Una segnalazione anonimizzata non può cambiare stato." }, { status: 400 });
  }

  // Al nuovo invio in revisione la nota del precedente rifiuto viene azzerata.
  const datiUpdate: Record<string, unknown> = { stato: nuovoStato };
  // Il referente approvatore descrive l'approvazione corrente. Un ritorno
  // a bozza o in revisione la revoca; l'autore delle decisioni precedenti
  // resta comunque tracciato in storicoStato.
  if (nuovoStato === "bozza" || nuovoStato === "in_revisione") {
    datiUpdate.referenteApprovatoreId = null;
  }
  if (nuovoStato === "bozza" || nuovoStato === "approvata") {
    // In bozza forzata non c'è stato un rifiuto; nell'approvazione forzata
    // l'eventuale nota di un rifiuto passato non deve riapparire.
    datiUpdate.notaRifiuto = null;
  }
  if (nuovoStato === "approvata") {
    // Anche la forzatura amministrativa attribuisce l'approvazione corrente
    // a chi l'ha effettuata, come la route dedicata /approva.
    datiUpdate.referenteApprovatoreId = user.id;
  }
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
  } else if (segnalazione.stato === "chiusa_positiva" || segnalazione.stato === "chiusa_negativa") {
    // Qualsiasi riapertura, compresa la forzatura verso bozza, azzera la
    // vecchia data di chiusura. La retention riparte dalla nuova chiusura.
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
        // Durante un invio PEC nessuna transizione, neppure forzata,
        // può invalidare lo stato controllato prima della consegna SMTP.
        where: {
          id,
          stato: vecchioStato,
          updatedAt: segnalazione.updatedAt,
          volontarioId: segnalazione.volontarioId,
          provinciaId: segnalazione.provinciaId,
          regioneId: segnalazione.regioneId,
          invioPecLockToken: null,
        },
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
          nota: force && !transizioneAmmessa ? `Transizione forzata dall'admin${nota ? `: ${nota}` : ""}` : nota,
        },
      });
      return seg;
    });
  } catch (e) {
    logger.error({ err: e }, "Errore cambia-stato");
    return NextResponse.json({ error: "Errore interno del server durante la transazione di stato" }, { status: 500 });
  }
  if (aggiornata === null) {
    return NextResponse.json(
      { error: "La segnalazione è stata modificata concorrentemente. Ricarica la pagina e riprova." },
      { status: 409 },
    );
  }

  // Notifica email al referente: non bloccante, gli errori sono loggati.
  if (vecchioStato === "bozza" && nuovoStato === "in_revisione") {
    notificaReferenteNuovaRevisione(id).catch((e: unknown) => {
      logger.error({ err: e, segnalazioneId: id }, "Notifica nuova revisione al referente fallita");
    });
  }

  return NextResponse.json({ segnalazione: aggiornata }, { headers: { "Cache-Control": "private, no-store" } });
}
