/**
 * Test di integrazione per /api/config/regioni/[id] (PUT, DELETE)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => {
  const mockDb = {
    regioneLegge: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    provincia: { count: vi.fn() },
    user: { count: vi.fn() },
    segnalazione: { count: vi.fn().mockResolvedValue(0) },
    sessione: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (cb) => {
    if (typeof cb === "function") return cb(mockDb);
    return Promise.all(cb);
  });
  return { db: mockDb };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { PUT, DELETE } from "@/app/api/config/regioni/[id]/route";

const ADMIN_SESSION = {
  id: "s1",
  token: "tok",
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
};

function mockCookiesFor(user: typeof ADMIN_SESSION | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  if (user) {
    vi.mocked(db.sessione.findUnique).mockResolvedValue(user as never);
  } else {
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
  }
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/config/regioni/1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("PUT /api/config/regioni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockCookiesFor(null);
    const res = await PUT(makeReq("PUT", { regione: "X" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se regione non trovata", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { regione: "X", riferimentoLegge: "Y", pecArpaRegionale: "" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("aggiorna regione valida ritorna 200", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1, regione: "LOM" } as never);
    vi.mocked(db.regioneLegge.update).mockResolvedValue({ id: 1, regione: "LOMBARDIA" } as never);
    const res = await PUT(makeReq("PUT", { regione: "LOMBARDIA", riferimentoLegge: "L.R.", pecArpaRegionale: "" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(db.regioneLegge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ regione: "LOMBARDIA" }) }),
    );
  });

  it("ritorna 500 su errore DB", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1 } as never);
    vi.mocked(db.regioneLegge.update).mockRejectedValue(new Error("DB error"));
    const res = await PUT(makeReq("PUT", { regione: "LOM", riferimentoLegge: "L.R.", pecArpaRegionale: "" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(500);
  });

  it("ritorna 400 se validazione fallisce", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1 } as never);
    const res = await PUT(makeReq("PUT", { regione: "" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/config/regioni/[id] - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se ID non numerico", async () => {
    mockCookiesFor(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { regione: "X" }), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID non valido");
  });
});

describe("DELETE /api/config/regioni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se ID non numerico", async () => {
    mockCookiesFor(ADMIN_SESSION);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID non valido");
  });

  it("ritorna 401 se non autenticato", async () => {
    mockCookiesFor(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se regione non trovata", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se ci sono province collegate", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      regione: "LOM",
      _count: { province: 3, segnalazioni: 0 },
    } as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se ci sono segnalazioni collegate", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      regione: "LOM",
      _count: { province: 0, segnalazioni: 5 },
    } as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se ci sono referenti regionali assegnati", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      regione: "LOM",
      _count: { province: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(2);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("elimina regione valida ritorna 200", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      regione: "LOM",
      _count: { province: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(0);
    vi.mocked(db.regioneLegge.delete).mockResolvedValue({} as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(db.regioneLegge.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("ritorna 500 su errore DB", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      regione: "LOM",
      _count: { province: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(0);
    vi.mocked(db.regioneLegge.delete).mockRejectedValue(new Error("DB error"));
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
  });
});

describe("autorizzazione: sessione senza permessi di configurazione", () => {
  it("ritorna 403 a un volontario su PUT e DELETE", async () => {
    mockCookiesFor({ ...ADMIN_SESSION, user: { ...ADMIN_SESSION.user, ruolo: "volontario" } } as typeof ADMIN_SESSION);
    const ctx = { params: Promise.resolve({ id: "1" }) };
    expect((await PUT(makeReq("PUT", {}), ctx)).status).toBe(403);
    expect((await DELETE(makeReq("DELETE"), ctx)).status).toBe(403);
  });
});
