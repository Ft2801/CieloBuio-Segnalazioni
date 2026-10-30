/** Versione temporale della pratica e precondizione HTTP dello snapshot visualizzato. */
export function prossimaVersione(precedente?: Date): Date {
  return new Date(Math.max(Date.now(), (precedente?.getTime() ?? 0) + 1));
}

/** If-Match usa un tag forte: l'ISO completo conserva i millisecondi. */
export function versioneCorrisponde(attesa: string | null, corrente: Date): boolean {
  return attesa === null || attesa === JSON.stringify(corrente.toISOString());
}
