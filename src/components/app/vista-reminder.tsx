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
import { ArrowLeft, Clock, AlertTriangle, Mail, FileText } from "lucide-react";
import type { Segnalazione, SessionUser } from "@/lib/types";
import { labelStato, coloreStato } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_SEGNALAZIONI } from "@/lib/demo-data";

type PraticheResponse = {
  sogliaGiorni: number;
  count: number;
  pratiche: (Segnalazione & {
    volontario?: { id: string; nomeCognome: string; email: string };
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

  useEffect(() => {
    if (isDemoSession(user)) {
      // Modalità demo: dato statico incorporato nel bundle, nessuna
      // richiesta di rete. Funziona anche a server spento.
      setData({
        sogliaGiorni: 30,
        count: 1,
        pratiche: DEMO_SEGNALAZIONI.filter((s) => s.stato === "in_attesa"),
      });
      return;
    }
    fetch("/api/reminder")
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(console.error);
  }, [user]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>
        <h1 className="text-2xl font-bold">Pratiche in attesa da promemoria</h1>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="pt-6 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Soglia configurata: {data?.sogliaGiorni ?? 30} giorni senza risposta
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Le pratiche elencate sotto sono in stato &quot;in attesa&quot; da più tempo della soglia.
              Apri il dettaglio per valutare l&apos;invio di un promemoria email al volontario
              o al referente, oppure genera una nuova segnalazione collegata per recidiva.
            </p>
          </div>
        </CardContent>
      </Card>

      {!data ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : data.pratiche.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nessuna pratica oltre la soglia. Tutto sotto controllo.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.pratiche.map((s) => {
            const giorni = s.dataInvio
              ? Math.floor((Date.now() - new Date(s.dataInvio).getTime()) / (1000 * 60 * 60 * 24))
              : 0;
            return (
              <Card key={s.id} className="transition-colors hover:border-primary/40">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1 cursor-pointer" onClick={() => onApriDettaglio(s.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${coloreStato(s.stato)}`}>
                          {labelStato(s.stato)}
                        </span>
                        {s.numeroProtocollo && (
                          <Badge variant="outline" className="font-mono text-xs">{s.numeroProtocollo}</Badge>
                        )}
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" /> {giorni} giorni
                        </Badge>
                      </div>
                      <div className="font-medium truncate">{s.indirizzoVia}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.comune?.nome} ({s.provincia?.sigla}), volontario: {s.volontario?.nomeCognome ?? "n/d"}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {s.volontario?.email ?? "n/d"}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onApriDettaglio(s.id)}
                        aria-label={`Apri dettaglio pratica ${s.numeroProtocollo ?? s.id}`}
                      >
                        <FileText className="w-3 h-3 mr-1" /> Apri
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
