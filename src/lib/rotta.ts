/**
 * Routing dell'app a query string: ogni vista ha un indirizzo condivisibile e
 * ricaricabile, ad esempio `/?v=lista&stato=bozza` oppure `/?v=dettaglio&id=...`.
 *
 * Il modulo è puro (nessun accesso a `window`) così da poter essere testato in
 * isolamento. La build statica (GitHub Pages) e il server standalone usano lo
 * stesso formato, perché la pagina è sempre la stessa e cambia solo la query.
 */

import type { StatoSegnalazione } from "@/lib/types";
import { statoFiltroDaParametro } from "@/lib/filtro-stato";

export type Vista =
  | { name: "dashboard" }
  | { name: "lista"; stato: StatoSegnalazione | "all" }
  | { name: "nuova-segnalazione"; segnalazionePrecedenteId?: string }
  | { name: "modifica-segnalazione"; id: string }
  | { name: "dettaglio"; id: string }
  | { name: "admin" }
  | { name: "reminder" }
  | { name: "guida" };

type NomeVista = Vista["name"];

const NOMI_VISTA: ReadonlyArray<NomeVista> = [
  "dashboard",
  "lista",
  "nuova-segnalazione",
  "modifica-segnalazione",
  "dettaglio",
  "admin",
  "reminder",
  "guida",
];

// Gli identificativi (cuid, ID demo) sono alfanumerici con trattini o underscore.
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function idValido(valore: string | null): string | null {
  return valore !== null && ID_VALIDO.test(valore) ? valore : null;
}

/**
 * Ricava la vista dalla query string. Un parametro non valido non produce
 * errori: la vista ricade sulla dashboard (o sulla lista, per i filtri).
 */
export function vistaDaQuery(search: string): Vista {
  const params = new URLSearchParams(search);
  const nome = params.get("v") ?? "dashboard";
  if (!(NOMI_VISTA as ReadonlyArray<string>).includes(nome)) return { name: "dashboard" };

  // Il controllo sopra garantisce che `nome` sia uno dei nomi di vista: lo switch è esaustivo.
  switch (nome as NomeVista) {
    case "dashboard":
      return { name: "dashboard" };
    case "lista":
      return { name: "lista", stato: statoFiltroDaParametro(params.get("stato") ?? "all") };
    case "nuova-segnalazione": {
      const precedente = idValido(params.get("precedente"));
      return precedente
        ? { name: "nuova-segnalazione", segnalazionePrecedenteId: precedente }
        : { name: "nuova-segnalazione" };
    }
    case "modifica-segnalazione": {
      const id = idValido(params.get("id"));
      return id ? { name: "modifica-segnalazione", id } : { name: "dashboard" };
    }
    case "dettaglio": {
      const id = idValido(params.get("id"));
      return id ? { name: "dettaglio", id } : { name: "dashboard" };
    }
    case "admin":
      return { name: "admin" };
    case "reminder":
      return { name: "reminder" };
    case "guida":
      return { name: "guida" };
  }
}

/**
 * Costruisce l'href relativo della vista. Gli href sono relativi alla pagina
 * corrente (`?v=...`) così funzionano anche con il basePath di GitHub Pages.
 */
export function hrefDaVista(vista: Vista): string {
  const params = new URLSearchParams();
  switch (vista.name) {
    case "dashboard":
      return "./";
    case "lista":
      params.set("v", "lista");
      if (vista.stato !== "all") params.set("stato", vista.stato);
      break;
    case "nuova-segnalazione":
      params.set("v", "nuova-segnalazione");
      if (vista.segnalazionePrecedenteId) params.set("precedente", vista.segnalazionePrecedenteId);
      break;
    case "modifica-segnalazione":
      params.set("v", "modifica-segnalazione");
      params.set("id", vista.id);
      break;
    case "dettaglio":
      params.set("v", "dettaglio");
      params.set("id", vista.id);
      break;
    default:
      params.set("v", vista.name);
  }
  return `?${params.toString()}`;
}

/**
 * Ruoli che possono vedere una vista. Le viste non consentite ricadono sulla
 * dashboard: l'accesso reale resta comunque controllato dal server.
 */
export function vistaConsentita(vista: Vista, ruolo: string): boolean {
  if (vista.name === "admin") return ruolo === "admin";
  if (vista.name === "reminder") return ruolo !== "volontario";
  return true;
}
