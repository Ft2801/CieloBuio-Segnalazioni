/**
 * Test di integrazione per /api/stats
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET } from "@/app/api/stats/route";

function mockAdminSession() {
  vi.mocked(db.sessione.findUnique).mockResolvedValue({
    id: "s1",
    token: "tok",
    scadenza: new Date(Date.now() + 10000),
    user: {
      id: "u1", email: "a@t.it", nomeCognome: "Admin",
      ruolo: "admin", provinciaId: null, regioneId: null,
      inizialiProtocollo: "AD", pec: null, emailOrdinaria: null,
      indirizzo: null, firma: null, attivo: true,
    },
  } as any);
}

describe("GET /api/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 401 se non autenticato (no cookie)", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna 401 se sessione non trovata", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna 401 se utente non attivo", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1", token: "tok", scadenza: new Date(Date.now() + 10000),
      user: { id: "u1", email: "a@t.it", nomeCognome: "N", ruolo: "admin", provinciaId: null, regioneId: null, inizialiProtocollo: null, pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: false },
    } as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna le statistiche per admin", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    mockAdminSession();
    vi.mocked(db.segnalazione.count).mockResolvedValue(5);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totali).toBe(5);
    expect(json.bozze).toBe(5);
    expect(json.inRevisione).toBe(5);
    expect(json.approvate).toBe(5);
    expect(json.inviate).toBe(5);
    expect(json.inAttesa).toBe(5);
    expect(json.chiusePositive).toBe(5);
    expect(json.chiuseNegative).toBe(5);
    expect(json.recidive).toBe(5);
    expect(json.inAttesaOverdue).toBe(5);
  });
});
