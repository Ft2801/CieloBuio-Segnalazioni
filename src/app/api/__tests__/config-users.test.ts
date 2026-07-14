/**
 * Test di integrazione per /api/config/users e /api/config/users/[id]
 * Copre: GET (admin/non-admin), POST (creazione, validazione, errori, rate limit),
 *        PATCH (modifica, casi speciali auto-blocco, ultimo admin, reset password),
 *        DELETE (404, segnalazioni collegate, auto-eliminazione, errori)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    user: {
      findMany: vi.fn(),
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
import { GET, POST } from "@/app/api/config/users/route";
import { PATCH, DELETE } from "@/app/api/config/users/[id]/route";

const ADMIN_SESSION = {
  id: "s1", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-admin", email: "admin@t.it", nomeCognome: "Admin", ruolo: "admin",
    provinciaId: null, regioneId: null, inizialiProtocollo: "AD",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};
const VOL_SESSION = {
  id: "s2", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-vol", email: "vol@t.it", nomeCognome: "Volontario", ruolo: "volontario",
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

function makeReq(method: string, body?: unknown, url = "http://localhost/api/config/users"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const VALID_PASSWORD = "Str0ngP@ssw0rd!";

describe("GET /api/config/users", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non autenticato (no cookie -> 403)", async () => {
    // GET ha check `!user || !canManageConfiguration(user)` -> 403 per entrambi i casi
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("ritorna 403 per volontario", async () => {
    mockSession(VOL_SESSION);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("ritorna lista utenti per admin", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: "u1", email: "a@t.it", nomeCognome: "A", ruolo: "admin", attivo: true },
    ] as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.users).toHaveLength(1);
  });
});

describe("POST /api/config/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockHash.mockResolvedValue("hashed-pwd");
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 403 se non autenticato (no cookie -> 403)", async () => {
    mockSession(null);
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 per non-admin (volontario)", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeReq("POST", { email: "x@t.it", nomeCognome: "X", password: VALID_PASSWORD }));
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se email mancante", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { nomeCognome: "X", password: VALID_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se email non valida", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { email: "non-email", nomeCognome: "X", password: VALID_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se password troppo debole (meno di 12 caratteri)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { email: "x@t.it", nomeCognome: "X", password: "Short1!" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se password senza carattere speciale", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { email: "x@t.it", nomeCognome: "X", password: "Password1234" }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se nomeCognome mancante", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", { email: "x@t.it", password: VALID_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se inizialiProtocollo non hanno 2 caratteri", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makeReq("POST", {
      email: "x@t.it", nomeCognome: "X", password: VALID_PASSWORD, inizialiProtocollo: "ABC",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se email già in uso (check pre-creazione)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "existing" } as any);
    const res = await POST(makeReq("POST", {
      email: "existing@t.it", nomeCognome: "X", password: VALID_PASSWORD,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Email già in uso");
  });

  it("crea utente valido ritorna 201", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({
      id: "new-1", email: "new@t.it", nomeCognome: "New User", ruolo: "volontario",
    } as any);
    const res = await POST(makeReq("POST", {
      email: "new@t.it", nomeCognome: "New User", password: VALID_PASSWORD,
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.id).toBe("new-1");
    expect(mockHash).toHaveBeenCalledWith(VALID_PASSWORD, 12);
  });

  it("maiuscolizza inizialiProtocollo durante la creazione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "x" } as any);
    await POST(makeReq("POST", {
      email: "x@t.it", nomeCognome: "X", password: VALID_PASSWORD, inizialiProtocollo: "ab",
    }));
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inizialiProtocollo: "AB" }),
    }));
  });

  it("ritorna 400 se race condition su email duplicata (P2002)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    vi.mocked(db.user.create).mockRejectedValue(prismaError);
    const res = await POST(makeReq("POST", {
      email: "race@t.it", nomeCognome: "X", password: VALID_PASSWORD,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Email già in uso");
  });

  it("ritorna 500 su errore DB generico", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makeReq("POST", {
      email: "x@t.it", nomeCognome: "X", password: VALID_PASSWORD,
    }));
    expect(res.status).toBe(500);
  });

  it("rate limit: blocca al 31esimo tentativo (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "x" } as any);
    // 30 tentativi permessi, al 31° scatta il blocco
    for (let i = 0; i < 30; i++) {
      const res = await POST(makeReq("POST", {
        email: `u${i}@t.it`, nomeCognome: "X", password: VALID_PASSWORD,
      }));
      expect(res.status).toBe(201);
    }
    // 31° tentativo: bloccato dal rate limit
    const res = await POST(makeReq("POST", {
      email: "blocked@t.it", nomeCognome: "X", password: VALID_PASSWORD,
    }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppe creazioni");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("normalizza provinciaId=0 e regioneId=0 a null (falsy ternary branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "x" } as any);
    await POST(makeReq("POST", {
      email: "zero@t.it", nomeCognome: "X", password: VALID_PASSWORD,
      provinciaId: 0, regioneId: 0,
    }));
    // provinciaId=0 e regioneId=0 sono falsy → ternary ritorna null
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provinciaId: null, regioneId: null }),
    }));
  });

  it("normalizza provinciaId=null e regioneId=null a null (falsy ternary branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "x" } as any);
    await POST(makeReq("POST", {
      email: "null@t.it", nomeCognome: "X", password: VALID_PASSWORD,
      provinciaId: null, regioneId: null,
    }));
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provinciaId: null, regioneId: null }),
    }));
  });

  it("crea utente con provinciaId e regioneId numerici (truthy ternary branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue({ id: "x" } as any);
    await POST(makeReq("POST", {
      email: "terr@t.it", nomeCognome: "X", password: VALID_PASSWORD,
      ruolo: "referente_provinciale",
      provinciaId: 5,
    }));
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provinciaId: 5, ruolo: "referente_provinciale" }),
    }));
  });
});

describe("PATCH /api/config/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockHash.mockResolvedValue("hashed-pwd");
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await PATCH(makeReq("PATCH", { nomeCognome: "X" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se email non valida", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PATCH(makeReq("PATCH", { email: "not-email" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se inizialiProtocollo non ha 2 caratteri", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PATCH(makeReq("PATCH", { inizialiProtocollo: "X" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se newPassword non rispetta la policy", async () => {
    mockSession(ADMIN_SESSION);
    const res = await PATCH(makeReq("PATCH", { newPassword: "weak" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 404 se utente non trovato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeReq("PATCH", { nomeCognome: "Nuovo" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se email cambiata ma già in uso da altro utente", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({ id: "u1", email: "old@t.it", ruolo: "volontario" } as any) // existing user
      .mockResolvedValueOnce({ id: "u2", email: "taken@t.it" } as any); // email già in uso
    const res = await PATCH(makeReq("PATCH", { email: "taken@t.it" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Email già in uso");
  });

  it("admin non può disattivare sé stesso (400)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-admin", email: "admin@t.it", ruolo: "admin", attivo: true,
    } as any);
    const res = await PATCH(makeReq("PATCH", { attivo: false }), { params: Promise.resolve({ id: "u-admin" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("disattivare il tuo stesso account");
  });

  it("admin non può rimuovere il proprio ruolo admin (400)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-admin", email: "admin@t.it", ruolo: "admin", attivo: true,
    } as any);
    const res = await PATCH(makeReq("PATCH", { ruolo: "volontario" }), { params: Promise.resolve({ id: "u-admin" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ruolo amministratore");
  });

  it("non può disattivare l'ultimo admin attivo (400)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "other@t.it", ruolo: "admin", attivo: true,
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(0); // nessun altro admin attivo
    const res = await PATCH(makeReq("PATCH", { attivo: false }), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ultimo amministratore");
  });

  it("non può declassare l'ultimo admin attivo (400)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "other@t.it", ruolo: "admin", attivo: true,
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(0);
    const res = await PATCH(makeReq("PATCH", { ruolo: "volontario" }), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ultimo amministratore");
  });

  it("permette di disattivare un admin se ce n'è almeno un altro attivo (200)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "other@t.it", ruolo: "admin", attivo: true,
    } as any);
    vi.mocked(db.user.count).mockResolvedValue(1); // c'è un altro admin attivo
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u-other", email: "other@t.it", ruolo: "admin", attivo: false,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 2 } as any);
    const res = await PATCH(makeReq("PATCH", { attivo: false }), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(200);
    // Verifica invalidazione sessioni triggerata dal cambio attivo
    expect(db.sessione.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-other" } });
  });

  it("modifica semplice (solo nomeCognome) non invalida sessioni", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "Nuovo Nome", ruolo: "volontario", attivo: true,
    } as any);
    const res = await PATCH(makeReq("PATCH", { nomeCognome: "Nuovo Nome" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(200);
    expect(db.sessione.deleteMany).not.toHaveBeenCalled();
  });

  it("reset password invalida le sessioni dell'utente", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 3 } as any);
    const res = await PATCH(makeReq("PATCH", { newPassword: VALID_PASSWORD }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(200);
    expect(mockHash).toHaveBeenCalledWith(VALID_PASSWORD, 12);
    expect(db.sessione.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("cambio ruolo invalida le sessioni dell'utente", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "referente_provinciale", attivo: true,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 1 } as any);
    const res = await PATCH(makeReq("PATCH", { ruolo: "referente_provinciale", provinciaId: 1 }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(200);
    expect(db.sessione.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("non blocca PATCH se deleteMany sessioni fallisce (best-effort)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: false,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockRejectedValue(new Error("DB error"));
    const res = await PATCH(makeReq("PATCH", { attivo: false }), { params: Promise.resolve({ id: "u1" }) });
    // Anche se l'invalidazione sessioni fallisce, la PATCH ritorna 200
    expect(res.status).toBe(200);
  });

  it("maiuscolizza inizialiProtocollo durante la modifica", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    await PATCH(makeReq("PATCH", { inizialiProtocollo: "xy" }), { params: Promise.resolve({ id: "u1" }) });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inizialiProtocollo: "XY" }),
    }));
  });

  it("PATCH con provinciaId=null imposta provinciaId a null (inner ternary true)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    await PATCH(makeReq("PATCH", { provinciaId: null }), { params: Promise.resolve({ id: "u1" }) });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provinciaId: null }),
    }));
  });

  it("PATCH con regioneId=null imposta regioneId a null (inner ternary true)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    await PATCH(makeReq("PATCH", { regioneId: null }), { params: Promise.resolve({ id: "u1" }) });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ regioneId: null }),
    }));
  });

  it("PATCH con email uguale a quella esistente (data.email !== undefined branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "same@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "same@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    await PATCH(makeReq("PATCH", { email: "same@t.it" }), { params: Promise.resolve({ id: "u1" }) });
    // data.email !== undefined → updateData.email = data.email
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "same@t.it" }),
    }));
  });

  it("PATCH con regioneId numerico (data.regioneId !== undefined branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as any);
    await PATCH(makeReq("PATCH", { regioneId: 2 }), { params: Promise.resolve({ id: "u1" }) });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ regioneId: 2 }),
    }));
  });

  it("ritorna 500 su errore DB in update", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockRejectedValue(new Error("DB error"));
    const res = await PATCH(makeReq("PATCH", { nomeCognome: "Nuovo" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(500);
  });

  it("rate limit: blocca al 31esimo tentativo (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1", email: "x@t.it", ruolo: "volontario", attivo: true,
    } as any);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "u1", email: "x@t.it", nomeCognome: "X", ruolo: "volontario", attivo: true,
    } as any);
    // 30 modifiche permesse, al 31° scatta il blocco
    for (let i = 0; i < 30; i++) {
      const res = await PATCH(makeReq("PATCH", { nomeCognome: `N${i}` }), { params: Promise.resolve({ id: "u1" }) });
      expect(res.status).toBe(200);
    }
    const res = await PATCH(makeReq("PATCH", { nomeCognome: "Blocked" }), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppe modifiche");
  });
});

describe("DELETE /api/config/users/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 403 se non admin", async () => {
    mockSession(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se utente non trovato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u1" }) });
    expect(res.status).toBe(404);
  });

  it("non può eliminare sé stesso (400)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-admin", email: "admin@t.it", ruolo: "admin",
      _count: { segnalazioni: 0, segnalazioniApprovate: 0 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u-admin" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("tuo stesso account");
  });

  it("ritorna 400 se l'utente ha segnalazioni collegate come volontario", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "x@t.it", ruolo: "volontario",
      _count: { segnalazioni: 2, segnalazioniApprovate: 0 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazioni collegate");
  });

  it("ritorna 400 se l'utente ha segnalazioni approvate come referente", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "x@t.it", ruolo: "referente_provinciale",
      _count: { segnalazioni: 0, segnalazioniApprovate: 5 },
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(400);
  });

  it("elimina utente valido ritorna 200", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "x@t.it", ruolo: "volontario",
      _count: { segnalazioni: 0, segnalazioniApprovate: 0 },
    } as any);
    vi.mocked(db.user.delete).mockResolvedValue({} as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("ritorna 500 su errore DB in delete", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other", email: "x@t.it", ruolo: "volontario",
      _count: { segnalazioni: 0, segnalazioniApprovate: 0 },
    } as any);
    vi.mocked(db.user.delete).mockRejectedValue(new Error("DB error"));
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "u-other" }) });
    expect(res.status).toBe(500);
  });
});
