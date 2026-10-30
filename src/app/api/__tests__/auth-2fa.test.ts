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
  canReviewSegnalazioni: (u: { ruolo: string }) =>
    ["admin", "referente_provinciale", "referente_regionale"].includes(u.ruolo),
  getSessionCookieName: () => (process.env.NODE_ENV === "production" ? "__Host-cb_session" : "cb_session"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: null,
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

/**
 * Codice a 6 cifre che non è valido in nessuna delle finestre accettate (-1, 0, +1 step),
 * così il test non dipende dal caso (un "000000" fisso potrebbe risultare valido).
 */
function tokenNonValido(segreto: string): string {
  const totp = new TOTP({
    issuer: "CieloBuio Segnalazioni",
    label: VOL_USER.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(segreto),
  });
  const validi = new Set([-1, 0, 1].map((k) => totp.generate({ timestamp: Date.now() + k * 30_000 })));
  const candidato = ["000000", "111111", "222222", "333333"].find((c) => !validi.has(c));
  if (!candidato) throw new Error("impossibile scegliere un codice non valido");
  return candidato;
}

function tokenValido(secret: string): string {
  return new TOTP({
    issuer: "CieloBuio Segnalazioni",
    label: VOL_USER.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

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
    // Tutte le transizioni di stato 2FA sono updateMany condizionali.
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);
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
        id: VOL_USER.id,
        totpSecret: null,
        totpVerifiedAt: null,
      } as never);

      const res = await POST(makeReq({ action: "setup" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const json = await res.json();
      expect(json.secret).toMatch(/^[A-Z2-7]+$/);
      expect(json.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(json.otpauthUri).toContain("secret=" + json.secret);
      expect(json.otpauthUri).toContain("issuer=CieloBuio");
      // Verifica che il secret sia salvato in DB con totpVerifiedAt null
      // (non attivo: l'utente deve ancora fare verify)
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: VOL_USER.id, totpVerifiedAt: null },
        data: {
          totpSecret: json.secret,
          totpPendingSecret: null,
          totpVerifiedAt: null,
          totpLastUsedTimestep: null,
        },
      });
    });

    it("richiede currentToken se 2FA è già attivo (totpVerifiedAt non null)", async () => {
      const secret = new Secret({ size: 20 }).base32;
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: secret,
        totpVerifiedAt: new Date(),
      } as never);

      // Senza currentToken
      const res = await POST(makeReq({ action: "setup" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("currentToken");
    });

    it("respinge setup con currentToken errato se 2FA già attivo", async () => {
      const secret = new Secret({ size: 20 }).base32;
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: secret,
        totpVerifiedAt: new Date(),
      } as never);

      const res = await POST(makeReq({ action: "setup", currentToken: tokenNonValido(secret) }));
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
        id: VOL_USER.id,
        totpSecret: secret,
        totpVerifiedAt: new Date(),
      } as never);

      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "setup", currentToken: validToken }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: { not: null } },
        data: { totpPendingSecret: json.secret },
      });
      expect(db.user.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totpVerifiedAt: null }) }),
      );
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe("action: verify", () => {
    it("ritorna 400 per token non stringa (numero)", async () => {
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
        id: VOL_USER.id,
        totpSecret: null,
        totpVerifiedAt: null,
      } as never);
      const res = await POST(makeReq({ action: "verify", token: "123456" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Nessun secret TOTP");
    });

    it("non promuove un secret in attesa se manca il fattore attivo nel database", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        totpSecret: null,
        totpPendingSecret: new Secret({ size: 20 }).base32,
        totpVerifiedAt: new Date(),
      } as never);
      const res = await POST(makeReq({ action: "verify", token: "123456" }));
      expect(res.status).toBe(409);
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });

    it("ritorna 400 per token TOTP non valido", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpVerifiedAt: null,
      } as never);
      const res = await POST(makeReq({ action: "verify", token: tokenNonValido("JBSWY3DPEHPK3PXP") }));
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
        id: VOL_USER.id,
        totpSecret: secret,
        totpVerifiedAt: null,
      } as never);
      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "verify", token: validToken }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Attivazione e protezione anti-replay avvengono in una sola UPDATE.
      expect(db.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: null }),
          data: expect.objectContaining({
            totpVerifiedAt: expect.any(Date),
            totpLastUsedTimestep: expect.any(Number),
          }),
        }),
      );
    });
  });

  describe("action: disable", () => {
    it.each([123456, null, "abc"])("ritorna 400 per token attivo non valido: %s", async (token) => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpVerifiedAt: new Date(),
      } as never);
      const res = await POST(makeReq({ action: "disable", token }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("6 cifre");
    });

    it("ritorna 400 se 2FA non è configurato (no totpSecret)", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: null,
        totpVerifiedAt: null,
      } as never);
      const res = await POST(makeReq({ action: "disable", token: "123456" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("2FA non è configurato");
    });

    it("permette disable senza token se 2FA in setup ma non verificato (annulla setup)", async () => {
      // totpSecret presente ma totpVerifiedAt null: setup incompleto,
      // l'utente può annullare senza dover fornire il token.
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpVerifiedAt: null,
      } as never);
      const res = await POST(makeReq({ action: "disable" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: VOL_USER.id, totpSecret: "JBSWY3DPEHPK3PXP", totpVerifiedAt: null },
        data: { totpSecret: null, totpPendingSecret: null, totpVerifiedAt: null, totpLastUsedTimestep: null },
      });
    });

    it("respinge disable con token errato se 2FA attivo (totpVerifiedAt non null)", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: VOL_USER.id,
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpVerifiedAt: new Date(),
      } as never);
      const res = await POST(makeReq({ action: "disable", token: tokenNonValido("JBSWY3DPEHPK3PXP") }));
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
        id: VOL_USER.id,
        totpSecret: secret,
        totpVerifiedAt: new Date(),
      } as never);
      const validToken = totp.generate();
      const res = await POST(makeReq({ action: "disable", token: validToken }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: VOL_USER.id, totpSecret: secret, totpVerifiedAt: { not: null } },
        data: { totpSecret: null, totpPendingSecret: null, totpVerifiedAt: null, totpLastUsedTimestep: null },
      });
    });
  });
});

// -----------------------------------------------------------------------------
// Anti-replay atomico: il timestep viene registrato con un updateMany
// condizionato. count 0 significa che il codice è già stato usato.
// -----------------------------------------------------------------------------
describe("POST /api/auth/2fa - replay TOTP e body non valido", () => {
  const SEGRETO = new Secret({ size: 20 }).base32;
  const totpValido = () =>
    new TOTP({
      issuer: "CieloBuio Segnalazioni",
      label: VOL_USER.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(SEGRETO),
    }).generate();

  it("setup con currentToken già utilizzato viene rifiutato", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: VOL_USER.id,
      totpSecret: SEGRETO,
      totpVerifiedAt: new Date(),
    } as never);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const res = await POST(makeReq({ action: "setup", currentToken: totpValido() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("già utilizzato");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("disattivazione con codice già utilizzato viene rifiutata", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: VOL_USER.id,
      totpSecret: SEGRETO,
      totpVerifiedAt: new Date(),
    } as never);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const res = await POST(makeReq({ action: "disable", token: totpValido() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("già utilizzato");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("verifica con codice già utilizzato viene rifiutata senza attivare il 2FA", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: VOL_USER.id,
      totpSecret: SEGRETO,
      totpVerifiedAt: null,
    } as never);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const res = await POST(makeReq({ action: "verify", token: totpValido() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("già utilizzato");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("verifica: secret corrente, timestep e attivazione sono controllati atomicamente", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: VOL_USER.id,
      totpSecret: SEGRETO,
      totpVerifiedAt: null,
    } as never);
    const res = await POST(makeReq({ action: "verify", token: totpValido() }));
    expect(res.status).toBe(200);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: VOL_USER.id,
        totpSecret: SEGRETO,
        totpVerifiedAt: null,
        OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: expect.any(Number) } }],
      },
      data: { totpLastUsedTimestep: expect.any(Number), totpVerifiedAt: expect.any(Date) },
    });
    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it("un body che non è un oggetto JSON viene trattato come vuoto", async () => {
    const res = await POST(makeReq([1, 2, 3]));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/2fa - rotazione e concorrenza", () => {
  it("una rotazione abbandonata conserva il fattore attivo e salva solo il pending secret", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({ totpSecret: attivo, totpVerifiedAt: new Date() } as never);
    const response = await POST(makeReq({ action: "setup", currentToken: tokenValido(attivo) }));
    expect(response.status).toBe(200);
    const { secret } = await response.json();
    const chiamate = vi.mocked(db.user.updateMany).mock.calls;
    expect(chiamate).toHaveLength(2);
    expect(chiamate[0][0]).toEqual({
      where: {
        id: VOL_USER.id,
        totpSecret: attivo,
        totpVerifiedAt: { not: null },
        OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: expect.any(Number) } }],
      },
      data: { totpLastUsedTimestep: expect.any(Number) },
    });
    expect(chiamate[1][0]).toEqual({
      where: { id: VOL_USER.id, totpSecret: attivo, totpVerifiedAt: { not: null } },
      data: { totpPendingSecret: secret },
    });
    expect(chiamate.every(([args]) => !Object.hasOwn(args.data, "totpVerifiedAt"))).toBe(true);
  });

  it("verify con 2FA attivo rifiuta un codice del vecchio fattore senza nuovo setup", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({
      totpSecret: attivo,
      totpPendingSecret: null,
      totpVerifiedAt: new Date(),
    } as never);
    const response = await POST(makeReq({ action: "verify", token: tokenValido(attivo) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Nessun secret");
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("verify rifiuta il vecchio codice e accetta il nuovo senza una finestra senza 2FA", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    const nuovo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({
      totpSecret: attivo,
      totpPendingSecret: nuovo,
      totpVerifiedAt: new Date(),
    } as never);
    const precedente = await POST(makeReq({ action: "verify", token: tokenNonValido(nuovo) }));
    expect(precedente.status).toBe(400);
    expect(db.user.updateMany).not.toHaveBeenCalled();

    const conferma = await POST(makeReq({ action: "verify", token: tokenValido(nuovo) }));
    expect(conferma.status).toBe(200);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: VOL_USER.id,
        totpSecret: attivo,
        totpPendingSecret: nuovo,
        totpVerifiedAt: { not: null },
      },
      data: {
        totpSecret: nuovo,
        totpPendingSecret: null,
        totpVerifiedAt: expect.any(Date),
        totpLastUsedTimestep: expect.any(Number),
      },
    });
  });

  it("setup iniziale rifiuta la risposta se l'account è cambiato prima del salvataggio", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const response = await POST(makeReq({ action: "setup" }));
    expect(response.status).toBe(409);
    expect((await response.json()).secret).toBeUndefined();
  });

  it("setup attivo rifiuta una rotazione concorrente dopo la registrazione del codice", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({ totpSecret: attivo, totpVerifiedAt: new Date() } as never);
    vi.mocked(db.user.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    const response = await POST(makeReq({ action: "setup", currentToken: tokenValido(attivo) }));
    expect(response.status).toBe(409);
  });

  it("verify rifiuta l'attivazione se il setup corrente è stato sostituito", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    const nuovo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({
      totpSecret: attivo,
      totpPendingSecret: nuovo,
      totpVerifiedAt: new Date(),
    } as never);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const response = await POST(makeReq({ action: "verify", token: tokenValido(nuovo) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("configurazione cambiata");
  });

  it("disable non cancella il fattore di una rotazione concorrente", async () => {
    const attivo = new Secret({ size: 20 }).base32;
    vi.mocked(db.user.findUnique).mockResolvedValue({ totpSecret: attivo, totpVerifiedAt: new Date() } as never);
    vi.mocked(db.user.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    const response = await POST(makeReq({ action: "disable", token: tokenValido(attivo) }));
    expect(response.status).toBe(409);
  });
});
