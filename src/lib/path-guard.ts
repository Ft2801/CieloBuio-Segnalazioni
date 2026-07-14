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

/**
 * Radice assoluta del storage degli allegati.
 * Può essere overridden tramite STORAGE_ROOT env var per deployment
 * dove il storage è montato su un percorso diverso da process.cwd()/storage.
 */
export const UPLOADS_ROOT = path.resolve(
  process.env.STORAGE_ROOT ?? path.join(process.cwd(), "storage", "uploads")
);

/**
 * Pattern CUID (cuid v2): usato da Prisma come default @id.
 * CUID v2 genera stringhe di 24 caratteri lowercase che iniziano con 'c'.
 * Accettiamo una tolleranza più ampia (lunghezza totale 21-31 caratteri,
 * ovvero 'c' + 20-30 caratteri alfanumerici) per compatibilità con
 * eventuali future versioni della libreria e varianti generate da altre
 * implementazioni. Manteniamo il flag case-insensitive per robustezza.
 */
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
 * né il segmento corrente `.`, né separatori di path (`/` o `\`), né è
 * vuoto, né contiene caratteri di controllo (0x00-0x1F, 0x7F) che
 * potrebbero rompere log di logging o passare a contesti shell downstream.
 *
 * Questo previene path traversal classico, path assoluti (es. `/etc/passwd`)
 * passati come segmento, riferimenti impliciti alla directory corrente
 * (`.`) e injection di newline/tab in nome file che potrebbero
 * inquinare i log o confondere parser downstream.
 */
export function isSafePathSegment(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  // Blocca path traversal, separatori e riferimenti impliciti (. e ..)
  if (/[\/\\]|\.\.|^\.$|\0/.test(value)) return false;
  // Blocca caratteri di controllo ASCII (0x00-0x1F e 0x7F DEL)
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
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
 *
 * Nota: NON usiamo `split("/").filter(Boolean)` perché collasserebbe
 * `a//b` in `["a","b"]` mascherando formati anomali. Verifichiamo
 * esplicitamente il numero di segmenti attesi.
 */
export function parseUrlStorageSicuro(
  urlStorage: string
): { segnalazioneId: string; filename: string } | null {
  if (typeof urlStorage !== "string" || !urlStorage) return null;
  // Split senza filter: se ci sono segmenti vuoti (es. "a//b"), il
  // numero di parti non matcha e la funzione ritorna null.
  const parts = urlStorage.split("/");
  // Verifica che non ci siano segmenti vuoti (doppi slash)
  if (parts.some((p) => p.length === 0)) return null;
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
 * difese contro path traversal:
 *
 *  1. **Validazione segmenti**: ogni segmento (segnalazioneId, filename)
 *     è validato contro `..`, `/`, `\`, `\0` e caratteri di controllo.
 *  2. **Resolve normalizzato**: `path.resolve` normalizza il path,
 *     eliminando eventuali `.` e `..` residui.
 *  3. **startsWith check**: defense-in-depth, verifica che il path
 *     risolto sia effettivamente dentro UPLOADS_ROOT. Anche se con
 *     segmenti sicuri è teoricamente garantito, mantenere il check
 *     protegge contro regressioni future su isSafePathSegment.
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
  const resolved = path.resolve(UPLOADS_ROOT, segnalazioneId, filename);
  // Defense-in-depth: verifica esplicita che il path risolto sia dentro
  // UPLOADS_ROOT. Garantisce protezione anche in caso di regressione
  // futura su isSafePathSegment.
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep) && resolved !== UPLOADS_ROOT) {
    return null;
  }
  return resolved;
}
