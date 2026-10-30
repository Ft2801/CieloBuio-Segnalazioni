/**
 * Utilità HTTP condivise dalle route API.
 *
 * Autore: Fabio Tempera (2026)
 */

/**
 * Legge il corpo JSON della richiesta. Ritorna solo oggetti JSON non nulli:
 * per un body mancante, non JSON, un array o un valore primitivo ritorna null,
 * così il chiamante risponde 400 invece di generare un TypeError (500).
 */
export async function leggiBodyOggetto(req: Request): Promise<Record<string, unknown> | null> {
  const parsed: unknown = await req.json().catch(() => null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Converte un parametro di path o query in un ID PostgreSQL Int positivo.
 * Ritorna null per decimali, zero, notazione esponenziale e valori fuori
 * dall'intervallo Int32 (evitando errori Prisma che diventerebbero HTTP 500).
 */
export const MAX_ID_DB = 2147483647;

export function parseIdIntero(value: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= MAX_ID_DB ? n : null;
}

/**
 * Normalizza solo ID decimali in stringhe, preservando i tipi invalidi:
 * booleani, array e oggetti non devono diventare ID tramite Number().
 * La stringa vuota diventa null per consentire la cancellazione esplicita
 * dei campi territoriali nullable; un campo assente resta undefined.
 * Gli ID fuori intervallo restano stringhe e saranno rifiutati da Zod.
 */
export function normalizzaIdNumerico(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseIdIntero(trimmed) ?? value;
}

/**
 * I campi testuali facoltativi dei form usano "" per cancellare un valore.
 * Conservare gli altri tipi: convertire `false` o `0` in null con `value || null`
 * aggirerebbe la validazione Zod e nasconderebbe input JSON malformati.
 */
export function normalizzaStringaFacoltativa(value: unknown): unknown {
  return value === "" ? null : value;
}
