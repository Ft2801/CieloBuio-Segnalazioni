/**
 * Test di integrazione per /api/config/comuni e /api/config/comuni/[id]
 * Copre: GET (admin/non-autenticato), POST (creazione, validazione, errori),
 *        PUT (modifica, 404, validazione), DELETE (404, segnalazioni collegate, errori)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    comune: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    sessione: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/config/comuni/route";
import { PUT, DELETE } from "@/app/api/config/comuni/[id]/route";

const ADMIN_SESSION = {
  id: "s1", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u1", email: "a@t.it", nomeCognome: "Admin", ruolo: "admin",
    provinciaId: null, regioneId: null, inizialiProtocollo: "AD",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};
const VOL_SESSION = {
  id: "s2", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u2", email: "v@t.it", nomeCognome: "Volontario", ruolo: "volontario",
    provinciaId: null, regioneId: null, inizialiProtocollo: "VL",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};

function mockSession(user: any) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as any);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as any);
}

function makeReq(method: string, body?: unknown, url = "http://localhost/api/config/comuni"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/config/comuni", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });

  it("ritorna lista comuni per utente autenticato (volontario)", async () => {
    // GET non ha check admin: serve per popolare i dropdown nei form
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findMany).mockResolvedValue([
      { id: 1, nome: "Bergamo", provincia: { sigla: "BG", nome: "Bergamo", regione: { regione: "LOMBARDIA" } } },
    ] as any);
    vi.mocked(db.comune.count).mockResolvedValue(1);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comuni).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.truncated).toBe(false);
  });

  it("segnala truncated=true quando il totale supera il limite", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findMany).mockResolvedValue([] as any);
    // Senza search il limite è 500: con total=600 deve risultare truncated
    vi.mocked(db.comune.count).mockResolvedValue(600);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.truncated).toBe(true);
  });

  it("passa i filtri provinciaId e search alla query", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findMany).mockResolvedValue([] as any);
    vi.mocked(db.comune.count).mockResolvedValue(0);
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/config/comuni?provinciaId=3&search=berg"));
    expect(res.status).toBe(200);
    expect(db.comune.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { provinciaId: 3, nome: { contains: "berg", mode: "insensitive" } },
      take: 50,
    }));
  });
  it("ritorna 400 se provinciaId query param non è numerico", async () => {
    mockSession(VOL_SESSION);
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/config/comuni?provinciaId=abc"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("provinciaId non valido");
  });
});

describe("POST /api/config/comuni", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non autenticato (no cookie -> 403, non 401)", async () => {
    // POST ha check `!user || !canManageConfiguration(user)` -> 403 per entrambi i casi
    mockSession(null);
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 per non-admin (volontario)", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeReq("POST", { nome: "X", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }));
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se provinciaId non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { nome: "X", provinciaId: "abc", cap: "24100", pecComune: "x@pec.it" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("provinciaId");
  });

  it("ritorna 400 se nome mancante", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se cap non ha 5 cifre", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { nome: "Bergamo", provinciaId: 1, cap: "1234", pecComune: "x@pec.it" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se cap contiene lettere", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { nome: "Bergamo", provinciaId: 1, cap: "12a45", pecComune: "x@pec.it" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se pecComune non valida", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "non-email" }));
    expect(res.status).toBe(400);
  });

  it("crea comune valido ritorna 201", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.create).mockResolvedValue({
      id: 10, nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it",
    } as any);
    const res = await POST(makeReq("POST", {
      nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it",
      nomeSindaco: "Mario Rossi", noteAggiornamento: "verificato",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.comune.id).toBe(10);
  });

  it("normalizza campi opzionali vuoti a null", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.create).mockResolvedValue({ id: 11 } as any);
    await POST(makeReq("POST", {
      nome: "Vuoto", provinciaId: 1, cap: "24100", pecComune: "x@pec.it",
      nomeSindaco: "", noteAggiornamento: "",
    }));
    expect(db.comune.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nomeSindaco: null, noteAggiornamento: null }),
    }));
  });

  it("ritorna 400 se provinciaId è 0 (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", {
      nome: "X", provinciaId: 0, cap: "24100", pecComune: "x@pec.it",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se provinciaId è null (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", {
      nome: "X", provinciaId: null, cap: "24100", pecComune: "x@pec.it",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 500 su errore DB con dati validi", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makeReq("POST", { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }));
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/config/comuni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await PUT(makeReq("PUT", { nome: "X" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se ID non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { nome: "X", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se provinciaId non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { nome: "X", provinciaId: "xyz", cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se provinciaId è 0 (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { nome: "X", provinciaId: 0, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se validazione fallisce (nome vuoto)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { nome: "", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 404 se comune non trovato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { nome: "X", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("aggiorna comune valido ritorna 200", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({ id: 1, nome: "Vecchio" } as any);
    vi.mocked(db.comune.update).mockResolvedValue({ id: 1, nome: "Nuovo" } as any);
    const res = await PUT(makeReq("PUT", { nome: "Nuovo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comune.nome).toBe("Nuovo");
  });

  it("ritorna 500 su errore DB in update", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.comune.update).mockRejectedValue(new Error("DB error"));
    const res = await PUT(makeReq("PUT", { nome: "X", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/config/comuni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se ID non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 404 se comune non trovato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se ci sono segnalazioni collegate", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, nome: "Bergamo",
      _count: { segnalazioni: 3 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazione");
  });

  it("elimina comune valido ritorna 200", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, nome: "Bergamo",
      _count: { segnalazioni: 0 },
    } as any);
    vi.mocked(db.comune.delete).mockResolvedValue({} as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("ritorna 500 su errore DB in delete", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, nome: "Bergamo",
      _count: { segnalazioni: 0 },
    } as any);
    vi.mocked(db.comune.delete).mockRejectedValue(new Error("DB error"));
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(500);
  });
});
