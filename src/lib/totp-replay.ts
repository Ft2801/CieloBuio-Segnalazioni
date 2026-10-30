/**
 * Protezione anti-replay dei codici TOTP (RFC 6238 §5.2).
 *
 * Il timestep del codice accettato viene registrato sull'utente in un'unica
 * istruzione condizionale: l'aggiornamento riesce solo se nessun timestep è
 * stato registrato oppure se quello registrato è strettamente minore. Due
 * richieste concorrenti con lo stesso codice non possono quindi entrambe
 * superare il controllo.
 *
 * Autore: Fabio Tempera (2026)
 */
import { db } from "@/lib/db";

/**
 * Registra un codice soltanto se il secret verificato è ancora quello attivo.
 * Durante una rotazione o disattivazione concorrente un codice del vecchio
 * dispositivo non può autorizzare una nuova sessione o operazione 2FA.
 *
 * @returns true se il codice non era stato usato e il secret è ancora attivo;
 *          false se il codice è già usato oppure il secret è cambiato.
 */
export async function registraTimestepTotp(userId: string, timestep: number, secretAttivo: string): Promise<boolean> {
  const { count } = await db.user.updateMany({
    where: {
      id: userId,
      totpSecret: secretAttivo,
      totpVerifiedAt: { not: null },
      OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: timestep } }],
    },
    data: { totpLastUsedTimestep: timestep },
  });
  return count === 1;
}
