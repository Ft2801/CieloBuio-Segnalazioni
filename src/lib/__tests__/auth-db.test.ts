/**
 * Test per le funzioni DB-dipendenti di src/lib/auth.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

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
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (args: unknown[]) => {
      if (Array.isArray(args)) return Promise.all(args);
      if (typeof args === "function") return (args as (tx: typeof db) => unknown)(db);
    }),
  },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mockHash, compare: mockCompare },
}));

import { db } from "@/lib/db";
import { hashPassword, verifyPassword, createSession, getSessionUser, destroySession } from "@/lib/auth";

describe("hashPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("ritorna un hash bcrypt", async () => {
    mockHash.mockResolvedValue("hashed-password");
    const result = await hashPassword("password123");
    expect(result).toBe("hashed-password");
    expect(mockHash).toHaveBeenCalledWith("password123", 12);
  });
});

describe("verifyPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
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
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("crea sessione e ritorna token", async () => {
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);
    const token = await createSession("user-1");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
  });

  it("nel database viene salvato solo il digest SHA-256 del token, non il token", async () => {
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sessione.create).mockResolvedValue({ id: "s1", token: "tok" } as never);
    const token = await createSession("user-1");
    const data = (vi.mocked(db.sessione.create).mock.calls[0][0] as { data: { token: string; userId: string } }).data;
    expect(data.userId).toBe("user-1");
    expect(data.token).not.toBe(token);
    expect(data.token).toBe(createHash("sha256").update(token).digest("hex"));
    // La transazione invalida le sessioni precedenti dello stesso utente (session rotation).
    expect(db.sessione.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });
});

describe("getSessionUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("null se nessun cookie", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    expect(await getSessionUser()).toBeNull();
  });

  it("null se sessione non trovata", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it("rifiuta la sessione all'istante esatto della scadenza", async () => {
    vi.useFakeTimers();
    try {
      const ora = new Date("2026-10-30T12:00:00Z");
      vi.setSystemTime(ora);
      mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
      vi.mocked(db.sessione.findUnique).mockResolvedValue({
        id: "s1",
        scadenza: ora,
        user: { attivo: true, ruolo: "admin" },
      } as never);
      expect(await getSessionUser()).toBeNull();
      expect(db.sessione.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("null se sessione scaduta", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "token",
      scadenza: new Date(Date.now() - 1000),
      user: {
        id: "u1",
        email: "e@t.it",
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
      },
    } as never);
    vi.mocked(db.sessione.delete).mockResolvedValue({} as never);
    expect(await getSessionUser()).toBeNull();
    expect(db.sessione.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("null se utente non attivo", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "token",
      scadenza: new Date(Date.now() + 10000),
      user: {
        id: "u1",
        email: "e@t.it",
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
      },
    } as never);
    expect(await getSessionUser()).toBeNull();
    expect(db.sessione.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("ritorna SessionUser se valido", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "token",
      scadenza: new Date(Date.now() + 10000),
      user: {
        id: "u1",
        email: "a@t.it",
        nomeCognome: "Admin",
        ruolo: "admin",
        provinciaId: null,
        regioneId: null,
        inizialiProtocollo: "AD",
        pec: null,
        emailOrdinaria: null,
        indirizzo: null,
        firma: null,
        attivo: true,
      },
    } as never);
    const result = await getSessionUser();
    // La ricerca usa il digest del cookie, coerente con il salvataggio in createSession.
    expect(db.sessione.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: createHash("sha256").update("token").digest("hex") } }),
    );
    expect(result?.id).toBe("u1");
    expect(result?.ruolo).toBe("admin");
  });
});

describe("destroySession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("chiama deleteMany se token presente", async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 1 } as never);
    await destroySession();
    expect(db.sessione.deleteMany).toHaveBeenCalled();
  });
  it("non chiama deleteMany senza token", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    await destroySession();
    expect(db.sessione.deleteMany).not.toHaveBeenCalled();
  });
});

describe("creazione sessione e credenziali concorrenti", () => {
  const snapshot = { passwordHash: "hash", totpSecret: null, totpVerifiedAt: null };
  beforeEach(() => vi.clearAllMocks());
  it.each([0, 1])("la sessione richiede lo stesso snapshot: count=%s", async (count) => {
    vi.mocked(db.user.updateMany).mockResolvedValue({ count });
    if (count === 0) {
      await expect(createSession("u1", snapshot)).rejects.toThrow();
      expect(db.sessione.create).not.toHaveBeenCalled();
      expect(db.sessione.deleteMany).not.toHaveBeenCalled();
    } else {
      await expect(createSession("u1", snapshot)).resolves.toMatch(/^[a-f0-9]{64}$/);
      expect(db.sessione.create).toHaveBeenCalled();
    }
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", attivo: true, ...snapshot },
      data: { attivo: true },
    });
  });
});
