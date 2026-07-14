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

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    sessione: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (args: unknown[]) => Promise.all(args)),
  },
}));

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
      id: "u1", email: "u@t.it", nomeCognome: "N", ruolo: "volontario",
      provinciaId: null, regioneId: null, inizialiProtocollo: null,
      pec: null, emailOrdinaria: null, indirizzo: null, firma: null,
      attivo: false, passwordHash: "hash",
    } as any);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
  });

  it("ritorna 401 per password errata", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "u@t.it", nomeCognome: "N", ruolo: "volontario",
      provinciaId: null, regioneId: null, inizialiProtocollo: null,
      pec: null, emailOrdinaria: null, indirizzo: null, firma: null,
      attivo: true, passwordHash: "hash",
    } as any);
    mockCompare.mockResolvedValue(false);
    const res = await POST(makeReq({ email: "u@t.it", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("login riuscito ritorna 200 con user e setta cookie", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "u@t.it", nomeCognome: "Mario", ruolo: "admin",
      provinciaId: null, regioneId: null, inizialiProtocollo: "MR",
      pec: null, emailOrdinaria: null, indirizzo: null, firma: null,
      attivo: true, passwordHash: "hash",
    } as any);
    mockCompare.mockResolvedValue(true);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as any);

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

  it("rate limit IP: blocca dopo 4 tentativi falliti", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // 3 tentativi permessi, al 4° blocco
    for (let i = 0; i < 3; i++) {
      const res = await POST(makeReq({ email: `test${i}@t.it`, password: "Password1!" }));
      expect(res.status).toBe(401);
    }
    // 4° tentativo: bloccato
    const res = await POST(makeReq({ email: "test4@t.it", password: "Password1!" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("indirizzo IP");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate limit email: blocca dopo 4 tentativi con stessa email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // Usa stessa email con IP diversi (simulati cambiando header X-Forwarded-For)
    for (let i = 0; i < 3; i++) {
      const req = new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `1.2.3.${i}`,
        },
        body: JSON.stringify({ email: "same@t.it", password: "Password1!" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    }
    // 4° tentativo con stesso email ma IP diverso: bloccato per email
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "9.9.9.9",
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
    // Simuliamo 3 blocchi consecutivi manipolando il rate limit store.
    // Per evitare di dover aspettare 5+ min tra i blocchi, riempiamo
    // direttamente lo store con una entry bloccata con blockCount=2 e
    // lockedUntil già scaduto, così il prossimo tentativo incrementa a 3.
    const { __resetRateLimitStoreForTests: _r } = await import("@/lib/rate-limit");
    const rl = await import("@/lib/rate-limit");
    _r();
    // Iniettiamo 3 tentativi falliti per far scattare il 4° tentativo come blocco 1,
    // poi riempiamo di nuovo per blocco 2, e infine per blocco 3.
    // Approccio alternativo: spy su checkRateLimit per ritornare blockCount=3.
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
      id: "u1", email: "u@t.it", nomeCognome: "N", ruolo: "volontario",
      provinciaId: null, regioneId: null, inizialiProtocollo: null,
      pec: null, emailOrdinaria: null, indirizzo: null, firma: null,
      attivo: true, passwordHash: "hash", totpSecret: "JBSWY3DPEHPK3PXP",
      totpVerifiedAt: verifiedAt,
    } as any;
  }

  it("richiede 2FA (requiresTotp=true) se utente ha totpSecret E totpVerifiedAt", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("2FA");
  });

  it("NON richiede 2FA se totpSecret presente ma totpVerifiedAt null (setup non completato)", async () => {
    // Anti-lockout: l'utente ha avviato il setup ma non ha completato verify.
    // Il login deve riuscire senza TOTP per non bloccare l'utente.
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp(null));
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as any);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(200);
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });

  it("respinge totpToken non di 6 cifre", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "abc" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("6 cifre");
  });

  it("respinge totpToken di lunghezza errata (5 cifre)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "12345" }));
    expect(res.status).toBe(401);
  });

  it("respinge totpToken di lunghezza errata (7 cifre)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "1234567" }));
    expect(res.status).toBe(401);
  });

  it("respinge totpToken ben formattato ma non valido (verifyTotp=false)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    mockVerifyTotp.mockReturnValue(false);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(json.error).toContain("Codice TOTP non valido");
  });

  it("login riuscito con totpToken valido (verifyTotp=true)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(makeUserWithTotp());
    mockVerifyTotp.mockReturnValue(true);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as any);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.user.email).toBe("u@t.it");
  });

  it("utente senza totpSecret login riuscito senza 2FA", async () => {
    const userWithoutTotp = { ...makeUserWithTotp(), totpSecret: null, totpVerifiedAt: null };
    vi.mocked(db.user.findUnique).mockResolvedValue(userWithoutTotp);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as any);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!" }));
    expect(res.status).toBe(200);
    expect(mockVerifyTotp).not.toHaveBeenCalled();
  });
});
