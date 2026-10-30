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
      delete: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET } from "@/app/api/stats/route";
import { getReminderGiorni } from "@/lib/cron-utils";

function mockAdminSession() {
  vi.mocked(db.sessione.findUnique).mockResolvedValue({
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
  } as never);
}

describe("GET /api/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 401 se non autenticato (no cookie)", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna 401 se sessione non trovata", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as never);
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna 401 se utente non attivo", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as never);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "tok",
      scadenza: new Date(Date.now() + 10000),
      user: {
        id: "u1",
        email: "a@t.it",
        nomeCognome: "N",
        ruolo: "admin",
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
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("ritorna le statistiche per admin, ciascuna calcolata dal suo filtro", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as never);
    mockAdminSession();
    // Ogni count restituisce un valore diverso in base al filtro ricevuto:
    // uno scambio tra campi della risposta farebbe fallire il test.
    const perStato: Record<string, number> = {
      bozza: 10,
      in_revisione: 11,
      approvata: 12,
      inviata: 13,
      in_attesa: 14,
      chiusa_positiva: 15,
      chiusa_negativa: 16,
    };
    vi.mocked(db.segnalazione.count).mockImplementation((async (args: { where: Record<string, unknown> }) => {
      const w = args.where;
      if (w.dataInvio) return 1; // inAttesaOverdue
      if (w.livelloRecidiva) return 2; // recidive
      if (typeof w.stato === "string") return perStato[w.stato];
      return 100; // totali
    }) as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      totali: 100,
      bozze: 10,
      inRevisione: 11,
      approvate: 12,
      inviate: 13,
      inAttesa: 14,
      chiusePositive: 15,
      chiuseNegative: 16,
      recidive: 2,
      inAttesaOverdue: 1,
    });
    // La soglia è la stessa usata da GET /api/reminder.
    expect(json.sogliaGiorni).toBe(getReminderGiorni());
  });
});
