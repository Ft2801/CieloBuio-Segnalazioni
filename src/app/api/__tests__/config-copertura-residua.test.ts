/**
 * Copertura dei rami residui delle route di configurazione territoriale
 * (/api/config/{province,regioni,comuni,users}): corpo non valido, errori
 * Prisma (P2002, P2025, codici non previsti), eccezioni non Error e rami dei
 * vincoli ruolo/territorio in PATCH e POST.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { mockHash } = vi.hoisted(() => ({
  mockHash: vi.fn(),
}));
vi.mock("bcryptjs", () => ({
  default: { hash: mockHash },
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    provincia: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    regioneLegge: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comune: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    segnalazione: { count: vi.fn() },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
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
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { GET as GET_PROVINCE, POST as POST_PROVINCIA } from "@/app/api/config/province/route";
import { POST as POST_REGIONE } from "@/app/api/config/regioni/route";
import { POST as POST_COMUNE } from "@/app/api/config/comuni/route";
import { POST as POST_USER } from "@/app/api/config/users/route";
import { PUT as PUT_COMUNE } from "@/app/api/config/comuni/[id]/route";
import { PATCH as PATCH_USER } from "@/app/api/config/users/[id]/route";
import { DELETE as DELETE_PROVINCIA } from "@/app/api/config/province/[id]/route";
import { DELETE as DELETE_REGIONE } from "@/app/api/config/regioni/[id]/route";

const ADMIN_SESSION = {
  id: "s1",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-admin",
    email: "admin@t.it",
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

function mockSession(user: unknown) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

function makeReq(method: string, url: string, body?: unknown, raw?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function erroreNoto(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("errore prisma", {
    code,
    clientVersion: "test",
  });
}

const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStoreForTests();
  mockSession(ADMIN_SESSION);
  vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1 } as never);
  vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1 } as never);
  vi.mocked(db.comune.findUnique).mockResolvedValue({ id: 1 } as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: "u-1",
    email: "u@t.it",
    nomeCognome: "Utente",
    ruolo: "volontario",
    provinciaId: null,
    regioneId: null,
    attivo: true,
  } as never);
  vi.mocked(db.user.update).mockResolvedValue({ id: "u-1" } as never);
  vi.mocked(db.user.count).mockResolvedValue(2 as never);
  vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
  mockHash.mockResolvedValue("hash-finto");
});

// -----------------------------------------------------------------------------
// GET /api/config/province (senza filtro regioneId)
// -----------------------------------------------------------------------------

describe("GET /api/config/province - senza filtro", () => {
  it("restituisce tutte le province quando regioneId non è presente", async () => {
    vi.mocked(db.provincia.findMany).mockResolvedValue([{ id: 1, sigla: "BG" }] as never);
    const res = await GET_PROVINCE(makeReq("GET", "/api/config/province"));
    expect(res.status).toBe(200);
    expect((await res.json()).province).toEqual([{ id: 1, sigla: "BG" }]);
    expect(vi.mocked(db.provincia.findMany).mock.calls[0][0]).not.toHaveProperty("where.regioneId");
  });
});

// -----------------------------------------------------------------------------
// POST /api/config/province
// -----------------------------------------------------------------------------

describe("POST /api/config/province - rami residui", () => {
  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await POST_PROVINCIA(makeReq("POST", "/api/config/province", undefined, "non-json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 con messaggio dedicato se la sigla è già presente (P2002)", async () => {
    vi.mocked(db.provincia.create).mockRejectedValue(erroreNoto("P2002"));
    const res = await POST_PROVINCIA(
      makeReq("POST", "/api/config/province", { sigla: "BG", nome: "Bergamo", regioneId: 1 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Sigla già presente");
  });
});

// -----------------------------------------------------------------------------
// POST /api/config/regioni
// -----------------------------------------------------------------------------

describe("POST /api/config/regioni - rami residui", () => {
  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await POST_REGIONE(makeReq("POST", "/api/config/regioni", undefined, "[]"));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 con messaggio dedicato se il nome regione è già presente (P2002)", async () => {
    vi.mocked(db.regioneLegge.create).mockRejectedValue(erroreNoto("P2002"));
    const res = await POST_REGIONE(
      makeReq("POST", "/api/config/regioni", {
        regione: "Lombardia",
        riferimentoLegge: "LR 17/2000",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Esiste già una regione con questo nome");
  });
});

// -----------------------------------------------------------------------------
// POST /api/config/comuni
// -----------------------------------------------------------------------------

describe("POST /api/config/comuni - rami residui", () => {
  const comuneValido = { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "comune@pec.it" };

  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await POST_COMUNE(makeReq("POST", "/api/config/comuni", undefined, "non-json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 se provinciaId non è un intero", async () => {
    const res = await POST_COMUNE(makeReq("POST", "/api/config/comuni", { ...comuneValido, provinciaId: "abc" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("provinciaId non valido");
  });

  it("ritorna 400 con messaggio dedicato se il comune esiste già (P2002)", async () => {
    vi.mocked(db.comune.create).mockRejectedValue(erroreNoto("P2002"));
    const res = await POST_COMUNE(makeReq("POST", "/api/config/comuni", comuneValido));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comune già presente in questa provincia");
  });
});

// -----------------------------------------------------------------------------
// PUT /api/config/comuni/[id]
// -----------------------------------------------------------------------------

describe("PUT /api/config/comuni/[id] - codici Prisma non gestiti", () => {
  it("un errore Prisma con codice non previsto ricade nella risposta 500", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      provinciaId: 1,
      _count: { segnalazioni: 0 },
    } as never);
    vi.mocked(db.comune.update).mockRejectedValue(erroreNoto("P2099"));
    const res = await PUT_COMUNE(
      makeReq("PUT", "/api/config/comuni/1", { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "c@pec.it" }),
      p("1"),
    );
    expect(res.status).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// DELETE: eccezione non Error (ramo String(e))
// -----------------------------------------------------------------------------

describe("DELETE config - eccezione non Error", () => {
  it("province: una eccezione non Error produce 500", async () => {
    vi.mocked(db.provincia.findUnique).mockRejectedValueOnce("boom");
    const res = await DELETE_PROVINCIA(makeReq("DELETE", "/api/config/province/1"), p("1"));
    expect(res.status).toBe(500);
  });

  it("regioni: una eccezione non Error produce 500", async () => {
    vi.mocked(db.regioneLegge.findUnique).mockRejectedValueOnce("boom");
    const res = await DELETE_REGIONE(makeReq("DELETE", "/api/config/regioni/1"), p("1"));
    expect(res.status).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// POST /api/config/users - regione passata nel corpo
// -----------------------------------------------------------------------------

describe("POST /api/config/users - regione", () => {
  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await POST_USER(makeReq("POST", "/api/config/users", undefined, "non-json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("converte regioneId numerico e lo salva sul nuovo utente", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "u-new" } as never);
    const res = await POST_USER(
      makeReq("POST", "/api/config/users", {
        email: "nuovo@t.it",
        nomeCognome: "Nuovo Utente",
        password: "PasswordSicura!1",
        ruolo: "referente_regionale",
        regioneId: 2,
      }),
    );
    expect(res.status).toBe(201);
    const data = vi.mocked(db.user.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.regioneId).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// PATCH /api/config/users/[id] - vincoli ruolo/territorio
// -----------------------------------------------------------------------------

describe("PATCH /api/config/users/[id] - rami dei campi opzionali", () => {
  it("un PATCH con il solo campo attivo non modifica gli altri campi", async () => {
    const res = await PATCH_USER(makeReq("PATCH", "/api/config/users/u-1", { attivo: false }), p("u-1"));
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data).toEqual({ attivo: false });
  });

  it("un volontario con provinciaId esplicito viene rifiutato: il ruolo non ammette territorio", async () => {
    const res = await PATCH_USER(
      makeReq("PATCH", "/api/config/users/u-1", { ruolo: "volontario", provinciaId: 3 }),
      p("u-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("non devono avere territorio assegnato");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("un admin con regioneId esplicito viene rifiutato: il ruolo non ammette territorio", async () => {
    const res = await PATCH_USER(makeReq("PATCH", "/api/config/users/u-1", { ruolo: "admin", regioneId: 4 }), p("u-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("non devono avere territorio assegnato");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("un referente regionale con provinciaId e regioneId espliciti salva entrambi i valori indicati", async () => {
    const res = await PATCH_USER(
      makeReq("PATCH", "/api/config/users/u-1", { ruolo: "referente_regionale", provinciaId: 5, regioneId: 2 }),
      p("u-1"),
    );
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.provinciaId).toBe(5);
    expect(data.data.regioneId).toBe(2);
  });

  it("un referente provinciale senza regioneId esplicito azzera la regione", async () => {
    const res = await PATCH_USER(
      makeReq("PATCH", "/api/config/users/u-1", { ruolo: "referente_provinciale", provinciaId: 5 }),
      p("u-1"),
    );
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.regioneId).toBeNull();
    expect(data.data.provinciaId).toBe(5);
  });

  it("un referente regionale senza provinciaId esplicito azzera la provincia", async () => {
    const res = await PATCH_USER(
      makeReq("PATCH", "/api/config/users/u-1", { ruolo: "referente_regionale", regioneId: 2 }),
      p("u-1"),
    );
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.provinciaId).toBeNull();
    expect(data.data.regioneId).toBe(2);
  });
});

describe("PATCH /api/config/users/[id] - valori vuoti e iniziali nulle", () => {
  it("una stringa vuota in pec viene salvata come null", async () => {
    const res = await PATCH_USER(makeReq("PATCH", "/api/config/users/u-1", { pec: "" }), p("u-1"));
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.pec).toBeNull();
  });

  it("iniziali nulle vengono salvate come null senza conversione maiuscola", async () => {
    const res = await PATCH_USER(makeReq("PATCH", "/api/config/users/u-1", { inizialiProtocollo: null }), p("u-1"));
    expect(res.status).toBe(200);
    const data = vi.mocked(db.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.inizialiProtocollo).toBeNull();
  });
});
