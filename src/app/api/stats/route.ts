/**
 * API: GET /api/stats
 * Statistiche riepilogative per la dashboard.
 * Autore: Fabio Tempera (2026)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getVisibilityFilter } from "@/lib/auth";
import { getReminderGiorni } from "@/lib/cron-utils";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const visFilter = getVisibilityFilter(user);

  // Pratiche in attesa oltre la soglia dei reminder (REMINDER_GIORNI, default 30):
  // stessa soglia usata da GET /api/reminder, così i due conteggi coincidono.
  const sogliaGiorni = getReminderGiorni();
  const sogliaReminder = new Date();
  sogliaReminder.setDate(sogliaReminder.getDate() - sogliaGiorni);

  // Esegue tutti i count in parallelo per ridurre la latenza (10 query
  // sequenziali su PostgreSQL richiederebbero 10 round-trip; in parallelo
  // vengono eseguite in un unico ciclo di event loop).
  const [
    totali,
    bozze,
    inRevisione,
    approvate,
    inviate,
    inAttesa,
    chiusePositive,
    chiuseNegative,
    recidive,
    inAttesaOverdue,
  ] = await Promise.all([
    db.segnalazione.count({ where: visFilter }),
    db.segnalazione.count({ where: { ...visFilter, stato: "bozza" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "in_revisione" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "approvata" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "inviata" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "in_attesa" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "chiusa_positiva" } }),
    db.segnalazione.count({ where: { ...visFilter, stato: "chiusa_negativa" } }),
    db.segnalazione.count({ where: { ...visFilter, livelloRecidiva: { gte: 2 } } }),
    db.segnalazione.count({
      where: {
        ...visFilter,
        stato: "in_attesa",
        dataInvio: { lt: sogliaReminder },
      },
    }),
  ]);

  return NextResponse.json({
    sogliaGiorni,
    totali,
    bozze,
    inRevisione,
    approvate,
    inviate,
    inAttesa,
    chiusePositive,
    chiuseNegative,
    recidive,
    inAttesaOverdue,
  });
}
