/**
 * Test di integrazione per /api/config/province e /api/config/province/[id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

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
const VOL_SESSION = {
  id: "s2",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u2",
    email: "v@t.it",
    nomeCognome: "Vol",
    ruolo: "volontario",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "VL",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};

function mockSession(user: typeof ADMIN_SESSION | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

function erroreNoto(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("errore prisma", {
    code,
    clientVersion: "test",
  });
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/config/province", {
    method,
    headers: { "Content-Type": "application/json" },
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
    vi.mocked(db.provincia.findMany).mockResolvedValue([{ id: 1, sigla: "BG", nome: "Bergamo" }] as never);
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

  it.each(["1e3", "2147483648", "0"])("rifiuta il filtro regioneId fuori formato: %s", async (id) => {
    mockSession(VOL_SESSION);
    const res = await GET(new NextRequest(`http://localhost/api/config/province?regioneId=${id}`));
    expect(res.status).toBe(400);
    expect(db.provincia.findMany).not.toHaveBeenCalled();
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

  it.each([false, 0])("rifiuta pecArpaProvinciale di tipo errato nella creazione: %j", async (valore) => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1, pecArpaProvinciale: valore }));
    expect(res.status).toBe(400);
    expect(db.provincia.create).not.toHaveBeenCalled();
  });

  it("crea provincia valida ritorna 201", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.create).mockResolvedValue({ id: 1, sigla: "BG" } as never);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(201);
  });

  it("ritorna 400 se regioneId non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: "abc" }));
    expect(res.status).toBe(400);
  });

  it.each([true, [1], "1e3", 2147483648])("rifiuta regioneId di tipo errato o fuori Int32: %j", async (id) => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: id }));
    expect(res.status).toBe(400);
    expect(db.provincia.create).not.toHaveBeenCalled();
  });

  it("interpreta la stringa numerica regioneId inviata dal menu", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.create).mockResolvedValue({ id: 1 } as never);
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: "1" }));
    expect(res.status).toBe(201);
    expect(db.provincia.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ regioneId: 1 }) }),
    );
  });

  it("ritorna 400 se la regione non esiste (violazione di chiave esterna)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.create).mockRejectedValue(erroreNoto("P2003"));
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 999 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Regione non trovata");
  });

  it("ritorna 500 su errore DB", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makeReq("POST", { sigla: "BG", nome: "Bergamo", regioneId: 1 }));
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/config/province/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non admin", async () => {
    mockSession(null);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se provincia non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it.each([false, 0])("rifiuta pecArpaProvinciale di tipo errato nella modifica: %j", async (valore) => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1, pecArpaProvinciale: valore }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    expect(db.provincia.update).not.toHaveBeenCalled();
  });

  it("aggiorna provincia valida", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockResolvedValue({ id: 1, sigla: "BG" } as never);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
  });

  it("ritorna 400 se la regione non esiste (violazione di chiave esterna)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockRejectedValue(erroreNoto("P2003"));
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 999 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Regione non trovata o territorio collegato a segnalazioni. Verificare i dati e ricaricare la pagina.",
    );
  });

  it("ritorna 500 su errore DB", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockRejectedValue(new Error("DB error"));
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/config/province/[id] - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se ID non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID non valido");
  });

  it("ritorna 400 se regioneId è 0 (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 0 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se regioneId è null (falsy, ternary false branch)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: null }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se regioneId è non numerico", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: "abc" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("regioneId non valido");
  });

  it.each([true, [1], 2147483648])("rifiuta regioneId malformato in modifica: %j", async (id) => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: id }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    expect(db.provincia.update).not.toHaveBeenCalled();
  });

  it("ritorna 400 se validazione fallisce (sigla troppo corta)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PUT(makeReq("PUT", { sigla: "B", nome: "Bergamo", regioneId: 1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
  });

  it("includi pecArpaProvinciale se fornito", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockResolvedValue({ id: 1, sigla: "BG" } as never);
    await PUT(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1, pecArpaProvinciale: "arpa@pec.it" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(db.provincia.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pecArpaProvinciale: "arpa@pec.it" }),
      }),
    );
  });
});

describe("DELETE /api/config/province/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non admin", async () => {
    mockSession(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
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
      id: 1,
      _count: { comuni: 5, segnalazioni: 0 },
    } as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("elimina provincia valida", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1,
      _count: { comuni: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(0);
    vi.mocked(db.provincia.delete).mockResolvedValue({} as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
  });

  it("ritorna 400 se ci sono referenti provinciali assegnati", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1,
      _count: { comuni: 0, segnalazioni: 0 },
    } as never);
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
      id: 1,
      _count: { comuni: 0, segnalazioni: 5 },
    } as never);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazione");
  });

  it("ritorna 500 se db.provincia.delete solleva errore (catch block)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1,
      _count: { comuni: 0, segnalazioni: 0 },
    } as never);
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

describe("autorizzazione: sessione senza permessi di configurazione", () => {
  it("ritorna 401 senza sessione su POST", async () => {
    mockSession(null);
    expect((await POST(makeReq("POST", {}))).status).toBe(401);
  });

  it("ritorna 403 a un volontario su POST, PUT e DELETE", async () => {
    mockSession(VOL_SESSION);
    const ctx = { params: Promise.resolve({ id: "1" }) };
    expect((await POST(makeReq("POST", {}))).status).toBe(403);
    expect((await PUT(makeReq("PUT", {}), ctx)).status).toBe(403);
    expect((await DELETE(makeReq("DELETE"), ctx)).status).toBe(403);
  });
});
