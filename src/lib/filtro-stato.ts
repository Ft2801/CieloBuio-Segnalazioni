import type { StatoSegnalazione } from "@/lib/types";

const STATI_FILTRABILI: ReadonlyArray<StatoSegnalazione | "all"> = [
  "bozza",
  "in_revisione",
  "approvata",
  "inviata",
  "in_attesa",
  "chiusa_positiva",
  "chiusa_negativa",
  "all",
];

/**
 * Converte il parametro `stato` ricevuto dalla navigazione nel filtro della lista.
 * Un valore non riconosciuto ricade su "all" (nessun filtro).
 */
export function statoFiltroDaParametro(valore: string): StatoSegnalazione | "all" {
  return (STATI_FILTRABILI as ReadonlyArray<string>).includes(valore) ? (valore as StatoSegnalazione | "all") : "all";
}
