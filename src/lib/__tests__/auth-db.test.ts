/**
 * Test per le funzioni DB-dipendenti di src/lib/auth.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCompare, mockHash, mockCookies } = vi.hoisted(() => ({
  mockCompare: vi.fn(),
  mockHash: vi.fn(),
  mockCookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies }));

vi.mock("@/lib/db", () => ({
  db: {
    sessione: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "s1", token: "tok" }),
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (args: unknown[]) => {
      if (Array.isArray(args)) return Promise.all(args);
      if (typeof args === "function") return (args as () => unknown)();
    }),
  },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mockHash, compare: mockCompare },
}));

import { db } from "@/lib/db";
import { hashPassword, verifyPassword, createSession, getSessionUser, destroySession } from "@/lib/auth";

describe("hashPassword", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("ritorna un hash bcrypt", async () => {
    mockHash.mockResolvedValue("hashed-password");
    const result = await hashPassword("password123");
    expect(result).toBe("hashed-password");
    expect(mockHash).toHaveBeenCalledWith("password123", 12);
  });
});

describe("verifyPassword", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("ritorna true se compare ritorna true", async () => {
    mockCompare.mockResolvedValue(true);
    expect(await verifyPassword("p", "h")).toBe(true);
  });
  it("ritorna false se compare ritorna false", async () => {
    mockCompare.mockResolvedValue(false);
    expect(await verifyPassword("p", "h")).toBe(false);
  });
});

describe("createSession", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("crea sessione e ritorna token", async () => {
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as any);
    const token = await createSession("user-1");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
  });
});

describe("getSessionUser", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("null se nessun cookie", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    expect(await getSessionUser()).toBeNull();
  });

  it("null se sessione non trovata", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it("null se sessione scaduta", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1", token: "token", scadenza: new Date(Date.now() - 1000),
      user: { id: "u1", email: "e@t.it", nomeCognome: "N", ruolo: "volontario", provinciaId: null, regioneId: null, inizialiProtocollo: null, pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
    } as any);
    vi.mocked(db.sessione.delete).mockResolvedValue({} as any);
    expect(await getSessionUser()).toBeNull();
  });

  it("null se utente non attivo", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1", token: "token", scadenza: new Date(Date.now() + 10000),
      user: { id: "u1", email: "e@t.it", nomeCognome: "N", ruolo: "volontario", provinciaId: null, regioneId: null, inizialiProtocollo: null, pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: false },
    } as any);
    expect(await getSessionUser()).toBeNull();
  });

  it("ritorna SessionUser se valido", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1", token: "token", scadenza: new Date(Date.now() + 10000),
      user: { id: "u1", email: "a@t.it", nomeCognome: "Admin", ruolo: "admin", provinciaId: null, regioneId: null, inizialiProtocollo: "AD", pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
    } as any);
    const result = await getSessionUser();
    expect(result?.id).toBe("u1");
    expect(result?.ruolo).toBe("admin");
  });
});

describe("destroySession", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("chiama deleteMany se token presente", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 1 } as any);
    await destroySession();
    expect(db.sessione.deleteMany).toHaveBeenCalled();
  });
  it("non chiama deleteMany senza token", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    await destroySession();
    expect(db.sessione.deleteMany).not.toHaveBeenCalled();
  });
});
