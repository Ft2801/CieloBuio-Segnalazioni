/**
 * Copertura dei rami residui di /api/auth/login: corpo non valido, campi non
 * stringa, anti-replay del codice TOTP (riuso rifiutato, primo utilizzo
 * registrato).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { mockCompare, mockHash, mockVerifyTotp } = vi.hoisted(() => ({
  mockCompare: vi.fn(),
  mockHash: vi.fn(),
  mockVerifyTotp: vi.fn(),
}));
vi.mock("bcryptjs", () => ({
  default: { hash: mockHash, compare: mockCompare },
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
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
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

function makeReq(body: unknown, raw?: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": "7.7.7.7" },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

function utenteTotp(overrides: Record<string, unknown> = {}) {
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
    totpVerifiedAt: new Date(),
    totpLastUsedTimestep: null,
    ...overrides,
  };
}

describe("POST /api/auth/login - rami residui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockHash.mockResolvedValue("$2a$12$mockhashvalueforentest0123456789");
    mockCompare.mockResolvedValue(true);
    mockVerifyTotp.mockReturnValue(true);
  });

  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await POST(makeReq(undefined, "non-json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Body della richiesta non valido");
  });

  it("ritorna 400 se email e password non sono stringhe", async () => {
    const res = await POST(makeReq({ email: 42, password: 7 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("obbligatorie");
  });

  it("primo accesso con codice TOTP registra il timestep usato in modo condizionato", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(utenteTotp() as never);
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.user.updateMany)).toHaveBeenCalledWith({
      where: {
        id: "u1",
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpVerifiedAt: { not: null },
        OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: 123456 } }],
      },
      data: { totpLastUsedTimestep: 123456 },
    });
  });

  it("rifiuta il riuso dello stesso codice TOTP (anti-replay, aggiornamento senza effetto)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(utenteTotp({ totpLastUsedTimestep: 123456 }) as never);
    vi.mocked(db.user.updateMany).mockResolvedValueOnce({ count: 0 });
    const res = await POST(makeReq({ email: "u@t.it", password: "Password1!", totpToken: "123456" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain("già usato");
    expect(vi.mocked(db.user.update)).not.toHaveBeenCalled();
  });
});
