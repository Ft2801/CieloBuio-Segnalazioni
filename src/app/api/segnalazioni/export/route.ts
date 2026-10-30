/**
 * API: GET /api/segnalazioni/export
 *
 * Esporta le segnalazioni visibili all'utente in formato CSV, per la
 * portabilità dei dati delle segnalazioni. Le date sono espresse nel fuso
 * orario italiano (FUSO_ORARIO_UI).
 *
 * Parametri query:
 * - stato: filtra per stato (default: tutti)
 * - search: ricerca testuale
 *
 * Rate limiting: massimo 5 export per utente per ora. L'export contiene
 * PII (email volontario, nome, indirizzi, coordinate GPS), per cui è
 * soggetto a limiti di throughput e a una voce nel registro AuditLog
 * (registro trattamenti GDPR art. 30).
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getVisibilityFilter } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { labelStato } from "@/lib/types";
import { logger } from "@/lib/logger";
import { FUSO_ORARIO_UI } from "@/lib/format";

// Legge una riga in più per distinguere un export completo da uno troncato.
const MAX_RIGHE_EXPORT = 5000;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Numeri e booleani sono valori certi: nessun prefisso, così i negativi restano numeri.
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = String(value);
  // Sicurezza: CSV/Formula Injection. Se il testo inizia con uno spazio bianco
  // oppure con `=`, `+`, `-` o `@`, Excel e LibreOffice possono interpretarlo come
  // formula. Il prefisso apostrofo fa trattare il campo come testo.
  if (/^[\s=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  // Se contiene separatore, virgolette o a capo, racchiudi tra virgolette
  // raddoppiando le virgolette interne.
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Data nel formato italiano (gg/mm/aaaa) nel fuso di riferimento dell'app. */
function formataData(data: Date | string): string {
  return new Date(data).toLocaleDateString("it-IT", { timeZone: FUSO_ORARIO_UI });
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limiting: 5 export per utente per ora. L'export può essere oneroso
  // (fino a 5000 segnalazioni con join multipli) ed esporta PII, quindi
  // va protetto contro abusi e scarichi massivi non tracciati.
  const exportRl = checkRateLimit(
    `export:${user.id}`,
    5, // maxAttempts
    60 * 60 * 1000, // windowMs = 1 ora
    60 * 60 * 1000, // blockResetMs = 1 ora
    15 * 60 * 1000, // lockMs = 15 minuti (escalation)
  );
  if (!exportRl.allowed) {
    const minuti = Math.ceil(exportRl.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Troppi export richiesti (limite 5/ora). Riprova tra ${minuti} minuti.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(exportRl.retryAfterSeconds),
        },
      },
    );
  }

  const url = new URL(req.url);
  const stato = url.searchParams.get("stato");
  const search = url.searchParams.get("search");

  // Validazione del parametro stato contro whitelist (coerente con
  // /api/segnalazioni GET).
  const STATI_VALIDI = [
    "bozza",
    "in_revisione",
    "approvata",
    "inviata",
    "in_attesa",
    "chiusa_positiva",
    "chiusa_negativa",
  ];

  const where: Record<string, unknown> = { ...getVisibilityFilter(user) };
  if (stato && stato !== "all" && STATI_VALIDI.includes(stato)) where.stato = stato;
  if (search) {
    const q = search.slice(0, 200); // limita lunghezza per prevenire abusi
    where.OR = [
      { numeroProtocollo: { contains: q, mode: "insensitive" as const } },
      { indirizzoVia: { contains: q, mode: "insensitive" as const } },
      { nomeEsercizio: { contains: q, mode: "insensitive" as const } },
      { comune: { nome: { contains: q, mode: "insensitive" as const } } },
    ];
  }

  const segnalazioni = await db.segnalazione
    .findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        comune: true,
        provincia: true,
        regione: true,
        volontario: { select: { id: true, nomeCognome: true, email: true } },
        referenteApprovatore: { select: { id: true, nomeCognome: true } },
        allegati: { select: { id: true } },
      },
      take: MAX_RIGHE_EXPORT + 1,
    })
    .catch((err: unknown) => {
      logger.error({ err, userId: user.id }, "[export] lettura segnalazioni fallita");
      return null;
    });
  if (segnalazioni === null) {
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
  if (segnalazioni.length > MAX_RIGHE_EXPORT) {
    // Non presentare un CSV parziale come se fosse completo: chi lo usa per
    // portabilità o verifica perderebbe silenziosamente le righe successive.
    return NextResponse.json(
      { error: `L'esportazione supera ${MAX_RIGHE_EXPORT} segnalazioni. Restringi la ricerca o filtra per stato.` },
      { status: 422, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // Audit trail dell'export (GDPR art. 30): evento dedicato, non legato a una
  // singola segnalazione. Il fallimento non blocca il download, ma viene loggato.
  try {
    await db.auditLog.create({
      data: {
        userId: user.id,
        azione: "export_csv",
        dettagli: JSON.stringify({
          righe: segnalazioni.length,
          stato: stato ?? null,
          ricerca: Boolean(search),
        }),
      },
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "[export] registrazione audit dell'export fallita");
  }

  // Intestazioni CSV (UTF-8 con BOM e separatore ';' per Excel)
  const headers = [
    "Protocollo",
    "Data segnalazione",
    "Stato",
    "Volontario",
    "Email volontario",
    "Referente approvatore",
    "Indirizzo",
    "Comune",
    "CAP",
    "Provincia",
    "Regione",
    "Latitudine",
    "Longitudine",
    "Nome esercizio",
    "Vetro piano inclinato",
    "Vetro curvo",
    "Altro tipologia",
    "Nota altro tipologia",
    "Luce verso alto",
    "Abbagliamento",
    "Luce intrusiva",
    "Altro problema",
    "Nota altro problema",
    "Descrizione libera",
    "Destinatario",
    "Includi ARPA",
    "PEC CC aggiuntive",
    "Oggetto PEC",
    "Mittente visibile",
    "Data invio",
    "Livello recidiva",
    "Numero allegati",
    "Data creazione",
  ];

  const rows = segnalazioni.map((s) =>
    [
      s.numeroProtocollo,
      s.dataSegnalazione ? formataData(s.dataSegnalazione) : "",
      labelStato(s.stato),
      s.volontario?.nomeCognome ?? "",
      s.volontario?.email ?? "",
      s.referenteApprovatore?.nomeCognome ?? "",
      s.indirizzoVia,
      s.comune?.nome ?? "",
      s.cap,
      s.provincia?.sigla ?? "",
      s.regione?.regione ?? "",
      s.latitudine,
      s.longitudine,
      s.nomeEsercizio,
      s.chkVetroPianoInclinato ? "Sì" : "No",
      s.chkVetroCurvo ? "Sì" : "No",
      s.chkAltroTipologia ? "Sì" : "No",
      s.notaAltroTipologia,
      s.chkLuceVersoAlto ? "Sì" : "No",
      s.chkAbbagliamento ? "Sì" : "No",
      s.chkLuceIntrusiva ? "Sì" : "No",
      s.chkAltroProblema ? "Sì" : "No",
      s.notaAltroProblema,
      s.descrizioneLibera,
      s.destinatarioNome,
      s.includiArpa ? "Sì" : "No",
      s.pecCcAggiuntive,
      s.oggettoPec,
      s.mittenteVisibile ? "Volontario" : "Referente",
      s.dataInvio ? formataData(s.dataInvio) : "",
      s.livelloRecidiva,
      s.allegati?.length ?? 0,
      formataData(s.createdAt),
    ]
      .map(csvEscape)
      .join(";"),
  );

  // Separatore punto e virgola: è quello predefinito di Excel in configurazione italiana.
  const csv = "\uFEFF" + headers.map(csvEscape).join(";") + "\n" + rows.join("\n");

  const filename = `segnalazioni-${new Date().toLocaleDateString("sv-SE", { timeZone: FUSO_ORARIO_UI })}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
