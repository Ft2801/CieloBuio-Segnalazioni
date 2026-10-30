/**
 * Test di integrazione per le route di azione sulle segnalazioni:
 * - POST /api/segnalazioni/[id]/approva
 * - POST /api/segnalazioni/[id]/rifiuta
 * - POST /api/segnalazioni/[id]/cambia-stato
 * - GET  /api/segnalazioni/[id]/lettera
 *
 * Copre: 401/403 (autorizzazioni), 400 (validazione/transizioni illecite),
 * 404 (non trovata), 409 (race condition su updateMany con clausola WHERE su stato),
 * 200 (successo), 500 (errore DB), matrice TRANSIZIONI_LECITE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Mock di @/lib/notifiche: le funzioni sono fire-and-forget nelle route
vi.mock("@/lib/notifiche", () => ({
  notificaVolontarioRifiuto: vi.fn().mockResolvedValue(undefined),
  notificaReferenteNuovaRevisione: vi.fn().mockResolvedValue(undefined),
}));

// Mock di @/lib/lettera per isolare il test della route da buildLetteraContextFromSegnalazione
vi.mock("@/lib/lettera", () => ({
  buildLetteraContextFromSegnalazione: vi.fn(),
  generaHtmlLettera: vi.fn(),
  generaTestoLettera: vi.fn(),
}));

// Mock di fs/promises per la lettura allegati in lettera (with_attachments)
vi.mock("fs/promises", () => ({
  lstat: vi.fn().mockResolvedValue({ isSymbolicLink: () => false }),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    segnalazione: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    allegato: {
      findMany: vi.fn(),
    },
    storicoStato: {
      create: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
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
import { readFile } from "fs/promises";
import { POST as APPROVA } from "@/app/api/segnalazioni/[id]/approva/route";
import { POST as RIFIUTA } from "@/app/api/segnalazioni/[id]/rifiuta/route";
import { POST as CAMBIA_STATO } from "@/app/api/segnalazioni/[id]/cambia-stato/route";
import { GET as LETTERA } from "@/app/api/segnalazioni/[id]/lettera/route";
import { buildLetteraContextFromSegnalazione, generaHtmlLettera } from "@/lib/lettera";

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
const VOL_SESSION = {
  id: "s2",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-vol",
    email: "vol@t.it",
    nomeCognome: "Volontario",
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
const REF_PROV_SESSION = {
  id: "s3",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref",
    email: "ref@t.it",
    nomeCognome: "Referente",
    ruolo: "referente_provinciale",
    provinciaId: 5,
    regioneId: null,
    inizialiProtocollo: "RF",
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

function makeReq(method: string, body?: unknown, url = "http://localhost/api/segnalazioni/s1"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/segnalazioni/[id]/approva", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario (non può approvare)", async () => {
    mockSession(VOL_SESSION);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se referente senza competenza territoriale (fail-closed)", async () => {
    const REF_NO_TERR = {
      ...REF_PROV_SESSION,
      user: { ...REF_PROV_SESSION.user, provinciaId: null },
    };
    mockSession(REF_NO_TERR);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 5,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se stato non è in_revisione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("revisione");
  });

  it("approva con successo ritorna 200 (transizione in_revisione -> approvata)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "in_revisione",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "approvata" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segnalazione.stato).toBe("approvata");
    // Verifica che updateMany usi clausola WHERE su stato per atomicità
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "s1",
          stato: "in_revisione",
          updatedAt: undefined,
          volontarioId: "v1",
          provinciaId: 1,
          regioneId: 1,
          invioPecLockToken: null,
        },
        data: expect.objectContaining({ stato: "approvata" }),
      }),
    );
  });

  it("ritorna 409 se updateMany ritorna count=0 (race condition)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("revisione");
  });

  it("ritorna 500 se updateMany solleva errore", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockRejectedValue(new Error("DB error"));
    const res = await APPROVA(makeReq("POST"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/segnalazioni/[id]/rifiuta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await RIFIUTA(makeReq("POST", { nota: "x" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario", async () => {
    mockSession(VOL_SESSION);
    const res = await RIFIUTA(makeReq("POST", { nota: "x" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await RIFIUTA(makeReq("POST", { nota: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se referente senza competenza territoriale (fail-closed)", async () => {
    const REF_NO_TERR = {
      ...REF_PROV_SESSION,
      user: { ...REF_PROV_SESSION.user, provinciaId: null },
    };
    mockSession(REF_NO_TERR);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 5,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    const res = await RIFIUTA(makeReq("POST", { nota: "motivo" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("ritorna 400 se notaRifiuto mancante", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    const res = await RIFIUTA(makeReq("POST", {}), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("nota");
  });

  it("ritorna 400 se notaRifiuto supera 2000 caratteri", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    const res = await RIFIUTA(makeReq("POST", { nota: "x".repeat(2001) }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("2000");
  });

  it("ritorna 400 se stato non è in_revisione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await RIFIUTA(makeReq("POST", { nota: "motivo" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("rifiuta con successo ritorna 200 (transizione in_revisione -> bozza)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "in_revisione",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "bozza" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await RIFIUTA(makeReq("POST", { nota: "Motivo rifiuto" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "s1",
          stato: "in_revisione",
          updatedAt: undefined,
          volontarioId: "v1",
          provinciaId: 1,
          regioneId: 1,
          invioPecLockToken: null,
        },
        data: expect.objectContaining({
          stato: "bozza",
          referenteApprovatoreId: null,
          notaRifiuto: "Motivo rifiuto",
        }),
      }),
    );
  });

  it("ritorna 409 se updateMany ritorna count=0 (race condition)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await RIFIUTA(makeReq("POST", { nota: "Motivo" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
  });

  it("ritorna 500 se updateMany solleva errore", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockRejectedValue(new Error("DB error"));
    const res = await RIFIUTA(makeReq("POST", { nota: "Motivo" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/segnalazioni/[id]/cambia-stato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "inviata" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se nuovoStato non è valido (non in whitelist)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "STATO_INVENTATO" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Stato non valido");
  });

  it("ritorna 400 se nota supera 2000 caratteri", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione", nota: "x".repeat(2001) }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se transizione illecita (bozza -> approvata)", async () => {
    // Dalla matrice: bozza può solo andare in in_revisione
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "approvata" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Transizione non ammessa");
  });

  it("ritorna 400 se transizione illecita (chiusa_positiva -> bozza)", async () => {
    // chiusa_positiva ha array vuoto di transizioni lecite
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "chiusa_positiva",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "bozza" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 403 se il volontario richiede una transizione riservata ai referenti (in_attesa -> chiusa_positiva)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_attesa",
    } as never);
    // in_attesa -> chiusa_positiva è lecita, ma richiede ruolo referente
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "chiusa_positiva" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(403);
  });

  it("ritorna 403 se volontario NON proprietario tenta bozza->in_revisione", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "altro",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Solo il volontario");
  });

  it.each([
    { stato: "bozza", azione: "rifiuta" },
    { stato: "approvata", azione: "approva" },
  ])("non permette di bypassare /$azione dalla revisione, nemmeno con force=1", async ({ stato, azione }) => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    for (const query of ["", "?force=1"]) {
      const res = await CAMBIA_STATO(
        makeReq("POST", { stato }, `http://localhost/api/segnalazioni/s1/cambia-stato${query}`),
        { params: Promise.resolve({ id: "s1" }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(`/${azione}`);
    }
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("transizione lecita bozza -> in_revisione (volontario proprietario)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "u-vol",
        provinciaId: 1,
        regioneId: 1,
        stato: "bozza",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_revisione" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    // Verifica pulizia notaRifiuto al passaggio bozza -> in_revisione
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "in_revisione", notaRifiuto: null, referenteApprovatoreId: null }),
      }),
    );
  });

  it("revoca l'approvazione quando una segnalazione approvata torna in revisione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "approvata",
        referenteApprovatoreId: "u-ref",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_revisione", referenteApprovatoreId: null } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);

    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "in_revisione", referenteApprovatoreId: null }),
      }),
    );
  });

  it("transizione lecita inviata -> in_attesa (admin)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "inviata",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_attesa" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_attesa" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("transizione lecita in_attesa -> chiusa_positiva (referente con competenza)", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 5,
        regioneId: 1,
        stato: "in_attesa",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "chiusa_positiva" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "chiusa_positiva" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
  });

  it("transizione forzata con ?force=1 (admin bypassa matrice)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_positiva",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_attesa" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await CAMBIA_STATO(
      makeReq("POST", { stato: "in_attesa" }, "http://localhost/api/segnalazioni/s1?force=1"),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(200);
    // Lo storico deve registrare che la transizione è stata forzata
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nota: expect.stringContaining("forzata"),
        }),
      }),
    );
  });

  it("force=1 non funziona per non-admin (volontario non può forzare)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(
      makeReq("POST", { stato: "approvata" }, "http://localhost/api/segnalazioni/s1?force=1"),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Transizione non ammessa");
  });

  it("ritorna 409 se updateMany ritorna count=0 (race condition)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "inviata",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_attesa" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
  });

  it("imposta dataChiusura quando stato transita a chiusa_positiva", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_attesa",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "in_attesa",
      } as never)
      .mockResolvedValueOnce({
        id: "s1",
        stato: "chiusa_positiva",
        dataChiusura: new Date(),
      } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "chiusa_positiva" }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataChiusura: expect.any(Date) }),
      }),
    );
  });

  it("imposta dataChiusura quando stato transita a chiusa_negativa", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_attesa",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "in_attesa",
      } as never)
      .mockResolvedValueOnce({
        id: "s1",
        stato: "chiusa_negativa",
        dataChiusura: new Date(),
      } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "chiusa_negativa" }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataChiusura: expect.any(Date) }),
      }),
    );
  });

  it("azzera dataChiusura quando pratica chiusa viene riaperta (chiusa_negativa -> in_attesa)", async () => {
    // chiusa_negativa -> in_attesa è una transizione lecita (vedi TRANSIZIONI_LECITE)
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "chiusa_negativa",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_negativa",
      } as never)
      .mockResolvedValueOnce({
        id: "s1",
        stato: "in_attesa",
      } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "in_attesa" }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataChiusura: null }),
      }),
    );
  });

  it("azzera dataChiusura per riapertura forzata chiusa_positiva -> in_revisione (force=1)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "chiusa_positiva",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_positiva",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_revisione" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }, "http://localhost/api/segnalazioni/s1?force=1"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataChiusura: null }),
      }),
    );
  });

  it("azzera dataChiusura per riapertura forzata chiusa_positiva -> approvata (force=1)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "chiusa_positiva",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_positiva",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "approvata" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "approvata" }, "http://localhost/api/segnalazioni/s1?force=1"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataChiusura: null,
          referenteApprovatoreId: "u-admin",
          notaRifiuto: null,
        }),
      }),
    );
  });

  it("azzera dataChiusura per riapertura forzata chiusa_positiva -> bozza (force=1)", async () => {
    // Anche una riapertura forzata azzera la data della vecchia chiusura,
    // perché la retention deve iniziare solo dalla successiva chiusura.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "chiusa_positiva",
    } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_positiva",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "bozza" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await CAMBIA_STATO(makeReq("POST", { stato: "bozza" }, "http://localhost/api/segnalazioni/s1?force=1"), {
      params: Promise.resolve({ id: "s1" }),
    });
    const callArgs = vi.mocked(db.segnalazione.updateMany).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArgs.data).toMatchObject({ dataChiusura: null, referenteApprovatoreId: null, notaRifiuto: null });
  });
});

describe("POST /api/segnalazioni/[id]/cambia-stato - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se body.stato non è una stringa (typeof check false branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: 123 }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Stato non valido");
  });

  it("ritorna 400 se stato corrente non è in TRANSIZIONI_LECITE (?? [] fallback)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "stato_inventato",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Transizione non ammessa");
  });

  it("ritorna 403 se referente senza competenza territoriale (fail-closed)", async () => {
    const REF_NO_TERR = {
      ...REF_PROV_SESSION,
      user: { ...REF_PROV_SESSION.user, provinciaId: null },
    };
    mockSession(REF_NO_TERR);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 5,
      regioneId: 1,
      stato: "in_attesa",
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "chiusa_positiva" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("force=1 con transizione già ammessa non registra 'forzata' nello storico", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "inviata",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_attesa" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    // inviata -> in_attesa è lecita, ma con force=1: la nota NON deve contenere "forzata"
    await CAMBIA_STATO(makeReq("POST", { stato: "in_attesa" }, "http://localhost/api/segnalazioni/s1?force=1"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nota: null,
        }),
      }),
    );
  });

  it("force=1 con transizione NON ammessa e nota fornita (template literal true branch)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce({
        id: "s1",
        volontarioId: "v1",
        provinciaId: 1,
        regioneId: 1,
        stato: "chiusa_positiva",
      } as never)
      .mockResolvedValueOnce({ id: "s1", stato: "in_attesa" } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    // chiusa_positiva -> in_attesa NON è ammessa, force=1 con nota
    await CAMBIA_STATO(
      makeReq(
        "POST",
        { stato: "in_attesa", nota: "Riaperta per verifica" },
        "http://localhost/api/segnalazioni/s1?force=1",
      ),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nota: expect.stringContaining("forzata"),
        }),
      }),
    );
    // La nota deve contenere sia "forzata" che la nota fornita
    const callArgs = vi.mocked(db.storicoStato.create).mock.calls[0][0] as { data: { nota: string } };
    expect(callArgs.data.nota).toContain("Riaperta per verifica");
  });
});

describe("GET /api/segnalazioni/[id]/lettera", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await LETTERA(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await LETTERA(makeReq("GET"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se volontario non proprietario (IDOR prevention)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "altro",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    const res = await LETTERA(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 200 con HTML per admin (Content-Type text/html)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({
      mittenteNome: "Mario",
      comuneNome: "Verdello",
      numeroProtocollo: "P1",
    } as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body>Lettera</body></html>");
    const res = await LETTERA(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await res.text();
    expect(text).toContain("Lettera");
  });

  it("ritorna 500 se buildLetteraContextFromSegnalazione solleva errore", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockRejectedValue(new Error("lettera error"));
    const res = await LETTERA(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
  });

  it("con with_attachments=1 legge gli allegati di tipo foto dal DB", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({
      mittenteNome: "Mario",
      comuneNome: "Verdello",
    } as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body>Lettera</body></html>");
    // Nessun allegato: la route non fa nulla (ma fa la query)
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(db.allegato.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { segnalazioneId: "s1", tipo: "foto" },
      }),
    );
  });

  it("con with_attachments=1 e allegati, incorpora immagini nel HTML", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({
      mittenteNome: "Mario",
      comuneNome: "Verdello",
    } as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body>Lettera</body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      {
        id: "a1",
        segnalazioneId: "s1",
        urlStorage: "s1/foto.jpg",
        nomeOriginale: "foto<x>.jpg", // nome con caratteri speciali per testare escapeHtml
      },
    ] as never);
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Verifica che l'immagine sia stata incorporata come base64
    expect(text).toContain("data:image/jpeg;base64,");
    // Verifica che il nomeOriginale sia stato HTML-escaped (no < o >)
    expect(text).not.toContain("foto<x>");
    expect(text).toContain("foto&lt;x&gt;");
  });

  it("con with_attachments=1 e allegato PNG, usa mime image/png", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.png", nomeOriginale: "foto.png" },
    ] as never);
    const fileBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:image/png;base64,");
  });

  it("con with_attachments=1 e allegato WebP, usa mime image/webp", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.webp", nomeOriginale: "foto.webp" },
    ] as never);
    const fileBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:image/webp;base64,");
  });

  it("con with_attachments=1 salta allegato con urlStorage malformato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    // urlStorage con formato non riconosciuto (1 solo elemento)
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "malformato", nomeOriginale: "x.jpg" },
    ] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // Nessuna immagine incorporata
    const text = await res.text();
    expect(text).not.toContain("data:");
  });

  it("con with_attachments=1 salta allegato con segnalazioneId mismatch", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1-different/foto.jpg", nomeOriginale: "foto.jpg" },
    ] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("data:");
  });

  it("con with_attachments=1 salta allegato con path traversal ('..')", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/..", nomeOriginale: "foto.jpg" },
    ] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("data:");
  });

  it("con with_attachments=1 salta allegato se readFile throw (file mancante)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg", nomeOriginale: "foto.jpg" },
    ] as never);
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("data:");
  });

  it("con with_attachments=1 ignora urlStorage fuori formato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body></body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      {
        id: "a1",
        segnalazioneId: "s1",
        urlStorage: "formato/non/valido/s1/old-foto.jpg",
        nomeOriginale: "old-foto.jpg",
      },
    ] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(readFile).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain("data:image/jpeg;base64,");
  });
});

// -----------------------------------------------------------------------------
// cambia-stato: lo stato "inviata" resta riservato a /invia-pec
// -----------------------------------------------------------------------------
describe("cambia-stato - stato inviata riservato a /invia-pec", () => {
  it("rifiuta lo stato inviata anche con force=1", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "u-vol",
      provinciaId: 1,
      regioneId: 1,
      stato: "approvata",
    } as never);
    const res = await CAMBIA_STATO(
      makeReq("POST", { stato: "inviata" }, "http://localhost/api/segnalazioni/s1/cambia-stato?force=1"),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("/invia-pec");
  });
});

describe("pratiche anonimizzate", () => {
  it("non consente la riapertura dopo la cancellazione GDPR", async () => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      stato: "chiusa_negativa",
      volontarioId: null,
    } as never);
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_attesa" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });
});

describe("precondizione dello snapshot visualizzato", () => {
  it("APPROVA: una versione obsoleta non scrive dati", async () => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      stato: "bozza",
      volontarioId: "u-vol",
      updatedAt: new Date(),
    } as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1", {
      method: "POST",
      headers: { "If-Match": '"obsoleta"' },
    });
    expect((await APPROVA(req, { params: Promise.resolve({ id: "s1" }) })).status).toBe(409);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });
  it("RIFIUTA: una versione obsoleta non scrive dati", async () => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      stato: "bozza",
      volontarioId: "u-vol",
      updatedAt: new Date(),
    } as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1", {
      method: "POST",
      headers: { "If-Match": '"obsoleta"' },
    });
    expect((await RIFIUTA(req, { params: Promise.resolve({ id: "s1" }) })).status).toBe(409);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });
  it("CAMBIA_STATO: una versione obsoleta non scrive dati", async () => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      stato: "bozza",
      volontarioId: "u-vol",
      updatedAt: new Date(),
    } as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1", {
      method: "POST",
      headers: { "If-Match": '"obsoleta"' },
    });
    expect((await CAMBIA_STATO(req, { params: Promise.resolve({ id: "s1" }) })).status).toBe(409);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });
});
