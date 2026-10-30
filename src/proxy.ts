/**
 * Proxy di sicurezza globale (convenzione proxy.ts di Next.js 16).
 *
 * Imposta header di sicurezza su tutte le risposte:
 * - Content-Security-Policy: blocca script inline, frame esterni, ecc.
 * - Strict-Transport-Security: HSTS senza preload
 * - X-Frame-Options: DENY (clickjacking)
 * - X-Content-Type-Options: nosniff
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy: disabilita camera e microfono, geolocalizzazione solo per l'origine
 *
 * Verifica inoltre l'header Origin/Referer sui metodi state-changing
 * (POST, PUT, DELETE, PATCH) come difesa anti-CSRF oltre al cookie
 * SameSite=Strict.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const isProduction = process.env.NODE_ENV === "production";

// Avviso una sola volta per processo se NEXT_PUBLIC_BASE_URL manca in produzione.
let csrfWarningEmitted = false;

/**
 * Politica CSP in produzione. Con `nonce` ogni script inline autorizzato
 * porta l'attributo nonce della richiesta: Next.js applica il nonce ricevuto
 * nell'header di richiesta ai propri script di bootstrap. Senza nonce (risposte
 * JSON di blocco) la politica resta strict e non consente script inline.
 */
function cspProduzione(nonce: string | null): string {
  const scriptSrc = nonce ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` : "script-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

// In sviluppo Next.js usa script inline per HMR: la politica consente unsafe-inline.
const CSP_SVILUPPO = [
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
].join("; ");

/** Nonce crittograficamente casuale, una volta per richiesta (16 byte in base64). */
function generaNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const SECURITY_HEADERS: Record<string, string> = {
  // Risposte dinamiche e API possono contenere dati personali e nonce CSP.
  "Cache-Control": "private, no-store",
  // HSTS: max-age di 2 anni con includeSubDomains. Il flag `preload` non è
  // incluso: richiede la registrazione in hstspreload.org e rende il dominio
  // permanentemente HTTPS-only.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  // Isolamento cross-origin: la finestra non è accessibile da pagine di altre origini
  // e le risorse non possono essere caricate da origini diverse.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // Nessuna policy cross-domain per Adobe Flash/PDF: blocca i file di policy esterni.
  "X-Permitted-Cross-Domain-Policies": "none",
};

const STATE_CHANGING_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

/**
 * Origine attesa per le richieste mutative, ricavata da NEXT_PUBLIC_BASE_URL.
 * Il browser invia nell'header Origin solo schema, host e porta: un eventuale
 * percorso in NEXT_PUBLIC_BASE_URL va quindi scartato con new URL().origin.
 *
 * In produzione NEXT_PUBLIC_BASE_URL è obbligatoria (vedi SETUP.md, sezione 7).
 * Se manca o non è valida, la stringa restituita è vuota e il chiamante blocca
 * le richieste mutative (fail-closed).
 */
function getExpectedOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      logger.error(
        { valore: raw },
        "NEXT_PUBLIC_BASE_URL non è un URL valido: richieste mutative bloccate in produzione",
      );
      return "";
    }
  }
  if (isProduction && !csrfWarningEmitted) {
    csrfWarningEmitted = true;
    logger.error(
      "NEXT_PUBLIC_BASE_URL non impostata in produzione: bloccate tutte le richieste mutative. " +
        "Impostare questa variabile prima di andare in produzione (vedi SETUP.md, sezione 7).",
    );
  }
  return "";
}

// Host accettati come origine valida in sviluppo (HMR e test locali).
// In produzione non si applicano: un attacker con codice su localhost
// potrebbe altrimenti aggirare il controllo Origin.
const DEV_HOSTS = ["localhost:3000", "127.0.0.1:3000"];

/**
 * Verifica se un valore di header Origin/Referer è accettabile come origine
 * della richiesta. Funzione pura, esportata per i test dei casi limite.
 *
 * Un valore è accettato se è un URL assoluto con schema (i browser inviano
 * sempre lo schema) e corrisponde all'origine attesa, oppure, solo in
 * sviluppo, se il suo host è uno dei DEV_HOSTS. Un valore non parsabile o
 * senza schema (es. "localhost:3000") è sempre rifiutato.
 */
export function isOriginAllowed(val: string | null, expected: string, isProd: boolean): boolean {
  if (!val) return false;
  let origin: string;
  let host: string;
  try {
    const u = new URL(val);
    origin = u.origin;
    host = u.host;
  } catch {
    return false;
  }
  if (expected && origin === expected) return true;
  // Match esatto sull'host (non includes): "https://evil.com/?localhost:3000"
  // non deve superare il controllo.
  return !isProd && DEV_HOSTS.includes(host);
}

function bloccata(messaggio: string, status: number): NextResponse {
  return new NextResponse(JSON.stringify({ error: messaggio }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      "Content-Security-Policy": isProduction ? cspProduzione(null) : CSP_SVILUPPO,
    },
  });
}

export function proxy(req: NextRequest): NextResponse {
  // Nonce per richiesta: in produzione viene passato a Next.js nell'header di
  // richiesta (insieme alla CSP) così che i suoi script di bootstrap siano consentiti.
  const nonce = isProduction ? generaNonce() : null;
  const csp = nonce ? cspProduzione(nonce) : CSP_SVILUPPO;
  const requestHeaders = new Headers(req.headers);
  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  res.headers.set("Content-Security-Policy", csp);

  // Anti-CSRF: verifica Origin/Referer sui metodi state-changing.
  // In produzione senza NEXT_PUBLIC_BASE_URL il controllo è fail-closed.
  if (STATE_CHANGING_METHODS.includes(req.method)) {
    const expected = getExpectedOrigin();
    if (expected) {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      // I browser moderni inviano Origin sulle richieste cross-site.
      if (!origin && !referer) {
        return bloccata("Richiesta non autorizzata: header Origin mancante", 403);
      }
      if (origin && !isOriginAllowed(origin, expected, isProduction)) {
        return bloccata("Richiesta non autorizzata: origine non valida", 403);
      }
      if (referer && !isOriginAllowed(referer, expected, isProduction)) {
        return bloccata("Richiesta non autorizzata: referer non valido", 403);
      }
    } else if (isProduction) {
      return bloccata(
        "Configurazione server incompleta: NEXT_PUBLIC_BASE_URL mancante o non valida. Contattare l'amministratore.",
        503,
      );
    }
  }

  return res;
}

export const config = {
  // Tutte le route tranne asset statici e file pubblici.
  matcher: [
    // Esclusione per file o directory esatti: il confine ('/' o fine percorso) impedisce
    // che un prefisso come /sw.json o /robots.txt.bak salti il proxy.
    "/((?!(?:_next/static|_next/image|sw\\.js|sw-register\\.js|manifest\\.json|robots\\.txt|\\.well-known)(?:/|$)).*)",
  ],
};
