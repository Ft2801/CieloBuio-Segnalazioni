/**
 * Test di integrazione per /api/config/regioni
 * Copre: GET (admin, non-admin, non autenticato), POST (creazione, validazione, errori)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    regioneLegge: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    provincia: { count: vi.fn() },
    sessione: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/config/regioni/route";

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
  id: "s1",
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

describe("GET /api/config/regioni", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockCookiesFor(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna lista regioni per ogni utente autenticato (anche volontario)", async () => {
    // GET non ha check admin: serve per popolare i dropdown nei form
    mockCookiesFor(VOL_SESSION);
    vi.mocked(db.regioneLegge.findMany).mockResolvedValue([
      { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15" },
    ] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.regioni).toHaveLength(1);
    expect(json.regioni[0].regione).toBe("LOMBARDIA");
  });

  it("ritorna lista regioni per admin", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findMany).mockResolvedValue([
      { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15" },
    ] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.regioni).toHaveLength(1);
  });
});

describe("POST /api/config/regioni", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato (nessun cookie)", async () => {
    // Senza sessione la risposta è 401; con sessione senza permessi è 403.
    mockCookiesFor(null);
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per non-admin (volontario)", async () => {
    mockCookiesFor(VOL_SESSION);
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regione: "X", riferimentoLegge: "Y" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se campi obbligatori mancanti", async () => {
    mockCookiesFor(ADMIN_SESSION);
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regione: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se PEC ARPA non valida", async () => {
    mockCookiesFor(ADMIN_SESSION);
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regione: "X", riferimentoLegge: "Y", pecArpaRegionale: "not-email" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("crea regione valida ritorna 201", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.create).mockResolvedValue({
      id: 1,
      regione: "LOMBARDIA",
      riferimentoLegge: "L.R. 31/15",
    } as never);
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.regione.id).toBe(1);
  });

  it("ritorna 500 su errore DB con dati validi", async () => {
    mockCookiesFor(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.create).mockRejectedValue(new Error("DB error"));
    const req = new NextRequest("http://localhost/api/config/regioni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
