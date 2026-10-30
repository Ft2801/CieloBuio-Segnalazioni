/**
 * Test di integrazione per /api/auth/login
 * Copre: rate limit IP, rate limit email, credenziali valide/non valide,
 * utente non attivo, session creation, errori DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { mockCompare, mockHash } = vi.hoisted(() => ({
  mockCompare: vi.fn(),
  mockHash: vi.fn(),
}));
vi.mock("bcryptjs", () => ({
  default: { hash: mockHash, compare: mockCompare },
}));

const { mockVerifyTotp } = vi.hoisted(() => ({
  mockVerifyTotp: vi.fn(),
}));
vi.mock("@/lib/totp", () => ({
  verifyTotp: mockVerifyTotp,
  verifyTotpWithDelta: vi.fn((token: string, secret: string) => {
    const valid = mockVerifyTotp(token, secret);
    return { valid, delta: 0 };
  }),
  computeTotpTimestep: vi.fn(() => 123456),
  generateTotpSecret: vi.fn(() => "MOCKSECRETBASE32"),
  generateTotpUri: vi.fn(() => "otpauth://totp/mock"),
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sessione: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (args) =>
    typeof args === "function" ? args(mockDb) : Promise.all(args),
  );
  return { db: mockDb };
});

import { db } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { POST } from "@/app/api/auth/login/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: bcrypt.hash e compare ritornano valori validi per evitare
    // errori 500 nei test che non impostano esplicitamente i mock.
    // Il sentinel hash (per mitigare timing attack) richiede hash().
    mockHash.mockResolvedValue("$2a$12$mockhashvalueforentest0123456789");
    mockCompare.mockResolvedValue(false);
    __resetRateLimitStoreForTests();
  });

  afterEach(() => {
    __resetRateLimitStoreForTests();
  });

  it("non emette un cookie se le credenziali cambiano prima della creazione sessione", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      attivo: true,
      passwordHash: "hash",
      totpSecret: null,
      totpVerifiedAt: null,
    } as never);
    mockCompare.mockResolvedValue(true);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 });
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(db.sessione.create).not.toHaveBeenCalled();
  });

  it("ritorna 400 se email o password mancanti", async () => {
    const res = await POST(makeReq({ email: "test@test.it" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("obbligatorie");
  });

  it("ritorna 401 per utente non trovato", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ email: "no@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
  });

  it("ritorna 401 per utente non attivo", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "u@t.it",
      nomeCognome: "N",
      ruolo: "volontario",
      provinciaId: null,
      regioneId: null,
      inizialiProtocollo: null,
      pec: null,
      emailOrdinaria: null,
      indirizzo: null,
      firma: null,
      attivo: false,
      passwordHash: "hash",
    } as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
  });

  it("ritorna 401 per password errata", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "u@t.it",
      nomeCognome: "N",
      ruolo: "volontario",
      provinciaId: null,
      regioneId: null,
      inizialiProtocollo: null,
      pec: null,
      emailOrdinaria: null,
      indirizzo: null,
      firma: null,
      attivo: true,
      passwordHash: "hash",
    } as never);
    mockCompare.mockResolvedValue(false);
    const res = await POST(makeReq({ email: "u@t.it", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("login riuscito ritorna 200 con user e setta cookie", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "u@t.it",
      nomeCognome: "Mario",
      ruolo: "admin",
      provinciaId: null,
      regioneId: null,
      inizialiProtocollo: "MR",
      pec: null,
      emailOrdinaria: null,
      indirizzo: null,
      firma: null,
      attivo: true,
      passwordHash: "hash",
    } as never);
    mockCompare.mockResolvedValue(true);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);

    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.user.email).toBe("u@t.it");
    expect(res.headers.get("Set-Cookie")).toContain("cb_session=");
  });

  it("ritorna 400 se body non è JSON valido", async () => {
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rate limit IP: blocca dopo 20 tentativi falliti da uno stesso IP", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // 20 tentativi permessi (IP condiviso da un ufficio), al 21° blocco
    for (let i = 0; i < 20; i++) {
      const res = await POST(makeReq({ email: `test${i}@t.it`, password: "Password1!" }));
      expect(res.status).toBe(401);
    }
    const res = await POST(makeReq({ email: "test20@t.it", password: "Password1!" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("indirizzo IP");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate limit email: blocca il 4° tentativo con la stessa email anche da IP diversi", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // Stessa email con IP reali diversi (X-Real-IP, impostato da Caddy)
    for (let i = 0; i < 3; i++) {
      const req = new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Real-IP": `1.2.3.${i}`,
        },
        body: JSON.stringify({ email: "same@t.it", password: "Password1!" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    }
    // 4° tentativo con stessa email ma IP diverso: bloccato per email
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Real-IP": "9.9.9.9",
      },
      body: JSON.stringify({ email: "same@t.it", password: "Password1!" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("email");
  });
});

describe("POST /api/auth/login - edge cases per copertura rami", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
  });
  afterEach(() => {
    __resetRateLimitStoreForTests();
  });

  it("usa x-real-ip quando x-forwarded-for è assente (getClientIp branch)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Real-IP": "5.6.7.8",
      },
      body: JSON.stringify({ email: "x@t.it", password: "Password1!" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("X-Forwarded-For falsificabile non aggira il rate limit per IP", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    let ultimo = 0;
    // Stesso IP reale (X-Real-IP), X-Forwarded-For diverso a ogni richiesta.
    for (let i = 0; i < 21; i++) {
      const req = new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Real-IP": "9.9.9.9",
          "X-Forwarded-For": `10.0.0.${i}`,
        },
        body: JSON.stringify({ email: `utente${i}@t.it`, password: "Password1!" }),
      });
      ultimo = (await POST(req)).status;
    }
    expect(ultimo).toBe(429);
  });

  it("usa 'unknown' come IP quando né x-forwarded-for né x-real-ip sono presenti", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "y@t.it", password: "Password1!" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("ritorna 400 se il body JSON è null (catch block su body.email access)", async () => {
    // `null.email` throw TypeError, catch block ritorna 400
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non valido");
  });

  it("ritorna 500 se db.user.findUnique solleva errore (catch block)", async () => {
    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("DB connection lost"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeReq({ email: "z@t.it", password: "Password1!" }));
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });

  it("mostra messaggio 'Accesso temporaneamente bloccato' al 3° blocco (blockCount >= 3)", async () => {
    // Simulare tre blocchi reali richiederebbe di attendere i tempi di sblocco:
    // il rate limit viene quindi sostituito con uno spy che restituisce blockCount=3.
    const rl = await import("@/lib/rate-limit");
    rl.__resetRateLimitStoreForTests();
    const spy = vi.spyOn(rl, "checkRateLimit").mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1800,
      blockCount: 3,
    });
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ email: "blocked@t.it", password: "Password1!" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("temporaneamente bloccato");
    spy.mockRestore();
  });
});

// ============================================================
// 2FA TOTP - test del gate TOTP nel login
// ============================================================

describe("POST /api/auth/login - 2FA TOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHash.mockResolvedValue("$2a$12$mockhashvalueforentest0123456789");
    mockCompare.mockResolvedValue(true);
    mockVerifyTotp.mockReturnValue(true);
    __resetRateLimitStoreForTests();
  });

  afterEach(() => {
    __resetRateLimitStoreForTests();
  });

  function makeUserWithTotp(verifiedAt: Date | null = new Date()) {
    return {
      id: "u1",
      email: "u@t.it",
      nomeCognome: "N",
      ruolo: "volontario",
      provinciaId: null,
      regioneId: null,
      inizialiProtocollo: null,
      pec: null,
      emailOrdinaria: null,
      indirizzo: null,
      firma: null,
      attivo: true,
      passwordHash: "hash",
      totpSecret: "JBSWY3DPEHPK3PXP",
      totpVerifiedAt: verifiedAt,
    };
  }

  it("richiede 2FA (requiresTotp=true) se utente ha totpSecret E totpVerifiedAt", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("2FA");
  });

  it("NON richiede 2FA se totpSecret presente ma totpVerifiedAt null (setup non completato)", async () => {
    // Anti-lockout: l'utente ha avviato il setup ma non ha completato verify.
    // Il login deve riuscire senza TOTP per non bloccare l'utente.
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp(null) as never);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(200);
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });

  it("respinge totpToken non di 6 cifre", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "abc" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("6 cifre");
  });

  it("respinge totpToken di lunghezza errata (5 cifre)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "12345" }));
    expect(res.status).toBe(401);
  });

  it("respinge totpToken di lunghezza errata (7 cifre)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "1234567" }));
    expect(res.status).toBe(401);
  });

  it("respinge totpToken ben formattato ma non valido (verifyTotp=false)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    mockVerifyTotp.mockReturnValue(false);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("Codice TOTP non valido");
  });

  it("login riuscito con totpToken valido (verifyTotp=true)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp() as never);
    mockVerifyTotp.mockReturnValue(true);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.user.email).toBe("u@t.it");
  });

  it("utente senza totpSecret login riuscito senza 2FA", async () => {
    const userWithoutTotp = { ...makeUserWithTotp(), totpSecret: null, totpVerifiedAt: null };
    vi.mocked(db.user.findUnique).mockResolvedValue(userWithoutTotp as never);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(200);
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });
});
