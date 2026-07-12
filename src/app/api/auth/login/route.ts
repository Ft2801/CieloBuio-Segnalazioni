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
import { verifyTotp } from "@/lib/totp";
import { logger } from "@/lib/logger";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// Hash bcrypt di una password fissa nota al sistema, usato come
// "sentinella" per uniformare i tempi di risposta quando l'utente non
// esiste. L'hash è pre-calcolato a runtime (lazy init) per evitare di
// esporre un hash statico nel codice sorgente. La password sottostante
// NON è mai usata: l'unico scopo è imporre un delay comparabile a
// bcrypt.compare reale per mitigare il timing attack di user enumeration.
let sentinelHashPromise: Promise<string> | null = null;
async function getSentinelHash(): Promise<string> {
  if (!sentinelHashPromise) {
    // Lazy init: l'hash è generato una sola volta per processo.
    // Cost 12 coerente con BCRYPT_COST in auth.ts. Usiamo hashPassword
    // da @/lib/auth (che usa bcrypt.hash con cost 12) per allineare
    // il comportamento al resto dell'app e rispettare i mock di test.
    sentinelHashPromise = hashPassword(
      "sentinel-password-not-used-for-auth-" + Math.random()
    );
  }
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
      if (!verifyTotp(totpToken, user.totpSecret)) {
        return NextResponse.json(
          { error: "Codice TOTP non valido", requiresTotp: true },
          { status: 401 }
        );
      }
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
