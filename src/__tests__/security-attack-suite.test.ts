/**
 * Suite di test di sicurezza informatica per CieloBuio Segnalazioni.
 *
 * Questa suite esegue test di penetrazione simulati contro tutti i vettori
 * di attacco principali, verificando che le difese implementate siano
 * efficaci. I test sono organizzati per categoria di attacco OWASP Top 10.
 *
 * Ogni test importa il modulo sotto test e ne verifica il comportamento,
 * oppure legge il sorgente e verifica la presenza del pattern di sicurezza
 * richiesto (ispezione del codice, non dei commenti). Le ispezioni del
 * sorgente non sostituiscono i test di comportamento presenti nelle suite
 * di integrazione delle route (src/app/api/__tests__/).
 *
 * Categorie coperte:
 * A01: Broken Access Control (IDOR, privilege escalation, bypass autorizzazione)
 * A02: Cryptographic Failures (password hashing, session token, cookie security)
 * A03: Injection (SQL injection, email header injection, CSV formula injection)
 * A04: Insecure Design (race condition, business logic bypass)
 * A05: Security Misconfiguration (CSP, HSTS, X-Powered-By, firewall)
 * A07: Authentication Failures (brute force, rate limit bypass, session fixation)
 * A08: Software/Data Integrity (path traversal, file upload spoofing)
 * A09: Logging/Monitoring Failures (audit trail, log injection)
 * A10: SSRF (Server-Side Request Forgery)
 * XSS: Cross-Site Scripting
 * DEMO: Demo Mode bypass prevention
 * GDPR: Anonimizzazione automatica
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import {
  canViewSegnalazione,
  getVisibilityFilter,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  getSessionCookieName,
} from "@/lib/auth";
import {
  emailSchema,
  strongPasswordSchema,
  segnalazionePecSchema,
  validaPecCcAggiuntive,
  nuovoUtenteSchema,
} from "@/lib/validation";
import { checkRateLimit, getBlockDuration, __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { generaHtmlLettera } from "@/lib/lettera";
import { guardDemoReadOnly, DEMO_READONLY_MESSAGE, isDemoSession } from "@/lib/demo-mode";
import {
  isValidCuid,
  isSafePathSegment,
  parseUrlStorageSicuro,
  risolviPathAllegatoSicuro,
  UPLOADS_ROOT,
} from "@/lib/path-guard";
import { generateTotpSecret, generateTotpUri, verifyTotp } from "@/lib/totp";
import { MAX_ALLEGATI_PER_SEGNALAZIONE, MAX_ALLEGATO_BYTE } from "@/lib/types";
import { getRetentionAnni } from "@/lib/cron-utils";
import { TOTP, Secret } from "otpauth";

// ============================================================
// Helper: lettura file sorgente per ispezione pattern di sicurezza
// ============================================================
// __dirname in vitest è la directory del file di test corrente
// (es. /project/src/__tests__/), quindi `../..` è la root del progetto.
const PROJECT_ROOT = path.resolve(__dirname, "../..");
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf-8");
}

// ============================================================
// A01: Broken Access Control
// ============================================================

describe("[A01] Broken Access Control - IDOR Prevention", () => {
  const volontario = {
    id: "vol-1",
    email: "v@t.it",
    nomeCognome: "V",
    ruolo: "volontario" as const,
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: null,
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
  };
  const refSenzaTerritorio = {
    id: "ref-1",
    email: "r@t.it",
    nomeCognome: "R",
    ruolo: "referente_provinciale" as const,
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: null,
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
  };
  const admin = {
    id: "adm-1",
    email: "a@t.it",
    nomeCognome: "A",
    ruolo: "admin" as const,
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: null,
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
  };

  it("volontario non può vedere segnalazioni di altri", () => {
    expect(canViewSegnalazione(volontario, { volontarioId: "vol-2", provinciaId: 1, regioneId: 1 })).toBe(false);
  });

  it("volontario può vedere le proprie segnalazioni", () => {
    expect(canViewSegnalazione(volontario, { volontarioId: "vol-1", provinciaId: 1, regioneId: 1 })).toBe(true);
  });

  it("referente senza territorio è fail-closed (non vede nulla)", () => {
    expect(canViewSegnalazione(refSenzaTerritorio, { volontarioId: "vol-1", provinciaId: 5, regioneId: 1 })).toBe(
      false,
    );
  });

  it("admin ha accesso totale", () => {
    expect(canViewSegnalazione(admin, { volontarioId: "any", provinciaId: 99, regioneId: 99 })).toBe(true);
  });

  it("getVisibilityFilter ritorna sentinella __NEVER_MATCH__ per referenti senza territorio", () => {
    const filter = getVisibilityFilter(refSenzaTerritorio);
    expect(filter).toEqual({ id: "__NEVER_MATCH__" });
  });
});

// ============================================================
// A02: Cryptographic Failures
// ============================================================

describe("[A02] Cryptographic Failures - Password e Sessioni", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hashPassword usa bcrypt con cost 12", async () => {
    const hash = await hashPassword("TestPassword1!");
    expect(hash).toMatch(/^\$2[ab]\$/);
    const cost = parseInt(hash.substring(4, 6), 10);
    expect(cost).toBe(12);
  });

  it("verifyPassword rifiuta hash errati", async () => {
    const result = await verifyPassword("password", "$2a$12$invalidhash");
    expect(result).toBe(false);
  });

  it("cookie di sessione usa __Host- prefix in produzione", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = setSessionCookie("test-token");
    expect(cookie).toContain("__Host-cb_session=test-token");
    expect(getSessionCookieName()).toBe("__Host-cb_session");
    vi.unstubAllEnvs();
  });

  it("cookie ha flag HttpOnly, SameSite=Strict, Secure in produzione", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = setSessionCookie("tok");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    vi.unstubAllEnvs();
  });
});

// ============================================================
// A03: Injection
// ============================================================

describe("[A03a] SQL Injection - Prisma parametrizza tutte le query", () => {
  it("zod validazione rifiuta SQL injection in email", () => {
    expect(emailSchema.safeParse("'; DROP TABLE users; --").success).toBe(false);
    expect(emailSchema.safeParse("admin@t.it' OR '1'='1").success).toBe(false);
  });

  it("zod validazione rifiuta SQL injection in password corta", () => {
    // "'; DROP--" è troppo corta (min 12) e senza maiuscole/cifre/speciali richieste
    expect(strongPasswordSchema.safeParse("'; DROP TABLE users; --").success).toBe(false);
  });

  it("SQL dinamico consentito solo per le tre sequenze note del ripristino", () => {
    // Le tabelle SERIAL vanno riallineate transazionalmente con ALTER SEQUENCE.
    // La sola query dinamica usa identificativi scelti da una lista statica,
    // mai valori della richiesta o dati del backup.
    const dirs = ["src/app/api", "src/lib", "scripts"];
    const sorgentiDinamiche: string[] = [];
    for (const dir of dirs) {
      const absDir = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(absDir)) continue;
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
            const content = fs.readFileSync(full, "utf-8");
            if (content.includes("$queryRawUnsafe") && !full.includes("__tests__")) {
              sorgentiDinamiche.push(path.relative(PROJECT_ROOT, full));
            }
          }
        }
      };
      walk(absDir);
    }
    expect(sorgentiDinamiche).toEqual(["src/lib/backup.ts"]);
    expect(readSrc("src/lib/backup.ts")).toContain('for (const tabella of ["regioni_leggi", "province", "comuni"])');
  });
});

describe("[A03b] Email Header Injection - CRLF Injection Prevention", () => {
  it("segnalazionePecSchema blocca CRLF negli header", () => {
    const attack = {
      oggettoPec: "Test\r\nBcc: evil@hacker.it",
      destinatarioNome: "Sindaco\r\nX-Header: injected",
    };
    expect(segnalazionePecSchema.safeParse(attack).success).toBe(false);
  });

  it("validaPecCcAggiuntive blocca email con CRLF", () => {
    expect(validaPecCcAggiuntive("a@b.it\r\nBcc: evil@hacker.it").ok).toBe(false);
  });

  it("validaPecCcAggiuntive blocca formato non email", () => {
    expect(validaPecCcAggiuntive("not-an-email").ok).toBe(false);
  });

  it("validaPecCcAggiuntive blocca più di 5 CC", () => {
    expect(validaPecCcAggiuntive("a@b.it; c@d.it; e@f.it; g@h.it; i@l.it; m@n.it").ok).toBe(false);
  });

  it("nuovoUtenteSchema blocca CRLF nel nome", () => {
    const attack = {
      email: "test@test.it",
      nomeCognome: "Mario\r\nX-Injected: header",
      password: "Password123!",
    };
    expect(nuovoUtenteSchema.safeParse(attack).success).toBe(false);
  });
});

describe("[A03c] CSV Formula Injection", () => {
  it("il pattern di csvEscape riconosce e prefissa le formule pericolose (ispezione sorgente + pattern)", () => {
    const src = readSrc("src/app/api/segnalazioni/export/route.ts");
    // csvEscape non è esportata: si verifica il pattern letterale usato dal codice.
    expect(src).toContain("/^[\\s=+\\-@]/.test(s)");
    const pattern = /^[\s=+\-@]/;
    const formulaAttacks = [
      '=HYPERLINK("http://evil.com","Click")',
      "=cmd|'/c calc'!A1",
      "+1+1",
      "-1+1",
      "@SUM(A1:A2)",
    ];
    for (const attack of formulaAttacks) {
      expect(pattern.test(attack)).toBe(true);
    }
  });

  it("export route antepone l'apostrofo alla cella e raddoppia le virgolette (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/segnalazioni/export/route.ts");
    expect(src).toContain("s = `'${s}`");
    expect(src).toContain('s.replace(/"/g, \'""\')');
  });
});

// ============================================================
// A04: Insecure Design - Race Conditions e Business Logic
// ============================================================

describe("[A04a] Race Condition - Update atomiche", () => {
  it("generaNumeroProtocollo gestisce collisioni P2002 con retry (ispezione sorgente)", () => {
    const src = readSrc("src/lib/protocollo.ts");
    // Verifica REALE: il codice deve contenere un catch su P2002
    // (Prisma unique constraint violation) con retry
    expect(src).toContain("P2002");
    expect(src).toMatch(/retry|attempt|for\s*\(/i);
  });

  it("updateMany con clausola WHERE su stato per atomicità (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/segnalazioni/[id]/invia-pec/route.ts");
    // Verifica REALE: updateMany con where su stato per race condition
    expect(src).toContain("updateMany");
    expect(src).toMatch(/where:\s*\{[^}]*stato/);
  });
});

describe("[A04b] Business Logic - Protezione pacchetto probatorio", () => {
  it("volontario non può eliminare allegati in stato in_revisione (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/allegati/route.ts");
    // Verifica REALE: isOwnerInBozza limita a stato bozza
    expect(src).toContain("isOwnerInBozza");
    expect(src).toMatch(/stato\s*===\s*"bozza"/);
  });

  it("volontario non può modificare segnalazioni in stato in_revisione (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/segnalazioni/[id]/route.ts");
    // Verifica REALE: il proprietario che non è revisore competente non può
    // modificare fuori da stato "bozza" (ritorna 400)
    expect(src).toMatch(/isOwner\s*&&\s*!isReviewerForThis\s*&&\s*segnalazione\.stato\s*!==\s*"bozza"/);
    expect(src).toContain("400");
  });

  it("upload allegati bloccato dopo stati finali (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    // Verifica REALE: STATI_BLOCCATI include tutti gli stati terminali
    expect(src).toContain("STATI_BLOCCATI");
    expect(src).toContain('"approvata"');
    expect(src).toContain('"inviata"');
    expect(src).toContain('"in_attesa"');
    expect(src).toContain('"chiusa_positiva"');
    expect(src).toContain('"chiusa_negativa"');
  });

  it("volontario può caricare allegati solo in stato bozza (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    // Un volontario non può caricare fuori dalla bozza, né prima né dopo il lock.
    expect(src).toMatch(/user\.ruolo === "volontario"\s*&&\s*segnalazione\.stato\s*!==\s*"bozza"/);
    expect(src).toMatch(/user\.ruolo === "volontario"\s*&&\s*corrente\.stato\s*!==\s*"bozza"/);
  });
});

// ============================================================
// A05: Security Misconfiguration
// ============================================================

describe("[A05a] Security Headers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("CSP strict in produzione (no unsafe-eval per script)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("https://example.com/api/test", { method: "GET" });
    const res = await proxy(req);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    vi.unstubAllEnvs();
  });

  it("HSTS con includeSubDomains", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("https://example.com/"));
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(res.headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
    vi.unstubAllEnvs();
  });

  it("X-Frame-Options DENY", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("https://example.com/"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    vi.unstubAllEnvs();
  });

  it("X-Content-Type-Options nosniff", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("https://example.com/"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    vi.unstubAllEnvs();
  });

  it("poweredByHeader disabilitato in next.config.ts (ispezione sorgente)", () => {
    const src = readSrc("next.config.ts");
    expect(src).toContain("poweredByHeader");
    expect(src).toMatch(/poweredByHeader:\s*false/);
  });
});

describe("[A05b] CSRF - Verifica Origin/Referer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("POST senza Origin/Referer bloccato in produzione", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("https://example.com/api/test", { method: "POST" });
    const res = await proxy(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("POST con Origin malevolo bloccato", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://example.com");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("https://example.com/api/test", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("fail-closed senza NEXT_PUBLIC_BASE_URL in produzione (503)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("https://example.com/api/test", {
      method: "POST",
      headers: { origin: "https://example.com" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

// ============================================================
// A07: Authentication Failures
// ============================================================

describe("[A07a] Brute Force - Rate Limiting Escalation", () => {
  beforeEach(() => {
    __resetRateLimitStoreForTests();
  });

  afterEach(() => {
    __resetRateLimitStoreForTests();
  });

  it("checkRateLimit blocca dopo 3 tentativi falliti", () => {
    const key = `brute-force-test-${Date.now()}`;
    expect(checkRateLimit(key, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 3).allowed).toBe(true);
    const blocked = checkRateLimit(key, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockCount).toBe(1);
  });

  it("escalation blocchi: 5min → 15min → 1ora → 24ore", () => {
    expect(getBlockDuration(1)).toBe(5 * 60 * 1000);
    expect(getBlockDuration(2)).toBe(15 * 60 * 1000);
    expect(getBlockDuration(3)).toBe(60 * 60 * 1000);
    expect(getBlockDuration(4)).toBe(24 * 60 * 60 * 1000);
    expect(getBlockDuration(10)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("[A07b] Session Fixation - Session Rotation", () => {
  it("createSession usa transazione con deleteMany per invalidare sessioni precedenti (ispezione sorgente)", () => {
    const src = readSrc("src/lib/auth.ts");
    expect(src).toContain("createSession");
    // Verifica REALE: usa db.$transaction o deleteMany prima di create
    expect(src).toMatch(/\$transaction|deleteMany/);
  });

  it("cambio password/ruolo/attivo da admin invalida sessioni (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/config/users/[id]/route.ts");
    expect(src).toContain("sessione");
    expect(src).toMatch(/sessione\.deleteMany|deleteMany.*sessione/);
  });

  it("login usa rate limit doppio (IP + email) per prevenire bypass via X-Forwarded-For (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/auth/login/route.ts");
    expect(src).toContain("login:ip:");
    expect(src).toContain("login:email:");
  });

  it("login mitiga timing side-channel con hash sentinella per user enumeration (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/auth/login/route.ts");
    expect(src).toMatch(/sentinelHash|getSentinelHash|sentinel/i);
  });

  it("login richiede codice TOTP se l'utente ha 2FA attivo (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/auth/login/route.ts");
    expect(src).toContain("totpSecret");
    expect(src).toContain("verifyTotp");
    expect(src).toContain("requiresTotp");
  });
});

// ============================================================
// A08: Software/Data Integrity
// ============================================================

describe("[A08a] Path Traversal - Protezione multi-layer", () => {
  it("risolviPathAllegatoSicuro non produce un path per un traversal con ../", () => {
    // Verifica del modulo reale: il traversal non deve mai arrivare a un path su disco.
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "../../../etc/passwd")).toBeNull();
    expect(risolviPathAllegatoSicuro("../../../etc", "passwd")).toBeNull();
  });

  it("path traversal protection a 2 livelli (validazione segmenti + resolve normalizzato) in path-guard.ts", () => {
    // Verifica REALE del comportamento del modulo path-guard
    // 1. isValidCuid reject CUID non validi
    expect(isValidCuid("cabcdefghij1234567890")).toBe(true);
    expect(isValidCuid("../../etc/passwd")).toBe(false);
    expect(isValidCuid("")).toBe(false);

    // 2. isSafePathSegment reject `..`, `/`, `\`, `\0`
    expect(isSafePathSegment("file.jpg")).toBe(true);
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("a\\b")).toBe(false);
    expect(isSafePathSegment("a\0b")).toBe(false);

    // 3. risolviPathAllegatoSicuro reject path fuori uploadsRoot
    const safe = risolviPathAllegatoSicuro("cabcdefghij1234567890", "file.jpg");
    expect(safe).not.toBeNull();
    expect(safe?.startsWith(UPLOADS_ROOT + path.sep)).toBe(true);

    // 4. risolviPathAllegatoSicuro reject filename con path traversal
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "../../etc/passwd")).toBeNull();
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "/etc/passwd")).toBeNull();
  });

  it("parseUrlStorageSicuro accetta solo il formato attuale e rifiuta path traversal", () => {
    // Formato attuale valido
    expect(parseUrlStorageSicuro("cabcdefghij1234567890/file.jpg")).toEqual({
      segnalazioneId: "cabcdefghij1234567890",
      filename: "file.jpg",
    });
    // Formato con prefisso non previsto: rifiutato
    expect(parseUrlStorageSicuro("formato/non/valido/cabcdefghij1234567890/file.jpg")).toBeNull();
    // Path traversal: viene bloccato
    expect(parseUrlStorageSicuro("../etc/passwd")).toBeNull();
    expect(parseUrlStorageSicuro("segid/etc/passwd")).toBeNull(); // filename con /
  });

  it("filename sanitizzato con randomUUID in upload route (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    expect(src).toContain("randomUUID()");
    expect(src).toMatch(/fileName\s*=\s*`\$\{randomUUID\(\)\}/);
  });

  it("upload route valida segnalazioneId come CUID prima di usarlo (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    // Difesa in profondità: formato CUID verificato prima della lookup DB
    expect(src).toContain("isValidCuid");
    expect(src).toContain("isSafePathSegment");
  });

  it("tutte le route di allegati usano path-guard centralizzato (ispezione sorgente)", () => {
    // Verifica REALE: 6 route di allegati devono importare path-guard
    const routes = [
      "src/app/api/upload/route.ts",
      "src/app/api/allegati/[id]/download/route.ts",
      "src/app/api/allegati/[id]/preview/route.ts",
      "src/app/api/allegati/route.ts",
      "src/app/api/segnalazioni/[id]/lettera/route.ts",
      "src/app/api/segnalazioni/[id]/invia-pec/route.ts",
    ];
    for (const r of routes) {
      const src = readSrc(r);
      expect(src, `${r} deve importare path-guard`).toMatch(/path-guard/);
    }
  });
});

describe("[A08b] File Upload Spoofing - Magic Bytes", () => {
  it("verificaMagicBytes controlla FF D8 FF per JPEG (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    expect(src).toContain("verificaMagicBytes");
    expect(src).toContain("0xff");
    expect(src).toContain("0xd8");
  });

  it("verificaMagicBytes controlla RIFF + WEBP (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/upload/route.ts");
    // Verifica REALE: WebP richiede RIFF (0x52 0x49 0x46 0x46) e WEBP (0x57 0x45 0x42 0x50)
    expect(src).toContain("0x52"); // R
    expect(src).toContain("0x49"); // I
    expect(src).toContain("0x46"); // F
    expect(src).toContain("0x57"); // W
    expect(src).toContain("0x45"); // E
    expect(src).toContain("0x42"); // B
    expect(src).toContain("0x50"); // P
  });

  it("limite 4 allegati per segnalazione centralizzato in types.ts (ispezione + comportamento)", () => {
    const typesSrc = readSrc("src/lib/types.ts");
    expect(typesSrc).toContain("MAX_ALLEGATI_PER_SEGNALAZIONE");
    expect(typesSrc).toMatch(/MAX_ALLEGATI_PER_SEGNALAZIONE\s*=\s*4/);

    const uploadSrc = readSrc("src/app/api/upload/route.ts");
    expect(uploadSrc).toContain("MAX_ALLEGATI_PER_SEGNALAZIONE");

    // Comportamento: il valore importato è effettivamente 4
    expect(MAX_ALLEGATI_PER_SEGNALAZIONE).toBe(4);
  });

  it("size max 10 MB per file centralizzato in types.ts (ispezione + comportamento)", () => {
    const typesSrc = readSrc("src/lib/types.ts");
    expect(typesSrc).toContain("MAX_ALLEGATO_BYTE");
    expect(typesSrc).toMatch(/10\s*\*\s*1024\s*\*\s*1024/);

    expect(MAX_ALLEGATO_BYTE).toBe(10 * 1024 * 1024);
  });
});

// ============================================================
// A09: Logging/Monitoring
// ============================================================

describe("[A09] Audit Trail - Tracciabilità azioni", () => {
  it("ogni transizione di stato registrata in storico_stati (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/segnalazioni/[id]/cambia-stato/route.ts");
    expect(src).toContain("storicoStato.create");
    expect(src).toContain("statoPrecedente");
    expect(src).toContain("statoNuovo");
  });

  it("export CSV richiede autenticazione e applica filtro territoriale (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/segnalazioni/export/route.ts");
    // Verifica REALE: l'export richiede getSessionUser (auth) e applica
    // getVisibilityFilter (filtro territoriale) per esportare solo le
    // segnalazioni visibili all'utente.
    expect(src).toContain("getSessionUser");
    expect(src).toContain("getVisibilityFilter");
    expect(src).toContain("401");
  });

  it("eventi automatici del cron registrati con userId=null (ispezione sorgente)", () => {
    const src = readSrc("src/lib/cron-utils.ts");
    // Verifica REALE: transizioneAutomaticaInviata è chiamata con
    // userId=null dal cron (vedi cron-jobs.ts). La funzione passa
    // userId allo storicoStato.create, e quando null la nota contiene
    // il marker [CRON AUTOMATICO].
    expect(src).toContain("[CRON AUTOMATICO]");
    expect(src).toContain("userId");
    // Verifica che cron-jobs.ts chiami le funzioni con userId=null
    const cronSrc = readSrc("scripts/cron-jobs.ts");
    expect(cronSrc).toMatch(/cleanupSessioniScadute\s*\(\s*db\s*\)/);
    expect(cronSrc).toMatch(/transizioneAutomaticaInviata\s*\(\s*db,\s*null\s*\)/);
    expect(cronSrc).toMatch(/anonimizzaSegnalazioniGdpr\s*\(\s*db,\s*null\s*\)/);
  });

  it("logger Pino strutturato usato al posto di console.error nelle route API (ispezione sorgente)", () => {
    // Verifica REALE: le 8 route API principali devono usare logger, non console
    const routeFiles = [
      "src/app/api/auth/login/route.ts",
      "src/app/api/upload/route.ts",
      "src/app/api/segnalazioni/route.ts",
      "src/app/api/segnalazioni/[id]/route.ts",
      "src/app/api/segnalazioni/[id]/approva/route.ts",
      "src/app/api/segnalazioni/[id]/rifiuta/route.ts",
      "src/app/api/segnalazioni/[id]/lettera/route.ts",
      "src/app/api/segnalazioni/[id]/invia-pec/route.ts",
    ];
    for (const r of routeFiles) {
      const src = readSrc(r);
      expect(src, `${r} deve importare logger`).toContain('from "@/lib/logger"');
      // Nessun console.error diretto (è sostituito con logger.error)
      expect(src, `${r} non deve usare console.error`).not.toMatch(/console\.error/);
    }
  });
});

// ============================================================
// A10: SSRF
// ============================================================

describe("[A10] SSRF - Nessun endpoint fa richieste HTTP a URL user-controlled", () => {
  it("nessuna route o libreria server chiama fetch o http(s) (ispezione sorgente)", () => {
    // Il codice server non deve effettuare richieste HTTP: l'unica uscita di rete
    // è il transporter SMTP con host da configurazione. Le righe di commento sono escluse.
    const dirs = ["src/app/api", "src/lib"];
    const trovate: string[] = [];
    const pattern = /\bfetch\s*\(|\bhttps?\.(get|request)\s*\(/;
    for (const dir of dirs) {
      const absDir = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(absDir)) continue;
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            const righe = fs.readFileSync(full, "utf-8").split("\n");
            for (const riga of righe) {
              if (/^\s*(\*|\/\/)/.test(riga)) continue;
              if (pattern.test(riga)) trovate.push(full);
            }
          }
        }
      };
      walk(absDir);
    }
    expect(trovate).toEqual([]);
  });

  it("l'unico uso di fetch è verso nodemailer SMTP con host da env, non user input (ispezione sorgente)", () => {
    // Il transporter SMTP è creato in src/lib/smtp.ts con host da env
    // (PEC_SMTP_HOST), mai da dati della richiesta.
    const smtpSrc = readSrc("src/lib/smtp.ts");
    expect(smtpSrc).toContain("PEC_SMTP_HOST");
    expect(smtpSrc).not.toMatch(/createTransport\s*\(\s*\{[^}]*body\./);
    // La route invia solo tramite il transporter condiviso.
    const routeSrc = readSrc("src/app/api/segnalazioni/[id]/invia-pec/route.ts");
    expect(routeSrc).toContain("getTransporter(smtp)");
  });
});

// ============================================================
// XSS
// ============================================================

describe("[XSS] Cross-Site Scripting - HTML Escaping", () => {
  it("generaHtmlLettera escape i caratteri HTML", () => {
    const ctx = {
      mittenteNome: '<script>alert("XSS")</script>',
      mittenteIndirizzo: "Via 1",
      mittenteEmail: "a@b.it",
      destinatarioNome: "Sindaco",
      comuneNome: "Comune",
      pecComune: "c@pec.it",
      indirizzoVia: "Via 1",
      cap: "24049",
      provinciaSigla: "BG",
      regione: "LOMBARDIA",
      riferimentoLegge: "L.R.",
      titoloLegge: "T",
      testoProgettoIlluminotecnico: "a",
      testoDeroghe: "b",
      testoDatiFotometrici: "c",
      testoApprovazione: "d",
      testoInstallazione: "e",
      testoControllo: "f",
      testoSanzioni: "g",
      numeroProtocollo: "P1",
      oggettoPec: "O",
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
      includiArpa: false,
      luogoData: "Luogo, Data",
    } as never;
    const html = generaHtmlLettera(ctx);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("XSS")</script>');
  });

  it("nessun uso di dangerouslySetInnerHTML nei componenti React (ispezione sorgente)", () => {
    const compDir = path.join(PROJECT_ROOT, "src/components");
    if (!fs.existsSync(compDir)) return;
    let found = false;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) {
          const content = fs.readFileSync(full, "utf-8");
          if (content.includes("dangerouslySetInnerHTML")) {
            found = true;
          }
        }
      }
    };
    walk(compDir);
    expect(found).toBe(false);
  });
});

// ============================================================
// Demo Mode
// ============================================================

describe("[DEMO] Demo Mode - Blocco azioni mutative", () => {
  it("guardDemoReadOnly blocca azioni in demo mode", () => {
    const demoUser = { isDemo: true };
    expect(() => guardDemoReadOnly(demoUser)).toThrow(DEMO_READONLY_MESSAGE);
  });

  it("isDemoSession identifica correttamente sessioni demo", () => {
    expect(isDemoSession({ isDemo: true })).toBe(true);
    expect(isDemoSession({ isDemo: false })).toBe(false);
    expect(isDemoSession(null)).toBe(false);
    expect(isDemoSession(undefined)).toBe(false);
    expect(isDemoSession("string")).toBe(false);
    expect(isDemoSession(42)).toBe(false);
  });
});

// ============================================================
// GDPR
// ============================================================

describe("[GDPR] Anonimizzazione automatica", () => {
  it("retention configurabile via RETENTION_SEGNALAZIONI_ANNI (ispezione + comportamento)", () => {
    const src = readSrc("src/lib/cron-utils.ts");
    expect(src).toContain("RETENTION_SEGNALAZIONI_ANNI");
    expect(src).toMatch(/RETENTION_SEGNALAZIONI_ANNI_DEFAULT\s*=\s*10/);

    // Comportamento: getRetentionAnni usa env o default
    delete process.env.RETENTION_SEGNALAZIONI_ANNI;
    expect(getRetentionAnni()).toBe(10);
    process.env.RETENTION_SEGNALAZIONI_ANNI = "15";
    expect(getRetentionAnni()).toBe(15);
    delete process.env.RETENTION_SEGNALAZIONI_ANNI;
  });

  it("anonimizzazione rimuove PII e cancella allegati fisici (ispezione sorgente)", () => {
    const src = readSrc("src/lib/gdpr.ts");
    // Verifica REALE: il codice deve azzerare volontarioId, indirizzo, lat/long
    expect(src).toContain("volontarioId: null");
    expect(src).toContain("indirizzoVia: ");
    expect(src).toContain("latitudine: null");
    expect(src).toContain("longitudine: null");
    expect(src).toContain("descrizioneLibera: ");
    // Verifica REALE: il codice deve cancellare i file fisici con rm
    expect(src).toContain("rm(");
    expect(src).toContain("recursive: true");
  });

  it("retention usa dataChiusura (non updatedAt) per calcolare la finestra GDPR (ispezione sorgente)", () => {
    // Coerenza semantica: updatedAt si aggiorna ad ogni modifica del record,
    // posticipando falsamente la retention. La retention deve usare
    // dataChiusura, registrato quando lo stato transita a chiusa_*.
    const src = readSrc("src/lib/cron-utils.ts");
    expect(src).toContain("dataChiusura");
    // Il fallback su updatedAt copre solo le segnalazioni chiuse senza
    // dataChiusura valorizzato
    expect(src).toMatch(/OR:\s*\[/);
  });

  it("schema Prisma dichiara dataChiusura come campo nullable su Segnalazione (ispezione sorgente)", () => {
    const src = readSrc("prisma/schema.prisma");
    expect(src).toContain("dataChiusura");
    expect(src).toMatch(/dataChiusura\s+DateTime\?/);
  });

  it("segnalazionePrecedenteId è una vera foreign key con onDelete: SetNull (ispezione sorgente)", () => {
    // Integrità referenziale garantita dalla relazione Prisma con
    // onDelete: SetNull, che evita dangling reference se la segnalazione
    // precedente viene eliminata.
    const src = readSrc("prisma/schema.prisma");
    expect(src).toMatch(/segnalazionePrecedente\s+Segnalazione\?\s+@relation/);
    expect(src).toContain("onDelete: SetNull");
  });
});

// ============================================================
// 2FA TOTP (RFC 6238) - integrazione nel flusso di login
// ============================================================

describe("[TOTP] 2FA integrato nel flusso di autenticazione", () => {
  it("generateTotpSecret ritorna stringa Base32 di 32 caratteri (20 byte)", () => {
    const secret = generateTotpSecret("user@example.com");
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // Base32 di 20 byte = 32 caratteri (con padding opzionale)
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("generateTotpUri produce URL otpauth:// valido con issuer e label", () => {
    const secret = generateTotpSecret("user@example.com");
    const uri = generateTotpUri("user@example.com", secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("issuer=CieloBuio%20Segnalazioni");
    expect(uri).toContain("secret=" + secret);
  });

  it("verifyTotp ritorna false per secret vuoto o token vuoto", () => {
    expect(verifyTotp("", "123456")).toBe(false);
    expect(verifyTotp("ABCDEFGH", "")).toBe(false);
    expect(verifyTotp("", "")).toBe(false);
  });

  it("verifyTotp ritorna false per token di formato errato", () => {
    const secret = generateTotpSecret("user@example.com");
    expect(verifyTotp("abc", secret)).toBe(false);
    expect(verifyTotp("12345", secret)).toBe(false); // 5 cifre, non 6
    expect(verifyTotp("1234567", secret)).toBe(false); // 7 cifre
  });

  it("verifyTotp accetta token valido per il secret corrente (verifica round-trip)", () => {
    // Genera un token TOTP dal secret e verifica che lo stesso token
    // sia accettato da verifyTotp (round-trip completo).
    const secret = generateTotpSecret("user@example.com");
    const totp = new TOTP({
      issuer: "CieloBuio Segnalazioni",
      label: "user@example.com",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    const validToken = totp.generate();
    expect(verifyTotp(validToken, secret)).toBe(true);
  });

  it("route /api/auth/2fa esposta per setup/verify/disable (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/auth/2fa/route.ts");
    expect(src).toContain("setup");
    expect(src).toContain("verify");
    expect(src).toContain("disable");
    expect(src).toContain("generateTotpSecret");
    expect(src).toContain("verifyTotp");
  });

  it("login route integra verifica TOTP quando totpSecret E totpVerifiedAt sono presenti (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/auth/login/route.ts");
    expect(src).toContain("verifyTotp");
    expect(src).toContain("requiresTotp");
    // Il gate TOTP richiede ENTRAMBI totpSecret e totpVerifiedAt:
    // previene lockout se l'utente ha avviato setup senza completare verify.
    expect(src).toMatch(/if\s*\(user\.totpSecret\s*&&\s*user\.totpVerifiedAt\)/);
  });
});

// ============================================================
// Backup cifrato at-rest
// ============================================================

describe("[BACKUP] Cifratura at-rest completa (DB + allegati fisici)", () => {
  it("la libreria di backup cifra anche gli allegati fisici, non solo i metadati DB (ispezione sorgente)", () => {
    const src = readSrc("src/lib/backup.ts");
    expect(src).toContain("copiaAllegatiCifrati");
    expect(src).toContain("scriviCifrato");
    expect(src).toContain(".enc");
  });

  it("la libreria di backup usa AES-256-GCM con IV random e auth tag (ispezione sorgente)", () => {
    const src = readSrc("src/lib/backup.ts");
    expect(src).toContain("aes-256-gcm");
    expect(src).toContain("randomBytes(12)"); // IV 12 byte
    expect(src).toContain("getAuthTag()");
  });
});

// ============================================================
// Metrics endpoint auth per Prometheus
// ============================================================

describe("[METRICS] Endpoint /api/metrics supporta token statico per Prometheus", () => {
  it("metrics route accetta Authorization: Bearer <METRICS_TOKEN> (ispezione sorgente)", () => {
    const src = readSrc("src/app/api/metrics/route.ts");
    expect(src).toContain("METRICS_TOKEN");
    expect(src).toContain("Bearer");
    expect(src).toContain("timingSafeEqual"); // previene timing attack sul confronto token
  });
});

describe("[HTTP] Politica dei codici 401 e 403 nelle route", () => {
  // 401: sessione o credenziali mancanti o non valide (incluso il passo 2FA).
  // 403: sessione valida ma permesso negato. Le route non devono mescolare i due casi.
  const RE_RISPOSTA = /NextResponse\.json\(\s*\{\s*error:\s*("[^"]*"|[^,}]+)[^}]*\}\s*,\s*\{\s*status:\s*(40[13])/g;
  const RE_AUTENTICAZIONE = /^"(Non autenticato|Credenziali non valide|Autenticazione a due fattori|Codice TOTP)/;

  function fileRoute(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((voce) => {
      const percorso = path.join(dir, voce.name);
      if (voce.isDirectory()) return fileRoute(percorso);
      return voce.name === "route.ts" ? [percorso] : [];
    });
  }

  const risposte = fileRoute(path.join(process.cwd(), "src/app/api")).flatMap((file) => {
    const sorgente = fs.readFileSync(file, "utf-8");
    return [...sorgente.matchAll(RE_RISPOSTA)].map((m) => ({
      file: path.relative(process.cwd(), file),
      messaggio: m[1],
      stato: m[2],
    }));
  });

  it("analizza un numero sufficiente di risposte 401 e 403", () => {
    expect(risposte.length).toBeGreaterThanOrEqual(60);
    expect(risposte.some((r) => r.stato === "401")).toBe(true);
    expect(risposte.some((r) => r.stato === "403")).toBe(true);
  });

  it("le risposte 401 riguardano solo autenticazione, mai un permesso negato", () => {
    const errate = risposte.filter((r) => r.stato === "401" && !RE_AUTENTICAZIONE.test(r.messaggio));
    expect(errate).toEqual([]);
  });

  it("le risposte 403 non dichiarano una sessione mancante o credenziali errate", () => {
    const errate = risposte.filter((r) => r.stato === "403" && RE_AUTENTICAZIONE.test(r.messaggio));
    expect(errate).toEqual([]);
  });
});
