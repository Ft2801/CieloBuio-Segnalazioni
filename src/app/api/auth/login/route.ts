/**
 * API: POST /api/auth/login
 * Login con email, password e (opzionale) codice TOTP 2FA. Crea sessione.
 * Rate limiting: 20 tentativi per IP e 3 per email, poi escalation dei blocchi
 * (5 min -> 15 min -> 1 ora -> 24 ore). Vedi src/lib/rate-limit.ts.
 *
 * Il rate limit doppio (IP + email) resta efficace anche se un attaccante
 * ruota l'IP: non può superare 3 tentativi per singola email target. Viceversa,
 * un attaccante che prova tante email diverse dallo stesso IP è comunque
 * bloccato. L'IP reale è letto solo da X-Real-IP (impostato da Caddy).
 *
 * Mitigazione timing side-channel: se l'utente non esiste, eseguiamo
 * comunque bcrypt.compare con un hash sentinella (cost 12) per uniformare
 * i tempi di risposta e impedire l'user enumeration via timing. La
 * sentinella è generata all'avvio del processo da una password casuale
 * che non viene mai esposta; il risultato del confronto non è mai usato.
 *
 * 2FA TOTP: se l'utente ha configurato e verificato un secret TOTP
 * (User.totpSecret non null E User.totpVerifiedAt non null), il login
 * richiede anche il codice TOTP nel body
 * ({ email, password, totpToken }). Se il token TOTP manca o non è
 * valido, rispondiamo 401 con un messaggio che indica esplicitamente
 * la richiesta del 2FA, senza rivelare se la password era corretta
 * (per non indebolire il gate del 2FA stesso).
 * NOTA: totpVerifiedAt è obbligatorio per richiedere il 2FA: un utente
 * che ha avviato il setup (totpSecret valorizzato) ma non ha completato
 * la verifica (totpVerifiedAt null) NON viene bloccato dal 2FA, per
 * prevenire il lockout accidentale dell'account.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword, createSession, setSessionCookie, CredenzialiCambiate } from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { verifyTotpWithDelta, computeTotpTimestep } from "@/lib/totp";
import { logger } from "@/lib/logger";
import { leggiBodyOggetto } from "@/lib/http";
import { registraTimestepTotp } from "@/lib/totp-replay";
import { randomBytes } from "crypto";

function getClientIp(req: NextRequest): string {
  // X-Real-IP è impostato dal reverse proxy (Caddy) a partire dall'IP reale
  // della connessione. X-Forwarded-For non è mai usato: il client può
  // falsificarlo e aggirare il rate limit per IP. Senza il proxy (sviluppo
  // locale) tutte le richieste condividono il bucket "unknown", che è il
  // comportamento sicuro (fail-closed). Requisito di deploy: l'applicazione
  // non deve essere raggiungibile direttamente, ma solo tramite Caddy.
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}

// Hash bcrypt "sentinella" usato per uniformare i tempi di risposta quando
// l'utente non esiste. È calcolato all'import del modulo (non in modo lazy),
// così il primo login fallito dopo l'avvio non paga anche il costo della
// generazione dell'hash, che renderebbe distinguibile la prima richiesta.
const sentinelHashPromise: Promise<string> = hashPassword(
  "sentinel-password-not-used-for-auth-" + randomBytes(32).toString("hex"),
);
async function getSentinelHash(): Promise<string> {
  return sentinelHashPromise;
}

// Tentativi per IP prima del blocco. Il limite è più alto di quello per email
// perché più utenti possono condividere lo stesso IP pubblico (rete d'ufficio):
// un limite basso permetterebbe a un solo client di bloccare tutti gli altri.
const LIMITE_TENTATIVI_IP = 20;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipRateLimitKey = `login:ip:${ip}`;

  // Pre-flight: parsa il body per estrarre l'email prima del rate limit,
  // così possiamo applicare entrambi i limiti (IP e email).
  const body = await leggiBodyOggetto(req);
  if (!body) {
    return NextResponse.json({ error: "Body della richiesta non valido" }, { status: 400 });
  }
  const email = (typeof body.email === "string" ? body.email : "").toLowerCase().trim();
  const password = typeof body.password === "string" ? body.password : "";
  const totpToken = typeof body.totpToken === "string" ? body.totpToken.trim() : "";

  const chiaveEmail = (e: string) => `login:email:${e}`;
  const emailRateLimitKey = email ? chiaveEmail(email) : null;

  // Rate limit per IP (LIMITE_TENTATIVI_IP tentativi, poi escalation)
  const ipRl = checkRateLimit(ipRateLimitKey, LIMITE_TENTATIVI_IP);
  if (!ipRl.allowed) {
    const minuti = Math.ceil(ipRl.retryAfterSeconds / 60);
    // Messaggio chiaro e univoco per l'utente finale: indica il motivo
    // (troppi tentativi falliti dallo stesso IP), il numero del blocco
    // corrente e il tempo di attesa. La dicitura "account" è evitata
    // volutamente: il blocco è per-IP, non per-account.
    const msg =
      ipRl.blockCount >= 3
        ? `Accesso temporaneamente bloccato dal tuo indirizzo IP dopo ${ipRl.blockCount} serie di tentativi falliti. Riprova tra ${minuti} minuti.`
        : `Troppi tentativi di accesso falliti dal tuo indirizzo IP (blocco numero ${ipRl.blockCount}). Riprova tra ${minuti} minuti.`;
    return NextResponse.json(
      { error: msg },
      {
        status: 429,
        headers: {
          "Retry-After": String(ipRl.retryAfterSeconds),
        },
      },
    );
  }

  // Rate limit per email (3 tentativi di default, poi escalation). Previene brute force
  // su singolo account anche con IP rotante.
  let emailRl = null;
  if (emailRateLimitKey) {
    emailRl = checkRateLimit(emailRateLimitKey);
    if (!emailRl.allowed) {
      const minuti = Math.ceil(emailRl.retryAfterSeconds / 60);
      return NextResponse.json(
        {
          error: `Troppi tentativi di accesso per questa email. Riprova tra ${minuti} minuti.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(emailRl.retryAfterSeconds),
          },
        },
      );
    }
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email e password sono obbligatorie" }, { status: 400 });
  }

  try {
    const user = await db.user.findUnique({ where: { email } });
    // Timing side-channel mitigation: se l'utente non esiste, eseguiamo
    // comunque bcrypt.compare con un hash sentinella per uniformare i
    // tempi di risposta. Il risultato NON è mai usato in quel caso.
    if (!user || !user.attivo) {
      await verifyPassword(password, await getSentinelHash());
      return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
    }

    // 2FA TOTP: se l'utente ha un secret E lo ha verificato (totpVerifiedAt),
    // richiedi il codice TOTP. Il gate viene DOPO la verifica password (così
    // un attaccante senza password non può enumerare quali account hanno
    // 2FA attivo), ma PRIMA di creare la sessione. Se il token TOTP manca
    // o è invalido, rispondiamo 401 con un messaggio esplicito che chiede
    // all'utente di fornire il 2FA.
    //
    // NOTA: totpVerifiedAt è obbligatorio per richiedere il 2FA. Un utente
    // che ha avviato il setup (totpSecret valorizzato) ma non ha completato
    // la verifica (totpVerifiedAt null) NON viene bloccato dal 2FA: questo
    // previene il lockout accidentale se l'utente chiude la pagina prima
    // di scansionare il QR code.
    if (user.totpSecret && user.totpVerifiedAt) {
      if (!totpToken) {
        return NextResponse.json(
          { error: "Autenticazione a due fattori (2FA) richiesta. Inserisci il codice TOTP.", requiresTotp: true },
          { status: 401 },
        );
      }
      if (!/^\d{6}$/.test(totpToken)) {
        return NextResponse.json(
          { error: "Codice TOTP non valido (deve essere 6 cifre)", requiresTotp: true },
          { status: 401 },
        );
      }
      // Verifica TOTP con delta: il delta è necessario per calcolare
      // il timestep esatto usato dalla verifica, da registrare come
      // "ultimo timestep usato" per implementare la protezione
      // anti-replay (RFC 6238 §5.2: il server deve rifiutare tentativi
      // di riusare lo stesso codice TOTP).
      const istanteVerifica = new Date();
      const totpResult = verifyTotpWithDelta(totpToken, user.totpSecret, istanteVerifica.getTime());
      if (!totpResult.valid) {
        return NextResponse.json({ error: "Codice TOTP non valido", requiresTotp: true }, { status: 401 });
      }
      // Protezione anti-replay atomica: il timestep viene registrato solo se
      // non è già stato usato. Un codice riusato, anche in richieste
      // concorrenti, viene rifiutato. Se la registrazione fallisce il login
      // è negato (fail-closed).
      const usedTimestep = computeTotpTimestep(istanteVerifica, totpResult.delta);
      const registrato = await registraTimestepTotp(user.id, usedTimestep, user.totpSecret);
      if (!registrato) {
        logger.warn({ userId: user.id }, "[login] Tentativo di riuso codice TOTP rifiutato (anti-replay)");
        return NextResponse.json(
          {
            error: "Codice TOTP già usato o fattore modificato. Attendi un nuovo codice dall'app authenticator.",
            requiresTotp: true,
          },
          { status: 401 },
        );
      }
    }

    // Login riuscito: resetta entrambi i rate limit
    resetRateLimit(ipRateLimitKey);
    // Al successo email è sempre valorizzata (vedi controllo obbligatorietà sopra).
    resetRateLimit(chiaveEmail(email));

    const token = await createSession(user.id, {
      passwordHash: user.passwordHash,
      totpSecret: user.totpSecret,
      totpVerifiedAt: user.totpVerifiedAt,
    });
    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        nomeCognome: user.nomeCognome,
        ruolo: user.ruolo,
      },
    });
    res.headers.set("Set-Cookie", setSessionCookie(token));
    return res;
  } catch (e) {
    if (e instanceof CredenzialiCambiate) {
      return NextResponse.json(
        { error: "Credenziali non valide: sono cambiate durante l'accesso. Ripeti il login." },
        { status: 401 },
      );
    }
    logger.error({ err: e }, "Errore login");
    return NextResponse.json({ error: "Errore interno del server" }, { status: 500 });
  }
}
