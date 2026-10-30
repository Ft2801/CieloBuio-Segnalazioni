"use client";

/**
 * Vista dei promemoria: elenca le pratiche in stato "in_attesa" da più di N giorni.
 * Per ogni pratica sono disponibili azioni rapide: apri dettaglio, o genera
 * una nuova segnalazione collegata per recidiva.
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, AlertTriangle, Mail, FileText, RotateCcw } from "lucide-react";
import type { Segnalazione, SessionUser } from "@/lib/types";
import { labelStato, coloreStato } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_SEGNALAZIONI } from "@/lib/demo-data";
import { formatDataOra, giorniTrascorsi, plurale } from "@/lib/format";

type PraticheResponse = {
  sogliaGiorni: number;
  count: number;
  pratiche: (Segnalazione & {
    volontario?: { id: string; nomeCognome: string; email: string } | null;
  })[];
};

export function VistaReminder({
  user,
  onBack,
  onApriDettaglio,
}: {
  user: SessionUser;
  onBack: () => void;
  onApriDettaglio: (id: string) => void;
}) {
  const [data, setData] = useState<PraticheResponse | null>(null);
  const [errore, setErrore] = useState<boolean>(false);

  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    if (isDemoSession(user)) {
      // Modalità demo: dato statico incorporato nel bundle, nessuna
      // richiesta di rete. Funziona anche a server spento.
      const pratiche = DEMO_SEGNALAZIONI.filter((s) => s.stato === "in_attesa");
      setData({ sogliaGiorni: 30, count: pratiche.length, pratiche });
      setErrore(false);
      return;
    }
    let cancelled = false;
    setErrore(false);
    fetch("/api/reminder")
      .then(async (r) => {
        if (!r.ok) {
          if (!cancelled) setErrore(true);
          return null;
        }
        return r.json().catch(() => null);
      })
      .then((d) => {
        if (cancelled) return;
        // Accetta solo un oggetto con l'elenco pratiche atteso (non un errore JSON
        // né un corpo privo del campo): altrimenti la vista mostra l'errore.
        if (d && typeof d === "object" && Array.isArray((d as { pratiche?: unknown }).pratiche)) {
          setData(d);
        } else {
          setErrore(true);
        }
      })
      .catch(() => {
        if (!cancelled) setErrore(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, tentativo]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>
        <h1 className="text-2xl font-bold">Pratiche in attesa da promemoria</h1>
      </div>

      <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/50">
        <CardContent className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              Soglia: {plurale(data?.sogliaGiorni ?? 30, "giorno", "giorni")} senza risposta
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Sono elencate le pratiche in attesa di risposta da più tempo della soglia. Apri il dettaglio per decidere
              se generare una segnalazione collegata per recidiva.
            </p>
          </div>
        </CardContent>
      </Card>

      {errore ? (
        <Card className="border-rose-500/50 bg-rose-50 dark:bg-rose-950/50">
          <CardContent className="text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-rose-700 dark:text-rose-300 mb-3" aria-hidden="true" />
            <p className="text-rose-900 dark:text-rose-100 font-medium mb-1">
              Impossibile caricare le pratiche in attesa
            </p>
            <p className="text-sm text-muted-foreground mb-4">Verifica la connessione e riprova.</p>
            <Button variant="outline" className="gap-2" onClick={() => setTentativo((n) => n + 1)}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Riprova
            </Button>
          </CardContent>
        </Card>
      ) : !data ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" role="status">
            Caricamento in corso…
          </CardContent>
        </Card>
      ) : data.pratiche.length === 0 ? (
        <Card>
          <CardContent className="text-center">
            <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-muted-foreground">Nessuna pratica supera la soglia.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.pratiche.map((s) => {
            const giorni = giorniTrascorsi(s.dataInvio ?? s.dataSegnalazione);
            return (
              <li key={s.id}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${coloreStato(s.stato)}`}
                          >
                            {labelStato(s.stato)}
                          </span>
                          {s.numeroProtocollo && (
                            <Badge variant="outline" className="font-mono text-xs">
                              {s.numeroProtocollo}
                            </Badge>
                          )}
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />
                            {plurale(giorni, "giorno", "giorni")}
                          </Badge>
                        </div>
                        <div className="font-medium truncate">{s.indirizzoVia}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.comune?.nome} ({s.provincia?.sigla}), volontario: {s.volontario?.nomeCognome ?? "n/d"}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                          <Mail className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{s.volontario?.email ?? "n/d"}</span>
                        </div>
                        {s.dataInvio && (
                          <div className="text-xs text-muted-foreground">Inviata il {formatDataOra(s.dataInvio)}</div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onApriDettaglio(s.id)}
                          aria-label={`Apri dettaglio pratica ${s.numeroProtocollo ?? s.id}`}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Apri
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
