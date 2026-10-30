"use client";

/**
 * Pagina iniziale: saluto, attività da svolgere per il ruolo dell'utente,
 * indicatori riepilogativi cliccabili che aprono la lista filtrata.
 * Autore: Fabio Tempera (2026)
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Send, FileEdit, Inbox, AlertTriangle, FileText, RotateCcw, ChevronRight } from "lucide-react";
import type { Segnalazione, SessionUser, StatoSegnalazione } from "@/lib/types";
import { labelRuolo, labelStato } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_SEGNALAZIONI, DEMO_STATS } from "@/lib/demo-data";
import { plurale } from "@/lib/format";
import type { Vista } from "@/lib/rotta";
import { LinkVista } from "./link-vista";

type Stats = {
  sogliaGiorni: number;
  totali: number;
  bozze: number;
  inRevisione: number;
  approvate: number;
  inviate: number;
  inAttesa: number;
  chiusePositive: number;
  chiuseNegative: number;
  recidive: number;
  inAttesaOverdue: number;
};

type Indicatore = {
  label: string;
  valore: keyof Stats;
  icon: React.ComponentType<{ className?: string }>;
  /** Tonalità scura per avere contrasto >= 3:1 su bianco (e chiara in tema scuro). */
  colore: string;
  stato: StatoSegnalazione;
};

const INDICATORI: Indicatore[] = [
  { label: "Bozze", valore: "bozze", icon: FileEdit, colore: "text-slate-600 dark:text-slate-300", stato: "bozza" },
  {
    label: "In revisione",
    valore: "inRevisione",
    icon: Inbox,
    colore: "text-amber-700 dark:text-amber-300",
    stato: "in_revisione",
  },
  {
    label: "Inviate",
    valore: "inviate",
    icon: Send,
    colore: "text-emerald-700 dark:text-emerald-300",
    stato: "inviata",
  },
  {
    label: "In attesa",
    valore: "inAttesa",
    icon: Clock,
    colore: "text-cyan-700 dark:text-cyan-300",
    stato: "in_attesa",
  },
];

/** Stati che richiedono un'azione dell'utente, per ruolo. */
function statiDaFare(ruolo: string): StatoSegnalazione[] {
  return ruolo === "volontario" ? ["bozza"] : ["in_revisione", "approvata"];
}

const AZIONE_DA_FARE: Partial<Record<StatoSegnalazione, string>> = {
  bozza: "Completa e invia al referente",
  in_revisione: "Da approvare o respingere",
  approvata: "Da inviare via PEC",
};

const LIMITE_DA_FARE = 5;

export function Dashboard({ user, onNavigate }: { user: SessionUser; onNavigate: (vista: Vista) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [daFare, setDaFare] = useState<Segnalazione[] | null>(null);
  const [daFareError, setDaFareError] = useState(false);

  const carica = useCallback(async () => {
    setStatsError(false);
    setDaFareError(false);
    if (isDemoSession(user)) {
      // Dati statici incorporati nel bundle: nessuna richiesta di rete.
      setStats(DEMO_STATS);
      setDaFare(DEMO_SEGNALAZIONI.filter((s) => statiDaFare(user.ruolo).includes(s.stato)).slice(0, LIMITE_DA_FARE));
      return;
    }
    try {
      const r = await fetch("/api/stats");
      // Verifica r.ok prima di usare i dati: una risposta di errore con body
      // JSON non deve essere mostrata come statistiche (zeri ovunque).
      const data = r.ok ? await r.json().catch(() => null) : null;
      if (data && typeof data === "object" && !("error" in data)) {
        setStats(data as Stats);
      } else {
        setStats(null);
        setStatsError(true);
      }
    } catch {
      setStats(null);
      setStatsError(true);
    }

    try {
      const risposte = await Promise.all(
        statiDaFare(user.ruolo).map((stato) =>
          fetch(`/api/segnalazioni?${new URLSearchParams({ stato, limit: String(LIMITE_DA_FARE), offset: "0" })}`),
        ),
      );
      const elenchi: Segnalazione[] = [];
      for (const r of risposte) {
        if (!r.ok) throw new Error("risposta non valida");
        const data = await r.json();
        elenchi.push(...((data.segnalazioni ?? []) as Segnalazione[]));
      }
      setDaFare(elenchi.slice(0, LIMITE_DA_FARE));
    } catch {
      setDaFare(null);
      setDaFareError(true);
    }
  }, [user]);

  useEffect(() => {
    carica();
  }, [carica]);

  // Finché le statistiche non sono disponibili si mostra un trattino, mai uno zero:
  // uno zero sarebbe un dato falso durante il caricamento o in caso di errore.
  const valore = (chiave: keyof Stats) => (stats ? String(stats[chiave]) : "n/d");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Benvenuto, {user.nomeCognome}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {labelRuolo(user.ruolo)}, {user.email}
          </p>
        </div>
        <LinkVista
          vista={{ name: "nuova-segnalazione" }}
          onNavigate={onNavigate}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring self-start sm:self-auto"
        >
          <FileText className="w-4 h-4" aria-hidden="true" /> Nuova segnalazione
        </LinkVista>
      </div>

      {stats?.inAttesaOverdue ? (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/50">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle
              className="w-5 h-5 text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-100">
                {plurale(stats.inAttesaOverdue, "pratica in attesa", "pratiche in attesa")} da oltre{" "}
                {plurale(stats.sogliaGiorni, "giorno", "giorni")}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Valuta l&apos;invio di un promemoria o la generazione di una nuova segnalazione collegata per recidiva.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => onNavigate({ name: "reminder" })}>
                Vai ai promemoria
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {statsError && (
        <Card className="border-rose-500/50 bg-rose-50 dark:bg-rose-950/50">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle
              className="w-5 h-5 text-rose-700 dark:text-rose-300 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1">
              <p className="font-medium text-rose-900 dark:text-rose-100">Impossibile caricare le statistiche</p>
              <p className="text-sm text-muted-foreground mt-1">Verifica la connessione e riprova.</p>
              <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={carica}>
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Riprova
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="titolo-da-fare" className="space-y-3">
        <h2 id="titolo-da-fare" className="text-lg font-semibold">
          Da fare
        </h2>
        {daFare === null ? (
          daFareError ? (
            <p className="text-sm text-rose-800 dark:text-rose-200">
              Non è stato possibile caricare le attività. Ricarica la pagina per riprovare.
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Caricamento in corso…
            </p>
          )
        ) : daFare.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna attività in sospeso.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {daFare.map((s) => (
              <li key={s.id}>
                <LinkVista
                  vista={{ name: "dettaglio", id: s.id }}
                  onNavigate={onNavigate}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.nomeEsercizio ?? s.indirizzoVia}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {AZIONE_DA_FARE[s.stato] ?? labelStato(s.stato)}
                      {s.comune ? ` · ${s.comune.nome}` : ""}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                </LinkVista>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titolo-riepilogo" className="space-y-3">
        <h2 id="titolo-riepilogo" className="text-lg font-semibold">
          Riepilogo
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {INDICATORI.map((c) => {
            // Gli stati che richiedono un'azione di chi guarda hanno il numero in evidenza; gli altri sono esiti.
            const daFare = statiDaFare(user.ruolo).includes(c.stato);
            return (
              <LinkVista
                key={c.label}
                vista={{ name: "lista", stato: c.stato }}
                onNavigate={onNavigate}
                aria-label={`${c.label}: ${valore(c.valore)}. Apri la lista filtrata`}
                className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card
                  className={`h-full transition-colors hover:border-primary/50 hover:bg-accent/30 ${daFare ? "border-primary/40" : ""}`}
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle
                      className={`text-sm font-medium ${daFare ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {c.label}
                    </CardTitle>
                    <c.icon className={`w-4 h-4 ${c.colore}`} aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <div
                      className={
                        daFare
                          ? "text-4xl font-bold tabular-nums"
                          : "text-2xl font-semibold tabular-nums text-muted-foreground"
                      }
                    >
                      {valore(c.valore)}
                    </div>
                  </CardContent>
                </Card>
              </LinkVista>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          {stats
            ? `${stats.totali} ${stats.totali === 1 ? "segnalazione" : "segnalazioni"} in totale · ${stats.chiusePositive} chiuse con esito positivo · ${stats.chiuseNegative} con esito negativo · ${stats.recidive} ${stats.recidive === 1 ? "recidiva" : "recidive"}`
            : "Il riepilogo dettagliato non è disponibile."}
        </p>
      </section>
    </div>
  );
}
