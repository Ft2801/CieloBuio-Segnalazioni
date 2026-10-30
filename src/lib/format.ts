/**
 * Formattazione condivisa per l'interfaccia: date in fuso orario italiano,
 * date-ora e plurali corretti. Centralizzata per evitare che ogni vista
 * formatti in modo diverso e per usare sempre lo stesso fuso orario
 * (le date arrivano dal server in UTC; senza `timeZone` il giorno può
 * risultare sfasato di uno vicino alla mezzanotte).
 */

export const FUSO_ORARIO_UI = "Europe/Rome";

const formatoData = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO_ORARIO_UI,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const formatoDataOra = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO_ORARIO_UI,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Converte una data (ISO string o Date) in Date valida, altrimenti null. */
function come(valore: string | Date | null | undefined): Date | null {
  if (!valore) return null;
  const d = valore instanceof Date ? valore : new Date(valore);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data nel formato gg/mm/aaaa, oppure "n/d" se assente o non valida. */
export function formatData(valore: string | Date | null | undefined): string {
  const d = come(valore);
  return d ? formatoData.format(d) : "n/d";
}

/** Data e ora nel formato gg/mm/aaaa hh:mm, oppure "n/d" se assente o non valida. */
export function formatDataOra(valore: string | Date | null | undefined): string {
  const d = come(valore);
  return d ? formatoDataOra.format(d) : "n/d";
}

/** Giorni interi trascorsi da una data (0 se la data non è valida o è futura). */
export function giorniTrascorsi(valore: string | Date | null | undefined, adesso: number = Date.now()): number {
  const d = come(valore);
  if (!d) return 0;
  const giorni = Math.floor((adesso - d.getTime()) / (1000 * 60 * 60 * 24));
  return giorni > 0 ? giorni : 0;
}

/** Sceglie il singolare o il plurale in base alla quantità. */
export function plurale(n: number, singolare: string, pluraleForma: string): string {
  return `${n} ${n === 1 ? singolare : pluraleForma}`;
}

/**
 * Nome di un territorio (regione) per la lettura: i dati sono salvati in
 * maiuscolo, ma la scheda mostra "Valle d'Aosta" e non "VALLE D'AOSTA".
 */
export function nomeTerritorio(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, separatore: string, lettera: string) => separatore + lettera.toUpperCase())
    .replace(/(^|\s)([DL])'(\p{L})/gu, (_, separatore: string, particella: string, lettera: string) => {
      return separatore + particella.toLowerCase() + "'" + lettera.toUpperCase();
    });
}
