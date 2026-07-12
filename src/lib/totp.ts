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
 * `userEmail` è mantenuto per compatibilità con la firma pubblica
 * esistente, ma NON è usato internamente: il secret è generato in modo
 * totalmente casuale da `otpauth` (20 byte di entropia).
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
 * Ritorna true se il codice è valido per la finestra temporale corrente.
 */
export function verifyTotp(token: string, secretBase32: string): boolean {
  if (!secretBase32 || !token) return false;
  try {
    const totp = createTotp("", secretBase32);
    const delta = totp.validate({ token: token.trim(), window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}
