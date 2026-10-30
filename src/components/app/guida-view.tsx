"use client";

/**
 * Guida in-app: percorso di una segnalazione, glossario degli stati, ruoli e
 * riferimenti dell'autore. Sostituisce la legenda che prima occupava la dashboard.
 *
 * Autore: Fabio Tempera (2026)
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATI_SEGNALAZIONE, puntoStato } from "@/lib/types";

const RUOLI: { nome: string; descrizione: string }[] = [
  {
    nome: "Volontario",
    descrizione: "Registra le segnalazioni sul campo, modifica le proprie bozze e le invia al referente territoriale.",
  },
  {
    nome: "Referente provinciale",
    descrizione:
      "Revisiona le segnalazioni della propria provincia: le approva o le respinge con una nota, e invia la PEC al Comune.",
  },
  {
    nome: "Referente regionale",
    descrizione: "Svolge le stesse funzioni del referente provinciale sull'intero territorio regionale di competenza.",
  },
  {
    nome: "Amministratore",
    descrizione:
      "Gestisce l'anagrafica territoriale (regioni, province, comuni) e gli utenti, e accede alla sezione Amministrazione.",
  },
];

export function GuidaView() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Guida</h1>
        <p className="text-sm text-muted-foreground mt-1">
          CieloBuio raccoglie le segnalazioni di impianti di illuminazione non conformi e le trasmette ai Comuni via
          PEC, con un percorso di revisione prima dell&apos;invio.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Glossario degli stati</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {STATI_SEGNALAZIONE.map((s) => (
              <div key={s.value} className="text-sm">
                <dt className="flex items-center gap-2 font-medium">
                  <span
                    className={`inline-block size-2.5 shrink-0 rounded-full ${puntoStato(s.value)}`}
                    aria-hidden="true"
                  />
                  {s.label}
                </dt>
                <dd className="text-muted-foreground mt-0.5">{s.descrizione}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ruoli</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            {RUOLI.map((r) => (
              <div key={r.nome}>
                <dt className="font-medium">{r.nome}</dt>
                <dd className="text-muted-foreground">{r.descrizione}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
