/**
 * Middleware di sicurezza globale.
 *
 * Imposta header di sicurezza su tutte le risposte:
 * - Content-Security-Policy: blocca inline script, frame esterni, ecc.
 * - Strict-Transport-Security: HSTS con preload
 * - X-Frame-Options: DENY (clickjacking)
 * - X-Content-Type-Options: nosniff
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy: disabilita camera/mic/geolocation eccetto dove serve
 *
 * Verifica inoltre l'header Origin/Referer sui metodi state-changing
 * (POST, PUT, DELETE, PATCH) come difesa anti-CSRF aggiuntiva oltre al
 * cookie SameSite=Strict.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

// Warning one-shot per NEXT_PUBLIC_BASE_URL mancante in produzione:
// emesso una sola volta a livello di modulo per evitare flood di log.
let csrfWarningEmitted = false;

const SECURITY_HEADERS: Record<string, string> = {
  // In dev mode Next.js usa script inline per HMR; in produzione CSP strict
  "Content-Security-Policy": isProduction
    ? [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
      ].join("; "),
  // HSTS: max-age 2 anni con includeSubDomains. Non include `preload`
  // perché richiede la registrazione esplicita nell'HSTS preload list di
  // Chromium (hstspreload.org) e rende il dominio permanentemente
  // HTTPS-only. Si può aggiungere `preload` solo dopo essersi registrati
  // e dopo aver valutato le implicazioni.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
};

const STATE_CHANGING_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

function getExpectedOrigin(): string {
  // In produzione, NEXT_PUBLIC_BASE_URL definisce l'origine attesa ed è
  // OBBLIGATORIA (vedi SETUP.md sezione 7.1). Se mancante, ritorniamo ""
  // ma in produzione emettiamo un warning one-shot: il check CSRF salta,
  // il che è un rischio di sicurezza. In sviluppo, l'assenza è normale
  // (si usa localhost senza configurazione esplicita).
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  if (isProduction) {
    // Fail-closed: in produzione senza NEXT_PUBLIC_BASE_URL, blocca tutte
    // le richieste mutative. Il warning one-shot è per i log, ma il
    // comportamento è bloccare invece di permettere CSRF.
    if (!csrfWarningEmitted) {
      csrfWarningEmitted = true;
      console.error(
        "[SECURITY] NEXT_PUBLIC_BASE_URL non impostata in produzione: bloccate tutte le richieste mutative. " +
        "Impostare questa variabile è obbligatorio prima di andare in produzione (vedi SETUP.md sezione 7.1). " +
        "Questo messaggio viene emesso una sola volta per processo."
      );
    }
  }
  return "";
}

// Host accettati come origine valida in sviluppo (per HMR e test locali).
// In produzione sono bloccati: un attacker con codice in localhost potrebbe
// altrimenti bypassare il check Origin.
const DEV_HOSTS = ["localhost:3000", "127.0.0.1:3000"];

/**
 * Verifica se un valore di header Origin/Referer è accettabile come
 * origine della richiesta. Funzione pura esportata per consentirne il
 * test diretto con casi limite (valore nullo, URL malformato, ecc.),
 * che non sono raggiungibili tramite il middleware (il chiamante fa
 * già short-circuit su `origin && ...` prima di invocare la funzione).
 */
export function isOriginAllowed(val: string | null, expected: string, isProd: boolean): boolean {
  if (!val) return false;
  try {
    const u = new URL(val);
    if (u.origin === expected) return true;
    if (!isProd && (u.host === "localhost:3000" || u.host === "127.0.0.1:3000")) return true;
    return false;
  } catch {
    // URL malformato: fallback a match stringa (solo per expected, mai per localhost in prod)
    return val === expected || (!isProd && DEV_HOSTS.some((o) => val.includes(o)));
  }
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Applica header di sicurezza a tutte le risposte
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }

  // Anti-CSRF: verifica Origin/Referer sui metodi state-changing.
  // In produzione senza NEXT_PUBLIC_BASE_URL: fail-closed (blocca tutto).
  if (STATE_CHANGING_METHODS.includes(req.method)) {
    const expected = getExpectedOrigin();
    if (expected) {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      const isAllowed = (val: string | null) => isOriginAllowed(val, expected, isProduction);
      // Se entrambi assenti, blocchiamo (i browser moderni inviano Origin su POST cross-site)
      if (!origin && !referer) {
        return new NextResponse(
          JSON.stringify({ error: "Richiesta non autorizzata: header Origin mancante" }),
          { status: 403, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } }
        );
      }
      if (origin && !isAllowed(origin)) {
        return new NextResponse(
          JSON.stringify({ error: "Richiesta non autorizzata: origine non valida" }),
          { status: 403, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } }
        );
      }
      if (referer && !isAllowed(referer)) {
        return new NextResponse(
          JSON.stringify({ error: "Richiesta non autorizzata: referer non valido" }),
          { status: 403, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } }
        );
      }
    } else if (isProduction) {
      // Fail-closed: NEXT_PUBLIC_BASE_URL mancante in produzione → blocca
      return new NextResponse(
        JSON.stringify({ error: "Configurazione server incompleta: NEXT_PUBLIC_BASE_URL non impostata. Contattare l'amministratore." }),
        { status: 503, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } }
      );
    }
  }

  return res;
}

export const config = {
  // Applica a tutte le route eccetto asset statici e file pubblici
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|sw-register.js|manifest.json|icon-.*\\.png|logo.svg|robots.txt).*)",
  ],
};
