/**
 * Testo leggibile di un valore lanciato in un `catch`. Gli errori JavaScript
 * espongono `message`; qualsiasi altro valore viene convertito in stringa.
 */
export function messaggioDaErrore(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
