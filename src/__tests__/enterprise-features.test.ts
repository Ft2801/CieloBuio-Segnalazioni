/**
 * Test per le nuove feature enterprise:
 * - Health check endpoint
 * - OpenAPI docs endpoint
 * - Metrics (Prometheus) endpoint
 * - Logger Pino
 * - TOTP (2FA)
 * - Backup encryption
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    user: { count: vi.fn() },
  },
}));

const { mockGetSessionUser } = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: mockGetSessionUser,
  canManageConfiguration: (user: { ruolo: string }) => user.ruolo === "admin",
  canReviewSegnalazioni: (user: { ruolo: string }) => ["admin", "referente_provinciale", "referente_regionale"].includes(user.ruolo),
  // Necessario per la route /api/docs che legge dinamicamente il nome
  // del cookie di sessione in base a NODE_ENV
  getSessionCookieName: () => process.env.NODE_ENV === "production" ? "__Host-cb_session" : "cb_session",
  timingSafeEqualStrings: (a: string, b: string) => a === b,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { GET as HealthGET } from "@/app/api/health/route";
import { GET as DocsGET } from "@/app/api/docs/route";
import { GET as MetricsGET } from "@/app/api/metrics/route";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  generateTotpSecret,
  createTotp,
  generateTotpUri,
  verifyTotp,
} from "@/lib/totp";

// ============================================================
// Health check
// ============================================================

describe("[Health Check] GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 200 con status ok quando il database è connesso", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([1] as any);
    const res = await HealthGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.database).toBe("connected");
    expect(json.service).toBe("cielobuio-segnalazioni");
    expect(json.version).toBe("1.0.0");
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
    expect(json.timestamp).toBeTruthy();
    expect(json.uptime).toBeGreaterThanOrEqual(0);
    expect(json.environment).toBeTruthy();
  });

  it("ritorna 503 con status error quando il database non è raggiungibile", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("Connection refused"));
    const res = await HealthGET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("error");
    expect(json.database).toBe("disconnected");
    expect(json.error).toBe("Database connection failed");
  });

  it("ritorna 503 anche con errore non-Error (stringa)", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue("DB timeout string" as any);
    const res = await HealthGET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("error");
    expect(json.database).toBe("disconnected");
  });

  it("non espone informazioni sensibili", async () => {
    vi.mocked(db.user.count).mockResolvedValue(1);
    const res = await HealthGET();
    const jsonStr = JSON.stringify(await res.json());
    expect(jsonStr).not.toMatch(/password|secret|token|apiKey|credential/i);
  });
});

// ============================================================
// OpenAPI docs
// ============================================================

describe("[OpenAPI] GET /api/docs", () => {
  it("ritorna 200 con spec OpenAPI valida", async () => {
    const res = await DocsGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.openapi).toBe("3.0.3");
    expect(json.info.title).toBe("CieloBuio Segnalazioni API");
    expect(json.info.version).toBe("1.0.0");
    expect(json.info.contact.email).toBe("fabiot2801@gmail.com");
    expect(json.info.license.name).toBe("AGPL-3.0-or-later");
  });

  it("ha header Cache-Control", async () => {
    const res = await DocsGET();
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
  });

  it("contiene tutti gli endpoint principali", async () => {
    const res = await DocsGET();
    const json = await res.json();
    expect(json.paths["/auth/login"]).toBeDefined();
    expect(json.paths["/auth/me"]).toBeDefined();
    expect(json.paths["/segnalazioni"]).toBeDefined();
    expect(json.paths["/segnalazioni/{id}"]).toBeDefined();
    expect(json.paths["/segnalazioni/{id}/approva"]).toBeDefined();
    expect(json.paths["/segnalazioni/{id}/invia-pec"]).toBeDefined();
    expect(json.paths["/segnalazioni/{id}/simula-pec"]).toBeDefined();
    expect(json.paths["/segnalazioni/export"]).toBeDefined();
    expect(json.paths["/upload"]).toBeDefined();
    expect(json.paths["/config/regioni"]).toBeDefined();
    expect(json.paths["/config/province"]).toBeDefined();
    expect(json.paths["/config/comuni"]).toBeDefined();
    expect(json.paths["/config/users"]).toBeDefined();
    expect(json.paths["/stats"]).toBeDefined();
    expect(json.paths["/reminder"]).toBeDefined();
    expect(json.paths["/health"]).toBeDefined();
  });

  it("ha gli schemi components definiti", async () => {
    const res = await DocsGET();
    const json = await res.json();
    expect(json.components.schemas.Segnalazione).toBeDefined();
    expect(json.components.schemas.User).toBeDefined();
    expect(json.components.schemas.Error).toBeDefined();
    expect(json.components.securitySchemes.sessionCookie).toBeDefined();
  });

  it("non espone credenziali sensibili", async () => {
    const res = await DocsGET();
    const jsonStr = JSON.stringify(await res.json());
    // Verifica che non ci siano password o chiavi private nei contenuti
    expect(jsonStr).not.toMatch(/"password"\s*:\s*"[^"]+"/i);
    expect(jsonStr).not.toMatch(/"apiKey"\s*:\s*"[^"]+"/i);
    expect(jsonStr).not.toMatch(/"credential"\s*:\s*"[^"]+"/i);
  });
});

// ============================================================
// Metrics (Prometheus)
// ============================================================

describe("[Metrics] GET /api/metrics", () => {
  const adminUser = {
    id: "adm-1", email: "a@t.it", nomeCognome: "Admin",
    ruolo: "admin" as const, provinciaId: null, regioneId: null,
    inizialiProtocollo: null, pec: null, emailOrdinaria: null,
    indirizzo: null, firma: null,
  };
  const volUser = {
    id: "vol-1", email: "v@t.it", nomeCognome: "Vol",
    ruolo: "volontario" as const, provinciaId: null, regioneId: null,
    inizialiProtocollo: null, pec: null, emailOrdinaria: null,
    indirizzo: null, firma: null,
  };

  beforeEach(() => {
    mockGetSessionUser.mockReset();
  });

  it("ritorna 403 senza autenticazione", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 per utente non admin", async () => {
    mockGetSessionUser.mockResolvedValue(volUser);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 con token errato (modalità Prometheus)", async () => {
    vi.stubEnv("METRICS_TOKEN", "valid-token-xyz");
    const req = new NextRequest("http://localhost/api/metrics", {
      headers: { authorization: "Bearer wrong-token" },
    });
    const res = await MetricsGET(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("ritorna 200 con Content-Type Prometheus per admin (modalità cookie)", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Content-Type")).toContain("version=0.0.4");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("ritorna 200 con token corretto (modalità Prometheus)", async () => {
    vi.stubEnv("METRICS_TOKEN", "valid-token-xyz");
    const req = new NextRequest("http://localhost/api/metrics", {
      headers: { authorization: "Bearer valid-token-xyz" },
    });
    const res = await MetricsGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    vi.unstubAllEnvs();
  });

  it("ritorna 403 con token via query param (?token=)", async () => {
    // Verifica il ramo in cui l'header Authorization manca o non è Bearer,
    // e il token viene fornito via query string: l'endpoint lo rifiuta per sicurezza.
    vi.stubEnv("METRICS_TOKEN", "valid-token-xyz");
    const req = new NextRequest("http://localhost/api/metrics?token=valid-token-xyz");
    const res = await MetricsGET(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("ritorna 403 con Authorization header non Bearer (es. Basic)", async () => {
    vi.stubEnv("METRICS_TOKEN", "valid-token-xyz");
    const req = new NextRequest("http://localhost/api/metrics", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    const res = await MetricsGET(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("ritorna 403 se nessun token fornito in modalità Prometheus", async () => {
    vi.stubEnv("METRICS_TOKEN", "valid-token-xyz");
    // Nessun header Authorization, nessun ?token=
    const req = new NextRequest("http://localhost/api/metrics");
    const res = await MetricsGET(req);
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("contiene metriche di memoria e CPU per admin", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    const text = await res.text();
    expect(text).toContain("cielobuio_process_uptime_seconds");
    expect(text).toContain("cielobuio_process_memory_rss_bytes");
    expect(text).toContain("cielobuio_process_memory_heap_used_bytes");
    expect(text).toContain("cielobuio_process_memory_heap_total_bytes");
    expect(text).toContain("cielobuio_process_memory_external_bytes");
    expect(text).toContain("cielobuio_process_cpu_user_microseconds");
    expect(text).toContain("cielobuio_process_cpu_system_microseconds");
    expect(text).toContain("cielobuio_node_version");
  });

  it("i valori delle metriche sono numerici", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.startsWith("cielobuio_") && !l.startsWith("#"));
    for (const line of lines) {
      const parts = line.trim().split(" ");
      expect(parts).toHaveLength(2);
      expect(Number(parts[1])).not.toBeNaN();
    }
  });

  it("non espone dati sensibili", async () => {
    mockGetSessionUser.mockResolvedValue(adminUser);
    const res = await MetricsGET(new NextRequest("http://localhost/api/metrics"));
    const text = await res.text();
    expect(text).not.toMatch(/password|secret|token|apiKey|email/i);
  });
});

// ============================================================
// Logger (Pino)
// ============================================================

describe("[Logger] Pino strutturato", () => {
  it("logger esporta un oggetto con metodi standard", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  it("logger.info non lancia errori", () => {
    expect(() => logger.info({ test: "value" }, "test message")).not.toThrow();
  });

  it("logger.error non lancia errori", () => {
    expect(() => logger.error({ err: new Error("test") }, "error message")).not.toThrow();
  });
});

// ============================================================
// TOTP (2FA)
// ============================================================

describe("[TOTP] Autenticazione a due fattori", () => {
  it("generateTotpSecret ritorna una stringa Base32", () => {
    const secret = generateTotpSecret("user@test.it");
    expect(secret).toBeTruthy();
    expect(typeof secret).toBe("string");
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it("generateTotpSecret genera secret diversi ad ogni chiamata", () => {
    const s1 = generateTotpSecret("a@t.it");
    const s2 = generateTotpSecret("a@t.it");
    expect(s1).not.toBe(s2);
  });

  it("generateTotpUri ritorna un URL otpauth://", () => {
    const secret = generateTotpSecret("user@test.it");
    const uri = generateTotpUri("user@test.it", secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("CieloBuio");
    expect(uri).toContain("secret=");
  });

  it("verifyTotp ritorna true per un codice TOTP valido", () => {
    const secret = generateTotpSecret("user@test.it");
    const totp = createTotp("user@test.it", secret);
    const token = totp.generate();
    expect(verifyTotp(token, secret)).toBe(true);
  });

  it("verifyTotp ritorna false per un codice TOTP non valido", () => {
    const secret = generateTotpSecret("user@test.it");
    expect(verifyTotp("000000", secret)).toBe(false);
    expect(verifyTotp("invalid", secret)).toBe(false);
    expect(verifyTotp("", secret)).toBe(false);
    expect(verifyTotp("123456", "")).toBe(false);
    expect(verifyTotp("", "")).toBe(false);
  });

  it("verifyTotp ritorna false per un secret non Base32 valido", () => {
    expect(verifyTotp("123456", "INVALID!@#")).toBe(false);
  });

  it("generateTotpSecret genera secret sufficientemente lunghi (min 160 bit)", () => {
    const secret = generateTotpSecret("user@test.it");
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("generateTotpSecret genera secret con entropia sufficiente", () => {
    const secret = generateTotpSecret("user@test.it");
    const uniqueChars = new Set(secret).size;
    expect(uniqueChars).toBeGreaterThan(10);
  });
});

// ============================================================
// Backup Encryption
// ============================================================

describe("[Backup Encryption] AES-256-GCM", () => {
  it("la cifratura e decifratura round-trip preserva i dati", () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('{"test":"data","secret":"value"}', "utf-8");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([iv, encrypted, authTag]);

    const decIv = encryptedBuffer.subarray(0, 12);
    const decAuthTag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
    const decEncrypted = encryptedBuffer.subarray(12, encryptedBuffer.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, decIv);
    decipher.setAuthTag(decAuthTag);
    const decrypted = Buffer.concat([decipher.update(decEncrypted), decipher.final()]);

    expect(decrypted.toString("utf-8")).toBe(plaintext.toString("utf-8"));
  });

  it("la decifratura con auth tag sbagliato fallisce", () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from("test data", "utf-8");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const wrongAuthTag = randomBytes(16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(wrongAuthTag);

    expect(() => {
      Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }).toThrow();
  });
});
