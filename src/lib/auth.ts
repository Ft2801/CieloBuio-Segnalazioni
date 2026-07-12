/**
 * Libreria di autenticazione con sessioni via cookie HTTP-only.
 * Autore: Fabio Tempera (2026)
 */

import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

// Il prefisso __Host- è un marker di sicurezza che i browser moderni
// riconoscono: impone che il cookie sia Path=/, Secure, e senza attributo
// Domain. Questo previene session fixation via subdomain compromesso
// (un sottodominio malevolo non può impostare un cookie omonimo).
// In development (http://localhost) il prefisso __Host- non è compatibile
// perché richiede Secure, quindi usiamo un nome semplice.
// La funzione getSessionCookieName() ricalcola il nome a runtime in base
// a NODE_ENV, così i cambiamenti di env nei test sono gestiti correttamente.
export function getSessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-cb_session" : "cb_session";
}
// Backward compatibility: costante calcolata all'import. Per test che
// cambiano NODE_ENV a runtime, usare getSessionCookieName().
export const SESSION_COOKIE = getSessionCookieName();
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8; // 8 ore (ridotto da 7 giorni per sicurezza)
const BCRYPT_COST = 12; // raccomandazione moderna OWASP

export type SessionUser = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: "volontario" | "referente_provinciale" | "referente_regionale" | "admin";
  provinciaId: number | null;
  regioneId: number | null;
  inizialiProtocollo: string | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  firma: string | null;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const scadenza = new Date(Date.now() + SESSION_DURATION_MS);

  // L1: invalida tutte le sessioni precedenti dello stesso utente (session rotation)
  // per prevenire session fixation. Mantiene solo la nuova sessione.
  await db.$transaction([
    db.sessione.deleteMany({ where: { userId } }),
    db.sessione.create({ data: { userId, token, scadenza } }),
  ]);
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) return null;

  const sessione = await db.sessione.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!sessione) return null;
  if (sessione.scadenza < new Date()) {
    await db.sessione.delete({ where: { id: sessione.id } }).catch(() => {});
    return null;
  }
  if (!sessione.user.attivo) return null;

  return {
    id: sessione.user.id,
    email: sessione.user.email,
    nomeCognome: sessione.user.nomeCognome,
    ruolo: sessione.user.ruolo as SessionUser["ruolo"],
    provinciaId: sessione.user.provinciaId,
    regioneId: sessione.user.regioneId,
    inizialiProtocollo: sessione.user.inizialiProtocollo,
    pec: sessione.user.pec,
    emailOrdinaria: sessione.user.emailOrdinaria,
    indirizzo: sessione.user.indirizzo,
    firma: sessione.user.firma,
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (token) {
    await db.sessione.deleteMany({ where: { token } }).catch(() => {});
  }
}

/**
 * Crea l'header Set-Cookie per la sessione.
 * In produzione (NODE_ENV=production) aggiunge il flag Secure e usa il
 * prefisso __Host- per prevenire session fixation via subdomain.
 */
export function setSessionCookie(token: string): string {
  const scadenza = new Date(Date.now() + SESSION_DURATION_MS);
  const cookieName = getSessionCookieName();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Expires=${scadenza.toUTCString()}; Max-Age=${SESSION_DURATION_MS / 1000}`;
}

export function clearSessionCookie(): string {
  const cookieName = getSessionCookieName();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Helpers per i ruoli
// ---------------------------------------------------------------------------

export function canViewAllSegnalazioni(user: SessionUser): boolean {
  return user.ruolo === "admin";
}

export function canReviewSegnalazioni(user: SessionUser): boolean {
  return (
    user.ruolo === "admin" ||
    user.ruolo === "referente_provinciale" ||
    user.ruolo === "referente_regionale"
  );
}

export function canSendPec(user: SessionUser): boolean {
  // Solo referenti e admin possono inviare PEC reali (dopo approvazione)
  return canReviewSegnalazioni(user);
}

export function canManageConfiguration(user: SessionUser): boolean {
  return user.ruolo === "admin";
}

/**
 * Verifica se un utente ha competenza territoriale su una segnalazione.
 * L'admin ha competenza su tutto. I referenti provinciali solo sulla propria
 * provincia, i referenti regionali solo sulla propria regione.
 *
 * Comportamento fail-closed: se il referente non ha provinciaId/regioneId
 * assegnato (utente mal configurato), non ha competenza su nulla. Questo
 * previene accessi indebiti nel caso (teoricamente possibile) di segnalazioni
 * senza provincia/regione associata.
 */
export function hasTerritorialCompetence(
  user: SessionUser,
  segnalazione: { provinciaId: number | null; regioneId: number | null }
): boolean {
  if (user.ruolo === "admin") return true;
  if (user.ruolo === "referente_provinciale") {
    // Entrambi devono essere non-null e uguali.
    if (user.provinciaId === null) return false;
    return segnalazione.provinciaId !== null && segnalazione.provinciaId === user.provinciaId;
  }
  if (user.ruolo === "referente_regionale") {
    if (user.regioneId === null) return false;
    return segnalazione.regioneId !== null && segnalazione.regioneId === user.regioneId;
  }
  return false;
}

/**
 * Verifica se un utente può visualizzare una segnalazione.
 * - admin: tutte
 * - referente_provinciale: quelle della propria provincia (se assegnata)
 * - referente_regionale: quelle della propria regione (se assegnata)
 * - volontario: solo le proprie
 *
 * Un referente senza territorio assegnato non vede alcuna segnalazione.
 * Le segnalazioni anonimizzate (volontarioId=null, vedi cron GDPR) non
 * sono visibili al volontario (non essendoci legame), ma restano visibili
 * ad admin e referenti territoriali per audit.
 */
export function canViewSegnalazione(
  user: SessionUser,
  segnalazione: { volontarioId: string | null; provinciaId: number | null; regioneId: number | null }
): boolean {
  if (user.ruolo === "admin") return true;
  if (user.ruolo === "referente_provinciale") {
    if (user.provinciaId === null) return false;
    return segnalazione.provinciaId !== null && segnalazione.provinciaId === user.provinciaId;
  }
  if (user.ruolo === "referente_regionale") {
    if (user.regioneId === null) return false;
    return segnalazione.regioneId !== null && segnalazione.regioneId === user.regioneId;
  }
  // volontario: vede solo le proprie. Una segnalazione anonimizzata
  // (volontarioId=null) non appartiene a nessun volontario, quindi non
  // è visibile a nessun utente di ruolo "volontario".
  return segnalazione.volontarioId !== null && segnalazione.volontarioId === user.id;
}

/**
 * Filtro di visibilità delle segnalazioni in base al ruolo:
 * - volontario: vede solo le proprie
 * - referente_provinciale: vede quelle della propria provincia (se assegnata)
 * - referente_regionale: vede quelle della propria regione (se assegnata)
 * - admin: vede tutto
 *
 * Se un referente non ha territorio assegnato, ritorna un filtro che non
 * matcha nulla (id="__NEVER_MATCH__"), evitando che veda tutte le
 * segnalazioni (un filtro vuoto `{}` in Prisma significa "nessun filtro").
 */
export function getVisibilityFilter(user: SessionUser) {
  if (user.ruolo === "admin") return {};
  if (user.ruolo === "referente_provinciale") {
    if (user.provinciaId === null) return { id: "__NEVER_MATCH__" };
    return { provinciaId: user.provinciaId };
  }
  if (user.ruolo === "referente_regionale") {
    if (user.regioneId === null) return { id: "__NEVER_MATCH__" };
    return { regioneId: user.regioneId };
  }
  return { volontarioId: user.id };
}
