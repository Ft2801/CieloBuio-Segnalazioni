/**
 * Test per POST /api/auth/2fa - setup, verify, disable TOTP 2FA.
 *
 * Copre:
 * - 401 senza autenticazione
 * - action non valida -> 400
 * - setup: genera secret, salva in DB con totpVerifiedAt=null (non attivo)
 * - setup con 2FA già attivo richiede currentToken
 * - verify: token non valido (formato errato, valore errato, nessun secret)
 * - verify: token valido imposta totpVerifiedAt (attiva 2FA)
 * - disable: richiede token valido se 2FA attivo, altrimenti no
 * - rate limiting
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { TOTP, Secret } from "otpauth";

const { mockGetSessionUser } = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getSessionUser: mockGetSessionUser,
  canManageConfiguration: (u: { ruolo: string }) => u.ruolo === "admin",
  canReviewSegnalazioni: (u: { ruolo: string }) => ["admin", "referente_provinciale", "referente_regionale"].includes(u.ruolo),
  getSessionCookieName: () => process.env.NODE_ENV === "production" ? "__Host-cb_session" : "cb_session",
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0, blockCount: 0 })),
  resetRateLimit: vi.fn(),
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

import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/2fa/route";

const VOL_USER = {
  id: "cuser1234567890vol01",
  email: "v@t.it",
  nomeCognome: "Vol",
  ruolo: "volontario" as const,
  provinciaId: null, regioneId: null,
  inizialiProtocollo: null, pec: null, emailOrdinaria: null,
  indirizzo: null, firma: null,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/2fa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue(VOL_USER);
    vi.mocked(db.user.update).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 401 senza autenticazione", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await POST(makeReq({ action: "setup" }));
    expect(res.status).toBe(401);
  });

  it("ritorna 400 per action non valida", async () => {
    const res = await POST(makeReq({ action: "invalid" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Azione non valida");
  });

  it("ritorna 400 per action mancante", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("ritorna 429 se rate limit superato", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
      blockCount: 1,
    });
    const res = await POST(makeReq({ action: "setup" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppe richieste 2FA");
    expect(res.headers.get("Retry-After")).toBe("600");
  });

  describe("action: setup", () => {
    it("genera secret Base32 e otpauthUri, salva in DB con totpVerifiedAt=null (non attivo)", async () => {
      // Nessun 2FA pre-esistente: setup libero
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: null, totpVerifiedAt: null,
      } as any);

      const res = await POST(makeReq({ action: "setup" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.secret).toMatch(/^[A-Z2-7]+$/);
      expect(json.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(json.otpauthUri).toContain("secret=" + json.secret);
      expect(json.otpauthUri).toContain("issuer=CieloBuio");
      // Verifica che il secret sia salvato in DB con totpVerifiedAt null
      // (non attivo: l'utente deve ancora fare verify)
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: VOL_USER.id },
        data: { totpSecret: json.secret, totpVerifiedAt: null },
      });
    });

    it("richiede currentToken se 2FA è già attivo (totpVerifiedAt non null)", async () => {
      const secret = new Secret({ size: 20 }).base32;
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: new Date(),
      } as any);

      // Senza currentToken
      const res = await POST(makeReq({ action: "setup" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("currentToken");
    });

    it("respinge setup con currentToken errato se 2FA già attivo", async () => {
      const secret = new Secret({ size: 20 }).base32;
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: new Date(),
      } as any);

      const res = await POST(makeReq({ action: "setup", currentToken: "000000" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("non valido");
    });

    it("permette setup con currentToken valido se 2FA già attivo", async () => {
      const secret = new Secret({ size: 20 }).base32;
      const totp = new TOTP({
        issuer: "CieloBuio Segnalazioni",
        label: VOL_USER.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: new Date(),
      } as any);

      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "setup", currentToken: validToken }));
      expect(res.status).toBe(200);
    });
  });

  describe("action: verify", () => {
    it("ritorna 400 per token non stringa (numero, oggetto, null)", async () => {
      const res = await POST(makeReq({ action: "verify", token: 123456 }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 per token null", async () => {
      const res = await POST(makeReq({ action: "verify", token: null }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 per token non di 6 cifre", async () => {
      const res = await POST(makeReq({ action: "verify", token: "abc" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("6 cifre");
    });

    it("ritorna 400 per token di 5 cifre", async () => {
      const res = await POST(makeReq({ action: "verify", token: "12345" }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 per token di 7 cifre", async () => {
      const res = await POST(makeReq({ action: "verify", token: "1234567" }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 se nessun secret TOTP configurato", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: null, totpVerifiedAt: null,
      } as any);
      const res = await POST(makeReq({ action: "verify", token: "123456" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Nessun secret TOTP");
    });

    it("ritorna 400 per token TOTP non valido", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: "JBSWY3DPEHPK3PXP", totpVerifiedAt: null,
      } as any);
      const res = await POST(makeReq({ action: "verify", token: "000000" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Token TOTP non valido");
    });

    it("ritorna 200 e imposta totpVerifiedAt per token valido (round-trip)", async () => {
      const secret = new Secret({ size: 20 }).base32;
      const totp = new TOTP({
        issuer: "CieloBuio Segnalazioni",
        label: VOL_USER.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: null,
      } as any);
      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "verify", token: validToken }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Verifica che totpVerifiedAt sia stato impostato
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: VOL_USER.id },
        data: { totpVerifiedAt: expect.any(Date) },
      });
    });
  });

  describe("action: disable", () => {
    it("ritorna 400 per token non stringa (numero)", async () => {
      const res = await POST(makeReq({ action: "disable", token: 123456 }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 per token null", async () => {
      const res = await POST(makeReq({ action: "disable", token: null }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 per token non di 6 cifre", async () => {
      const res = await POST(makeReq({ action: "disable", token: "abc" }));
      expect(res.status).toBe(400);
    });

    it("ritorna 400 se 2FA non è configurato (no totpSecret)", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: null, totpVerifiedAt: null,
      } as any);
      const res = await POST(makeReq({ action: "disable", token: "123456" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("2FA non è configurato");
    });

    it("permette disable senza token se 2FA in setup ma non verificato (annulla setup)", async () => {
      // totpSecret presente ma totpVerifiedAt null: setup incompleto,
      // l'utente può annullare senza dover fornire il token.
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: "JBSWY3DPEHPK3PXP", totpVerifiedAt: null,
      } as any);
      const res = await POST(makeReq({ action: "disable", token: "000000" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: VOL_USER.id },
        data: { totpSecret: null, totpVerifiedAt: null },
      });
    });

    it("respinge disable con token errato se 2FA attivo (totpVerifiedAt non null)", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: "JBSWY3DPEHPK3PXP", totpVerifiedAt: new Date(),
      } as any);
      const res = await POST(makeReq({ action: "disable", token: "000000" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Token TOTP non valido");
    });

    it("ritorna 200 e rimuove totpSecret+totpVerifiedAt per token valido (2FA attivo)", async () => {
      const secret = new Secret({ size: 20 }).base32;
      const totp = new TOTP({
        issuer: "CieloBuio Segnalazioni",
        label: VOL_USER.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: new Date(),
      } as any);
      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "disable", token: validToken }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: VOL_USER.id },
        data: { totpSecret: null, totpVerifiedAt: null },
      });
    });
  });
});
