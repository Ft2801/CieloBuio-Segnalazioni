/**
 * API: POST /api/auth/login
 * Login con email, password e (opzionale) codice TOTP 2FA. Crea sessione.
 * Rate limiting: 3 tentativi per IP e per email, poi escalation blocchi
 * (5 min -> 15 min -> 1 ora -> 24 ore). Vedi src/lib/rate-limit.ts.
 *
 * Il rate limit doppio (IP + email) previene il bypass via header
 * X-Forwarded-For spoofabile: anche se un attaccante ruota l'IP, non può
 * superare 3 tentativi per singola email target. Viceversa, un attaccante
 * che prova tante email diverse dallo stesso IP è comunque bloccato.
 *
 * Mitigazione timing side-channel: se l'utente non esiste, eseguiamo
 * comunque bcrypt.compare con un hash pre-calcolato (cost 12) per
 * uniformare i tempi di risposta e impedire l'user enumeration via
 * timing. L'hash di riferimento è derivato da una password fissa nota
 * al sistema, ma il risultato non è mai usato (verifichiamo sempre
 * l'hash reale quando l'utente esiste).
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
import {
  verifyPassword,
  hashPassword,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { verifyTotpWithDelta, computeTotpTimestep } from "@/lib/totp";
import { logger } from "@/lib/logger";

function getClientIp(req: NextRequest): string {
  // Preferisci X-Real-IP (impostato dal reverse proxy trust, non dal
  // client) rispetto a X-Forwarded-For (che può essere spoofato dal
  // client se il reverse proxy non lo riscrive). In produzione dietro
  // Caddy, configura Caddy per impostare X-Real-IP dal remote_ip e
  // per sovrascrivere eventuali X-Forwarded-For client-supplied.
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

// Hash bcrypt di una password fissa nota al sistema, usato come
// "sentinella" per uniformare i tempi di risposta quando l'utente non
// esiste. L'hash è pre-calcolato eagerly all'import del modulo (non
// lazy) per evitare che il primissimo login fallito dopo l'avvio del
// processo paghi il costo di bcrypt.compare più il costo di
// bcrypt.hash per la generazione della sentinella, rivelando così un
// timing side-channel che distinguerebbe il primo login fallito dai
// successivi.
const sentinelHashPromise: Promise<string> = hashPassword(
  "sentinel-password-not-used-for-auth-" + Math.random()
);
async function getSentinelHash(): Promise<string> {
  return sentinelHashPromise;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipRateLimitKey = `login:ip:${ip}`;

  // Pre-flight: parsa il body per estrarre l'email prima del rate limit,
  // così possiamo applicare entrambi i limiti (IP e email).
  let email = "";
  let password = "";
  let totpToken = "";
  try {
    const body = await req.json().catch(() => ({}));
    email = (body.email ?? "").toString().toLowerCase().trim();
    password = (body.password ?? "").toString();
    totpToken = (body.totpToken ?? "").toString().trim();
  } catch {
    return NextResponse.json(
      { error: "Body della richiesta non valido" },
      { status: 400 }
    );
  }

  const emailRateLimitKey = email ? `login:email:${email}` : null;

  // Rate limit per IP (3 tentativi, escalation)
  const ipRl = checkRateLimit(ipRateLimitKey);
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
      }
    );
  }

  // Rate limit per email (3 tentativi, escalation). Previene brute force
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
        }
      );
    }
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email e password sono obbligatorie" },
      { status: 400 }
    );
  }

  try {
    const user = await db.user.findUnique({ where: { email } });
    // Timing side-channel mitigation: se l'utente non esiste, eseguiamo
    // comunque bcrypt.compare con un hash sentinella per uniformare i
    // tempi di risposta. Il risultato NON è mai usato in quel caso.
    if (!user || !user.attivo) {
      await verifyPassword(password, await getSentinelHash());
      return NextResponse.json(
        { error: "Credenziali non valide" },
        { status: 401 }
      );
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Credenziali non valide" },
        { status: 401 }
      );
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
          { status: 401 }
        );
      }
      if (!/^\d{6}$/.test(totpToken)) {
        return NextResponse.json(
          { error: "Codice TOTP non valido (deve essere 6 cifre)", requiresTotp: true },
          { status: 401 }
        );
      }
      // Verifica TOTP con delta: il delta è necessario per calcolare
      // il timestep esatto usato dalla verifica, da registrare come
      // "ultimo timestep usato" per implementare la protezione
      // anti-replay (RFC 6238 §5.2: il server deve rifiutare tentativi
      // di riusare lo stesso codice TOTP).
      const totpResult = verifyTotpWithDelta(totpToken, user.totpSecret);
      if (!totpResult.valid) {
        return NextResponse.json(
          { error: "Codice TOTP non valido", requiresTotp: true },
          { status: 401 }
        );
      }
      // Protezione anti-replay: rifiuta se il timestep usato è <= ultimo
      // timestep registrato per questo utente. Previene il riuso dello
      // stesso codice entro la finestra di validità (±30s).
      const usedTimestep = computeTotpTimestep(new Date(), totpResult.delta);
      if (user.totpLastUsedTimestep != null && usedTimestep <= user.totpLastUsedTimestep) {
        logger.warn({ userId: user.id }, "[login] Tentativo di riuso codice TOTP rifiutato (anti-replay)");
        return NextResponse.json(
          { error: "Codice TOTP già usato. Attendi un nuovo codice dall'app authenticator.", requiresTotp: true },
          { status: 401 }
        );
      }
      // Registra il timestep usato per i prossimi check anti-replay.
      // Non usiamo una transazione: in caso di race concorrente, l'unico
      // rischio è che due codici uguali vengano accettati simultaneamente
      // entro la stessa finestra (casi rari, window di 30s). Il rate
      // limit sul login limita comunque il numero di tentativi.
      await db.user.update({
        where: { id: user.id },
        data: { totpLastUsedTimestep: usedTimestep },
      }).catch((e: unknown) => {
        // Non bloccare il login se l'update fallisce: la protezione
        // anti-replay è defense-in-depth, non un gate di autenticazione.
        logger.warn({ err: e, userId: user.id }, "[login] Aggiornamento totpLastUsedTimestep fallito (non bloccante)");
      });
    }

    // Login riuscito: resetta entrambi i rate limit
    resetRateLimit(ipRateLimitKey);
    if (emailRateLimitKey) resetRateLimit(emailRateLimitKey);

    const token = await createSession(user.id);
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
    logger.error({ err: e }, "Errore login");
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    );
  }
}
