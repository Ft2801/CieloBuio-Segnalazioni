/**
 * API: GET /api/segnalazioni/export
 *
 * Esporta le segnalazioni visibili all'utente in formato CSV, rispettando
 * il vincolo di portabilità dei dati (specifiche sezione 2, punto 4).
 *
 * Parametri query:
 * - stato: filtra per stato (default: tutti)
 * - search: ricerca testuale
 *
 * Rate limiting: massimo 5 export per utente per ora. L'export contiene
 * PII (email volontario, nome, indirizzi, coordinate GPS), per cui è
 * soggetto a limiti di throughput e a una entry di audit nello storico
 * delle segnalazioni (registro trattamenti GDPR art. 30).
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getVisibilityFilter } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { labelStato } from "@/lib/types";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Sicurezza: CSV/Formula Injection. Se un campo inizia con `=`, `+`,
  // `-`, `@`, `\t`, `\r`, Excel/LibreOffice lo interpreta come formula.
  // Un volontario malevolo potrebbe inserire `=HYPERLINK(...)` o `=cmd|...`
  // in un campo libero (nomeEsercizio, descrizioneLibera,
  // notaAltroTipologia, notaAltroProblema, destinatarioNome) e colpire chi
  // apre il CSV esportato. Prefissiamo con un apostrofo neutro: Excel lo
  // mostra come testo letterale (l'apostrofo iniziale viene nascosto come
  // convention di "force text").
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  // Se contiene virgola, virgolette, o a capo, racchiudi tra virgolette
  // raddoppiando le virgolette interne.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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
    15 * 60 * 1000 // lockMs = 15 minuti (escalation)
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
      }
    );
  }

  const url = new URL(req.url);
  const stato = url.searchParams.get("stato");
  const search = url.searchParams.get("search");

  // Validazione del parametro stato contro whitelist (coerente con
  // /api/segnalazioni GET).
  const STATI_VALIDI = [
    "bozza", "in_revisione", "approvata", "inviata",
    "in_attesa", "chiusa_positiva", "chiusa_negativa",
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

  const segnalazioni = await db.segnalazione.findMany({
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
    take: 5000,
  });

  // Audit trail: registra l'export nello storico di una segnalazione
  // rappresentativa (la prima del result set, se presente) come voce
  // di audit. Questo tracciamento risponde al requisito GDPR art. 30
  // (registro delle attività di trattamento) per i download massivi.
  if (segnalazioni.length > 0) {
    try {
      await db.storicoStato.create({
        data: {
          segnalazioneId: segnalazioni[0].id,
          userId: user.id,
          statoPrecedente: segnalazioni[0].stato,
          statoNuovo: segnalazioni[0].stato,
          nota: `Export CSV: ${segnalazioni.length} segnalazioni (filtri: stato=${stato ?? "tutti"}, search=${search ? "sì" : "no"})`,
        },
      });
    } catch {
      // L'audit trail è best-effort: non bloccare l'export se fallisce.
    }
  }

  // Intestazioni CSV (UTF-8 con BOM per Excel)
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
      s.dataSegnalazione ? new Date(s.dataSegnalazione).toLocaleDateString("it-IT") : "",
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
      s.dataInvio ? new Date(s.dataInvio).toLocaleDateString("it-IT") : "",
      s.livelloRecidiva,
      s.allegati?.length ?? 0,
      new Date(s.createdAt).toLocaleDateString("it-IT"),
    ]
      .map(csvEscape)
      .join(",")
  );

  const csv = "\uFEFF" + headers.map(csvEscape).join(",") + "\n" + rows.join("\n");

  const filename = `segnalazioni-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
