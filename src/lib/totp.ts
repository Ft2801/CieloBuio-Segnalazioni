/**
 * Libreria TOTP (Time-based One-Time Password) per autenticazione a due fattori.
 *
 * Usa otpauth per generare e verificare codici TOTP conformi a RFC 6238.
 * I secret sono memorizzati come stringa Base32 nel database (campi
 * totpSecret e totpVerifiedAt sul modello User).
 *
 * Autore: Fabio Tempera (2026)
 */
import { Secret, TOTP } from "otpauth";

const ISSUER = "CieloBuio Segnalazioni";
const PERIOD = 30; // secondi
const DIGITS = 6;
const ALGORITHM = "SHA1";

/**
 * Genera un nuovo secret TOTP per un utente.
 * Ritorna il secret come stringa Base32.
 *
 * Nota: il secret NON è derivato dall'email dell'utente (derivarlo
 * ridurrebbe l'entropia a quella dell'email stessa). Il parametro
 * `_userEmail` è accettato per uniformità con le altre funzioni del modulo
 * e non viene usato: il secret è generato in modo casuale da `otpauth`
 * (20 byte di entropia).
 */
export function generateTotpSecret(_userEmail?: string): string {
  const secret = new Secret({ size: 20 });
  return secret.base32;
}

/**
 * Crea un oggetto TOTP configurato per un utente.
 */
export function createTotp(userEmail: string, secretBase32: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: userEmail,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

/**
 * Genera l'URL otpauth:// per la configurazione del QR code.
 */
export function generateTotpUri(userEmail: string, secretBase32: string): string {
  const totp = createTotp(userEmail, secretBase32);
  return totp.toString();
}

/**
 * Verifica un codice TOTP fornito dall'utente.
 * Ritorna l'oggetto { valid, delta } dove `delta` è lo scostamento
 * della finestra temporale (0 = step corrente, -1 = step precedente,
 * +1 = step successivo). `delta` è necessario al chiamante per
 * implementare la protezione anti-replay (RFC 6238 §5.2 richiede
 * che il server rigetti tentativi di riusare lo stesso codice).
 *
 * Il timestamp passato dal chiamante deve essere lo stesso usato per
 * calcolare il timestep da registrare, anche se nel frattempo cambia finestra.
 *
 * La finestra è ±1 step (30 secondi) per tollerare clock drift tra
 * client e server, come raccomandato da RFC 6238.
 */
export function verifyTotpWithDelta(
  token: string,
  secretBase32: string,
  timestamp: number = Date.now(),
): { valid: true; delta: number } | { valid: false } {
  if (!secretBase32 || !token) return { valid: false };
  try {
    const totp = createTotp("", secretBase32);
    const delta = totp.validate({ token: token.trim(), window: 1, timestamp });
    if (delta === null) return { valid: false };
    return { valid: true, delta };
  } catch {
    return { valid: false };
  }
}

/**
 * Verifica un codice TOTP fornito dall'utente.
 * Ritorna true se il codice è valido per la finestra temporale (step corrente
 * o adiacente, vedi `verifyTotpWithDelta`).
 *
 * Nota: questa funzione NON implementa protezione anti-replay. Per
 * prevenire il riuso dello stesso codice (RFC 6238 §5.2), il chiamante
 * deve usare `verifyTotpWithDelta` e registrare il timestep usato
 * per ogni utente, rifiutando verifiche con timestep <= ultimo usato.
 * L'integrazione con il DB è gestita in src/app/api/auth/2fa/route.ts
 * e src/app/api/auth/login/route.ts.
 */
export function verifyTotp(token: string, secretBase32: string): boolean {
  return verifyTotpWithDelta(token, secretBase32).valid;
}

/**
 * Calcola il timestep (counter) TOTP corrispondente a un timestamp
 * e a un delta di finestra. Usato dal chiamante per registrare
 * l'ultimo timestep usato e implementare la protezione anti-replay.
 */
export function computeTotpTimestep(date: Date, delta: number): number {
  return Math.floor(date.getTime() / 1000 / PERIOD) + delta;
}
