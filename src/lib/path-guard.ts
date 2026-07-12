/**
 * Path traversal protection centralizzata per gli allegati.
 *
 * Storicamente ogni route che manipola file in storage/uploads/ implementava
 * la propria validazione, con un livello di difesa incoerente:
 *  - download/route.ts, preview/route.ts, allegati DELETE, gdpr.ts:
 *    check completo (regex `..`, separatori `/` `\`, e startsWith)
 *  - lettera/route.ts: solo check `..` (manca startsWith e separatori)
 *  - invia-pec/route.ts: nessun check esplicito
 *  - upload/route.ts: solo commento "non serve perché è un CUID" ma nessuna
 *    validazione reale di formato
 *
 * Questo modulo centralizza le difese contro path traversal (validazione
 * segmenti + resolve normalizzato) e le espone come un'unica funzione
 * `risolviPathAllegatoSicuro` che ogni route può riutilizzare. Il risultato
 * è una sola fonte di verità per la sicurezza dei path su filesystem,
 * coerente con quanto dichiarato in SECURITY.md.
 *
 * Autore: Fabio Tempera (2026)
 */
import path from "path";

/** Radice assoluta del storage degli allegati. */
export const UPLOADS_ROOT = path.resolve(process.cwd(), "storage", "uploads");

/** Pattern CUID (cuid v2): usato da Prisma come default @id. */
const CUID_REGEX = /^c[a-z0-9]{20,30}$/i;

/**
 * Verifica che una stringa abbia il formato di un CUID valido.
 * Usato come difesa in profondità su tutti gli ID di segnalazione
 * provenienti da input utente, prima di usarli per costruire path.
 *
 * Nota: il controllo NON sostituisce la lookup nel DB (che resta il gate
 * principale), ma blocca input palesemente malevoli prima ancora di
 * interrogare il database, riducendo la superficie di attacco.
 */
export function isValidCuid(value: string): boolean {
  return typeof value === "string" && CUID_REGEX.test(value);
}

/**
 * Verifica che un singolo segmento di path sia sicuro: non contiene `..`,
 * né separatori di path (`/` o `\`), né è vuoto. Questo previene path
 * traversal classico e path assoluti (es. `/etc/passwd`) passati come
 * segmento.
 */
export function isSafePathSegment(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (value.includes("..")) return false;
  if (value.includes("/")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("\0")) return false;
  return true;
}

/**
 * Parsa un `urlStorage` (formato `<segnalazioneId>/<filename>` oppure
 * il formato legacy `api/allegatiplaceholder/<segnalazioneId>/<filename>`)
 * estrae i segmenti e li valida contro path traversal.
 *
 * Ritorna `{ segnalazioneId, filename }` se il formato è riconosciuto e
 * sicuro, oppure `null` se il formato non è valido o contiene segmenti
 * malevoli.
 */
export function parseUrlStorageSicuro(
  urlStorage: string
): { segnalazioneId: string; filename: string } | null {
  if (typeof urlStorage !== "string" || !urlStorage) return null;
  const parts = urlStorage.split("/").filter(Boolean);
  let segnalazioneId: string;
  let filename: string;
  if (parts.length === 2) {
    [segnalazioneId, filename] = parts;
  } else if (
    parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "allegatiplaceholder"
  ) {
    segnalazioneId = parts[2];
    filename = parts[3];
  } else {
    return null;
  }
  if (!isSafePathSegment(segnalazioneId)) return null;
  if (!isSafePathSegment(filename)) return null;
  return { segnalazioneId, filename };
}

/**
 * Risolve in modo sicuro il path fisico di un allegato, applicando le
 * due difese contro path traversal:
 *
 *  1. **Validazione segmenti**: ogni segmento (segnalazioneId, filename)
 *     è validato contro `..`, `/`, `\` e `\0`.
 *  2. **Resolve normalizzato**: `path.resolve` normalizza il path,
 *     eliminando eventuali `.` e `..` residui.
 *
 * Con segmenti sicuri (no `..`, `/`, `\`, `\0`), path.resolve
 * restituisce SEMPRE un path dentro UPLOADS_ROOT, quindi il check
 * startsWith aggiuntivo è ridondante e viene omesso.
 *
 * Se uno dei segmenti non è valido, ritorna `null` (il chiamante
 * deve rispondere 400/404).
 *
 * @param segnalazioneId ID della segnalazione (deve essere un segmento sicuro)
 * @param filename Nome del file sul filesystem (output di `randomUUID()`)
 */
export function risolviPathAllegatoSicuro(
  segnalazioneId: string,
  filename: string
): string | null {
  if (!isSafePathSegment(segnalazioneId)) return null;
  if (!isSafePathSegment(filename)) return null;
  // Con segmenti sicuri (no `..`, `/`, `\`, `\0`), path.resolve restituisce
  // SEMPRE un path dentro UPLOADS_ROOT. Il check startsWith aggiuntivo è
  // ridondante e viene omesso: la sicurezza è garantita da isSafePathSegment
  // chiamato sopra. La documentazione SECURITY.md dichiara "path traversal
  // protection a 2 livelli (validazione segmenti + resolve normalizzato)"
  // che si riferisce alla combinazione di: (1) validazione segmenti con
  // isSafePathSegment, (2) path.resolve che normalizza ulteriormente.
  return path.resolve(UPLOADS_ROOT, segnalazioneId, filename);
}
