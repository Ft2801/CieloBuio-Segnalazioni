"use client";

/**
 * Dashboard principale con statistiche riepilogative.
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  FileEdit,
  Inbox,
  Layers,
} from "lucide-react";
import type { SessionUser, StatoSegnalazione } from "@/lib/types";
import { STATI_SEGNALAZIONE } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_STATS } from "@/lib/demo-data";

type Stats = {
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

export function Dashboard({
  user,
  onNavigate,
}: {
  user: SessionUser;
  onNavigate: (vista: string, params?: Record<string, unknown>) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    if (isDemoSession(user)) {
      // Modalità demo: dati statici incorporati nel bundle, nessuna
      // richiesta di rete. Funziona anche a server spento.
      setStats(DEMO_STATS);
      return;
    }
    // Verifica r.ok prima di usare i dati: una risposta 401/500 con body
    // JSON {error: ...} non verrebbe riconosciuta come errore senza questo
    // check, e i suoi campi verrebbero usati come stats valide mostrando
    // 0 ovunque invece di un messaggio di errore.
    fetch("/api/stats")
      .then(async (r) => {
        if (!r.ok) {
          setStatsError(true);
          setStats(null);
          return null;
        }
        return r.json().catch(() => null);
      })
      .then((data) => {
        if (data && typeof data === "object" && !("error" in data)) {
          setStats(data);
          setStatsError(false);
        }
      })
      .catch(() => {
        setStatsError(true);
      });
  }, [user]);

  const cards = [
    {
      label: "Bozze",
      value: stats?.bozze ?? 0,
      icon: FileEdit,
      colore: "text-slate-400",
      stato: "bozza" as StatoSegnalazione,
    },
    {
      label: "In revisione",
      value: stats?.inRevisione ?? 0,
      icon: Inbox,
      colore: "text-amber-400",
      stato: "in_revisione" as StatoSegnalazione,
    },
    {
      label: "Approvate",
      value: stats?.approvate ?? 0,
      icon: CheckCircle2,
      colore: "text-blue-400",
      stato: "approvata" as StatoSegnalazione,
    },
    {
      label: "Inviate",
      value: stats?.inviate ?? 0,
      icon: Send,
      colore: "text-emerald-400",
      stato: "inviata" as StatoSegnalazione,
    },
    {
      label: "In attesa",
      value: stats?.inAttesa ?? 0,
      icon: Clock,
      colore: "text-cyan-400",
      stato: "in_attesa" as StatoSegnalazione,
    },
    {
      label: "Chiuse positiva",
      value: stats?.chiusePositive ?? 0,
      icon: CheckCircle2,
      colore: "text-green-500",
      stato: "chiusa_positiva" as StatoSegnalazione,
    },
    {
      label: "Chiuse negativa",
      value: stats?.chiuseNegative ?? 0,
      icon: XCircle,
      colore: "text-rose-500",
      stato: "chiusa_negativa" as StatoSegnalazione,
    },
    {
      label: "Recidive",
      value: stats?.recidive ?? 0,
      icon: AlertTriangle,
      colore: "text-orange-400",
      stato: null,
    },
  ];

  const saluto =
    user.ruolo === "admin"
      ? "Amministratore"
      : user.ruolo === "referente_provinciale"
        ? "Referente provinciale"
        : user.ruolo === "referente_regionale"
          ? "Referente regionale"
          : "Volontario";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Benvenuto, {user.nomeCognome}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {saluto}, {user.email}
          </p>
        </div>
        <Button onClick={() => onNavigate("nuova-segnalazione")} className="gap-2">
          <FileText className="w-4 h-4" /> Nuova segnalazione
        </Button>
      </div>

      {stats?.inAttesaOverdue ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {stats.inAttesaOverdue} pratiche in attesa da oltre 30 giorni
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Valuta l&apos;invio di un promemoria o la generazione di una nuova
                segnalazione collegata per recidiva.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => onNavigate("reminder")}
              >
                Vai ai promemoria
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {statsError && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-rose-800 dark:text-rose-200">
                Impossibile caricare le statistiche
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Verifica la connessione al server. Se il problema persiste, ricarica la pagina.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={
              c.stato
                ? "cursor-pointer hover:border-primary/40 hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                : ""
            }
            onClick={() => c.stato && onNavigate("lista", { stato: c.stato })}
            onKeyDown={(e) => {
              if (c.stato && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onNavigate("lista", { stato: c.stato });
              }
            }}
            role={c.stato ? "button" : undefined}
            tabIndex={c.stato ? 0 : undefined}
            aria-label={c.stato ? `Apri lista segnalazioni in stato ${c.label}` : undefined}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className={`w-4 h-4 ${c.colore}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="w-4 h-4" /> Totale segnalazioni
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats?.totali ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">
              Pratiche complessive gestite ({user.ruolo === "volontario" ? "tue" : "nel tuo ambito"})
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stati delle segnalazioni</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {STATI_SEGNALAZIONE.map((s) => (
                <li key={s.value} className="flex items-start gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.colore}`}
                  />
                  <div>
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted-foreground">, {s.descrizione}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
