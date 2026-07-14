/**
 * Test di integrazione per /api/config/province e /api/config/province/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => {
  const mockDb = {
    provincia: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    comune: { count: vi.fn() },
    user: { count: vi.fn() },
    regioneLegge: { findUnique: vi.fn() },
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
import { GET, POST } from "@/app/api/config/province/route";
import { PUT, DELETE } from "@/app/api/config/province/[id]/route";

const ADMIN_SESSION = {
  id: "s1", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: { id: "u1", email: "a@t.it", nomeCognome: "Admin", ruolo: "admin", provinciaId: null, regioneId: null, inizialiProtocollo: "AD", pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
};
const VOL_SESSION = {
  id: "s2", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: { id: "u2", email: "v@t.it", nomeCognome: "Vol", ruolo: "volontario", provinciaId: null, regioneId: null, inizialiProtocollo: "VL", pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
};

function mockSession(user: typeof ADMIN_SESSION | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as any);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as any);
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/config/province", {
    method, headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/config/province", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await GET(new NextRequest("http://localhost/api/config/province"));
    expect(res.status).toBe(401);
  });

  it("ritorna lista province per utenti autenticati", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.provincia.findMany).mockResolvedValue([{ id: 1, sigla: "BG", nome: "Bergamo" }] as any);
    const res = await GET(new NextRequest("http://localhost/api/config/province?regioneId=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.province).toHaveLength(1);
  });

  it("ritorna 400 se regioneId query param non è numerico", async () => {
    mockSession(VOL_SESSION);
    const res = await GET(new NextRequest("http://localhost/api/config/province?regioneId=abc"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("regioneId non valido");
  });
});

describe("POST /api/config/province", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se sigla non valida", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "B", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se regioneId mancante", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo" }));
    expect(res.status).toBe(400);
  });

  it("crea provincia valida ritorna 201", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.create).mockResolvedValue({ id: 1, sigla: "BG" } as any);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(201);
  });

  it("ritorna 400 se regioneId non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 500 su errore DB", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.provincia.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/config/province/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se provincia non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("aggiorna provincia valida", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.provincia.update).mockResolvedValue({ id: 1, sigla: "BG" } as any);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
  });

  it("ritorna 500 su errore DB", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.provincia.update).mockRejectedValue(new Error("DB error"));
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/config/province/[id] - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se ID non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID non valido");
  });

  it("ritorna 400 se regioneId è 0 (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 0 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se regioneId è null (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: null }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se regioneId è non numerico (isNaN true branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: "abc" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("regioneId non valido");
  });

  it("ritorna 400 se validazione fallisce (sigla troppo corta)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "B", nome: "Bergamo", regioneId: 1 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("includi pecArpaProvinciale se fornito", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.provincia.update).mockResolvedValue({ id: 1, sigla: "BG" } as any);
    await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1, pecArpaProvinciale: "arpa@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(db.provincia.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pecArpaProvinciale: "arpa@pec.it" }),
    }));
  });
});

describe("DELETE /api/config/province/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se provincia non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se ci sono comuni collegati", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1, _count: { comuni: 5, segnalazioni: 0 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("elimina provincia valida", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1, _count: { comuni: 0, segnalazioni: 0 },
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(0);
    vi.mocked(db.provincia.delete).mockResolvedValue({} as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
  });

  it("ritorna 400 se ci sono referenti provinciali assegnati", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1, _count: { comuni: 0, segnalazioni: 0 },
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(2);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/config/province/[id] - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se ID non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID non valido");
  });

  it("ritorna 400 se ci sono segnalazioni collegate", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1, _count: { comuni: 0, segnalazioni: 5 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazione");
  });

  it("ritorna 500 se db.provincia.delete solleva errore (catch block)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1, _count: { comuni: 0, segnalazioni: 0 },
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(0);
    vi.mocked(db.provincia.delete).mockRejectedValue(new Error("DB error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });

  it("ritorna 500 se db.provincia.findUnique solleva errore (catch block)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockRejectedValue(new Error("DB error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });
});
