/**
 * Striscia di avanzamento della pratica: mostra in quale fase si trova la
 * segnalazione, dalla bozza alla chiusura, senza richiedere di leggere lo stato.
 *
 * Autore: Fabio Tempera (2026)
 */

import { Check } from "lucide-react";
import type { StatoSegnalazione } from "@/lib/types";
import { labelStato } from "@/lib/types";

const FASI: { id: string; etichetta: string; stati: StatoSegnalazione[] }[] = [
  { id: "bozza", etichetta: "Bozza", stati: ["bozza"] },
  { id: "revisione", etichetta: "Revisione", stati: ["in_revisione"] },
  { id: "approvata", etichetta: "Approvata", stati: ["approvata"] },
  { id: "inviata", etichetta: "PEC inviata", stati: ["inviata"] },
  { id: "attesa", etichetta: "In attesa", stati: ["in_attesa"] },
  { id: "chiusa", etichetta: "Chiusa", stati: ["chiusa_positiva", "chiusa_negativa"] },
];

function indiceFase(stato: StatoSegnalazione): number {
  return FASI.findIndex((f) => f.stati.includes(stato));
}

export function StripaStato({ stato }: { stato: StatoSegnalazione }) {
  const corrente = indiceFase(stato);
  return (
    <nav aria-label="Avanzamento della pratica">
      <ol className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
        {FASI.map((fase, indice) => {
          const completata = indice < corrente;
          const attuale = indice === corrente;
          return (
            <li
              key={fase.id}
              aria-current={attuale ? "step" : undefined}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                attuale
                  ? "border-primary bg-primary/10 font-semibold text-foreground"
                  : completata
                    ? "border-border bg-muted/60 text-foreground"
                    : "border-dashed border-border text-muted-foreground"
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  attuale || completata ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
                aria-hidden="true"
              >
                {completata ? <Check className="size-3.5" /> : indice + 1}
              </span>
              <span className="min-w-0 leading-tight">
                {fase.etichetta}
                {completata && <span className="sr-only"> (completata)</span>}
                {attuale && <span className="sr-only"> (fase attuale: {labelStato(stato)})</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
