import { createHash, timingSafeEqual } from "crypto";

/**
 * Confronta due stringhe in modo timing-safe. Usato per verifiche
 * di token/secret dove il tempo di risposta non deve rivelare
 * informazioni sul valore atteso (timing side-channel).
 *
 * L'implementazione fa un hash SHA-256 di entrambe le stringhe prima
 * del confronto: questo normalizza la lunghezza (sempre 32 byte), così
 * l'early return sulla disuguaglianza di lunghezza non può rivelare
 * informazioni sulla lunghezza del secret atteso. L'hash è
 * deterministico e non introduce entropia aggiuntiva: la sicurezza
 * resta legata al confronto byte-a-byte timing-safe sul digest.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf8").digest();
  const hashB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(hashA, hashB);
}
