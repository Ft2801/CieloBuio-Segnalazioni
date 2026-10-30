/**
 * Test di integrazione per /api/segnalazioni (GET lista, POST creazione)
 * e /api/segnalazioni/export (GET export CSV).
 *
 * Copre:
 * - 401/403 per utente non autenticato / non autorizzato
 * - 400 per input non valido
 * - 200/201 per caso successo
 * - 500 per errore DB
 * - Rate limit su POST creazione (20/ora)
 * - Rate limit su export CSV (5/ora -> 429 al 6° export)
 * - Header CSV, formula injection, audit trail
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => {
  const mockDb = {
    segnalazione: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    comune: {
      findUnique: vi.fn(),
    },
    storicoStato: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    // La creazione avviene in transazione: la callback riceve lo stesso mock come tx.
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") return (cb as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    return Promise.all(cb as Promise<unknown>[]);
  });
  return { db: mockDb };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { GET, POST } from "@/app/api/segnalazioni/route";
import { GET as EXPORT_GET } from "@/app/api/segnalazioni/export/route";

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

function mockSession(user: unknown) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

function makeGetReq(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makePostReq(body: unknown, url = "http://localhost/api/segnalazioni"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/segnalazioni", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await GET(makeGetReq("http://localhost/api/segnalazioni"));
    expect(res.status).toBe(401);
  });

  it("ritorna 200 con lista segnalazioni per volontario", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      { id: "s1", numeroProtocollo: null, stato: "bozza", indirizzoVia: "Via 1" },
    ] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(1);
    const res = await GET(makeGetReq("http://localhost/api/segnalazioni"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segnalazioni).toHaveLength(1);
    expect(json.pagination.total).toBe(1);
    expect(json.pagination.hasMore).toBe(false);
  });

  it("applica filtri stato e search alla query", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    await GET(makeGetReq("http://localhost/api/segnalazioni?stato=approvata&search=via"));
    // Verifica che findMany sia stato chiamato con where contenente stato e OR
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stato: "approvata",
          OR: expect.arrayContaining([expect.objectContaining({ numeroProtocollo: expect.any(Object) })]),
        }),
      }),
    );
  });

  it("ignora stato non valido (non presente nella whitelist)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    await GET(makeGetReq("http://localhost/api/segnalazioni?stato=STATO_INVENTATO"));
    // Lo stato non viene applicato perché non è nella whitelist
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ stato: "STATO_INVENTATO" }),
      }),
    );
  });

  it("ritorna 500 con messaggio generico se la lettura della lista fallisce", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockRejectedValue(new Error("DB error"));
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    const res = await GET(makeGetReq("http://localhost/api/segnalazioni"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
  });
});

describe("POST /api/segnalazioni", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1 }));
    expect(res.status).toBe(401);
  });

  it("ritorna 400 se indirizzoVia mancante", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makePostReq({ comuneId: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Indirizzo");
  });

  it("ritorna 400 se indirizzoVia supera 500 caratteri", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makePostReq({ indirizzoVia: "x".repeat(501), comuneId: 1 }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se comuneId mancante", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Comune");
  });

  it("ritorna 400 se comuneId non numerico", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("rifiuta ID del Comune come stringa numerica o numero non sicuro", async () => {
    mockSession(VOL_SESSION);
    for (const comuneId of ["1", 2147483648, 9007199254740992]) {
      const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("comuneId non valido");
    }
    expect(db.comune.findUnique).not.toHaveBeenCalled();
  });

  it("ritorna 400 se latitudine fuori range", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        latitudine: 200,
        longitudine: 10,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Latitudine");
  });

  it("ritorna 400 se longitudine fuori range", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        latitudine: 45,
        longitudine: 999,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Longitudine");
  });

  it("ritorna 400 se solo una tra latitudine/longitudine è numerica", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        latitudine: 45,
        longitudine: "non-numero",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se PEC CC aggiuntive non sono email valide", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        pecCcAggiuntive: "non-email",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se oggettoPec contiene a capo (CRLF injection)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        oggettoPec: "riga1\nriga2",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se comune non trovato", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue(null);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 9999 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Comune non trovato");
  });

  it.each([42, "", "   ", { id: "s-old" }])(
    "rifiuta segnalazionePrecedenteId malformato (%s) senza creare una pratica scollegata",
    async (segnalazionePrecedenteId) => {
      mockSession(VOL_SESSION);
      vi.mocked(db.comune.findUnique).mockResolvedValue({
        id: 1,
        cap: "24049",
        provinciaId: 1,
        provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
      } as never);
      const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1, segnalazionePrecedenteId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("segnalazionePrecedenteId non valido");
      expect(db.segnalazione.create).not.toHaveBeenCalled();
    },
  );

  it("ritorna 400 se segnalazionePrecedenteId non accessibile", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old",
      volontarioId: "altro-utente",
      livelloRecidiva: 1,
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        segnalazionePrecedenteId: "s-old",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("precedente");
  });

  it("crea segnalazione valida con successo ritorna 201", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      nomeSindaco: "Mario Rossi",
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({
      id: "s-new",
      stato: "bozza",
      indirizzoVia: "Via 1",
      comuneId: 1,
    } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        nomeEsercizio: "Bar Roma",
        chkVetroPianoInclinato: true,
        descrizioneLibera: "descrizione",
        includiArpa: true,
        pecCcAggiuntive: "cc1@pec.it; cc2@pec.it",
        mittenteVisibile: true,
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.segnalazione.id).toBe("s-new");
    // Verifica che lo storico sia stato creato con stato "bozza"
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statoNuovo: "bozza",
          statoPrecedente: null,
        }),
      }),
    );
  });

  it("livelloRecidiva incrementa se segnalazionePrecedenteId valido", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old",
      volontarioId: "u-vol",
      livelloRecidiva: 2,
      stato: "inviata",
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        segnalazionePrecedenteId: "s-old",
      }),
    );
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          livelloRecidiva: 3,
          segnalazionePrecedenteId: "s-old",
        }),
      }),
    );
  });

  it("ritorna 500 se create solleva errore", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1 }));
    expect(res.status).toBe(500);
  });

  it("rate limit: blocca al 21esimo tentativo (429)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "x" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    // 20 tentativi permessi, al 21° scatta il blocco
    for (let i = 0; i < 20; i++) {
      const res = await POST(makePostReq({ indirizzoVia: `Via ${i}`, comuneId: 1 }));
      expect(res.status).toBe(201);
    }
    // 21° tentativo: bloccato dal rate limit
    const res = await POST(makePostReq({ indirizzoVia: "Blocked", comuneId: 1 }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppe");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("crea segnalazione con latitudine e longitudine valide", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        latitudine: 45.5,
        longitudine: 9.6,
      }),
    );
    expect(res.status).toBe(201);
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitudine: 45.5, longitudine: 9.6 }),
      }),
    );
  });

  it("ritorna 400 se longitudine < -180", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        latitudine: 45,
        longitudine: -999,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Longitudine");
  });

  it("rifiuta un CAP numerico anziché sostituirlo silenziosamente con quello del Comune", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1, cap: 12345 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("CAP non valido");
    expect(db.segnalazione.create).not.toHaveBeenCalled();
  });

  it.each([{ includiArpa: "false" }, { chkLuceVersoAlto: 1 }, { mittenteVisibile: "sì" }])(
    "rifiuta flag non booleani in creazione: %j",
    async (flag) => {
      mockSession(VOL_SESSION);
      const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1, ...flag }));
      expect(res.status).toBe(400);
      expect(db.segnalazione.create).not.toHaveBeenCalled();
    },
  );

  it("notaAltroTipologia e notaAltroProblema non stringa (typeof check false branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        notaAltroTipologia: 123, // numero, non stringa
        notaAltroProblema: 456, // numero, non stringa
      }),
    );
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notaAltroTipologia: null,
          notaAltroProblema: null,
        }),
      }),
    );
  });

  it("rifiuta come precedente una segnalazione ancora in bozza (400)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old",
      volontarioId: "u-vol",
      livelloRecidiva: 1,
      stato: "bozza",
    } as never);
    const res = await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        segnalazionePrecedenteId: "s-old",
      }),
    );
    expect(res.status).toBe(400);
    expect(db.segnalazione.create).not.toHaveBeenCalled();
  });

  it("livelloRecidiva fallback a 1 se precedente.livelloRecidiva è null", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old",
      volontarioId: "u-vol",
      livelloRecidiva: null,
      stato: "inviata",
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        segnalazionePrecedenteId: "s-old",
      }),
    );
    // livelloRecidiva null → ?? 1 → 1 + 1 = 2
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ livelloRecidiva: 2 }),
      }),
    );
  });

  it("body.cap come stringa (typeof check true branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        cap: "24100",
      }),
    );
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cap: "24100" }),
      }),
    );
  });

  it("notaAltroTipologia e notaAltroProblema come stringa (typeof check true branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    await POST(
      makePostReq({
        indirizzoVia: "Via 1",
        comuneId: 1,
        notaAltroTipologia: "Tipo personalizzato",
        notaAltroProblema: "Problema personalizzato",
      }),
    );
    expect(db.segnalazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notaAltroTipologia: "Tipo personalizzato",
          notaAltroProblema: "Problema personalizzato",
        }),
      }),
    );
  });
});

describe("GET /api/segnalazioni/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(401);
  });

  it("esporta CSV valido con header corretti e content-type", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1",
        numeroProtocollo: "P1",
        dataSegnalazione: new Date("2026-01-01"),
        stato: "approvata",
        indirizzoVia: "Via Roma 1",
        cap: "24049",
        latitudine: 45.5,
        longitudine: 9.6,
        nomeEsercizio: "Bar",
        chkVetroPianoInclinato: true,
        chkVetroCurvo: false,
        chkAltroTipologia: false,
        notaAltroTipologia: null,
        chkLuceVersoAlto: true,
        chkAbbagliamento: false,
        chkLuceIntrusiva: false,
        chkAltroProblema: false,
        notaAltroProblema: null,
        descrizioneLibera: null,
        destinatarioNome: "Sindaco",
        includiArpa: false,
        pecCcAggiuntive: null,
        oggettoPec: "Oggetto",
        mittenteVisibile: true,
        dataInvio: null,
        livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "Verdello" },
        provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it" },
        referenteApprovatore: { id: "r1", nomeCognome: "Referente" },
        allegati: [{ id: "a1" }],
      },
    ] as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // Il CSV inizia con BOM UTF-8 (0xEF 0xBB 0xBF). La API Web Response.text()
    // stripa il BOM in automatico, quindi verifichiamo i byte grezzi.
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder().decode(bytes);
    // Contiene le intestazioni attese
    expect(text).toContain("Protocollo");
    expect(text).toContain("Volontario");
    // Separatore punto e virgola (predefinito di Excel in italiano).
    // TextDecoder rimuove il BOM: la prima riga inizia direttamente con "Protocollo".
    const intestazioni = text.split("\n")[0];
    expect(intestazioni.startsWith("Protocollo;Data segnalazione;")).toBe(true);
    expect(intestazioni.includes(",")).toBe(false);
    expect(text).toContain("Indirizzo");
    // Contiene il valore della riga
    expect(text).toContain("P1");
    expect(text).toContain("Via Roma 1");
  });

  it("applica escaping contro formula injection (=HYPERLINK...)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1",
        numeroProtocollo: null,
        dataSegnalazione: new Date("2026-01-01"),
        stato: "bozza",
        indirizzoVia: "Via 1",
        cap: "24049",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: '=HYPERLINK("http://evil")',
        chkVetroPianoInclinato: false,
        chkVetroCurvo: false,
        chkAltroTipologia: false,
        notaAltroTipologia: null,
        chkLuceVersoAlto: false,
        chkAbbagliamento: false,
        chkLuceIntrusiva: false,
        chkAltroProblema: false,
        notaAltroProblema: null,
        descrizioneLibera: null,
        destinatarioNome: null,
        includiArpa: false,
        pecCcAggiuntive: null,
        oggettoPec: null,
        mittenteVisibile: true,
        dataInvio: null,
        livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" },
        provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null,
        allegati: [],
      },
    ] as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Il campo malevolo viene prefissato con apostrofo
    expect(text).toContain("'=HYPERLINK");
  });

  it("non restituisce un CSV troncato oltre il limite delle 5000 righe", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue(Array.from({ length: 5001 }, (_, id) => ({ id })) as never);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }));
    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await res.json()).error).toContain("supera 5000");
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("ritorna 500 con messaggio generico se la lettura delle segnalazioni fallisce", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockRejectedValue(new Error("DB error"));
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("audit trail: registra voce di storico per export con segnalazioni", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1",
        numeroProtocollo: "P1",
        stato: "approvata",
        dataSegnalazione: new Date("2026-01-01"),
        indirizzoVia: "Via 1",
        cap: "24049",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: null,
        chkVetroPianoInclinato: false,
        chkVetroCurvo: false,
        chkAltroTipologia: false,
        notaAltroTipologia: null,
        chkLuceVersoAlto: false,
        chkAbbagliamento: false,
        chkLuceIntrusiva: false,
        chkAltroProblema: false,
        notaAltroProblema: null,
        descrizioneLibera: null,
        destinatarioNome: null,
        includiArpa: false,
        pecCcAggiuntive: null,
        oggettoPec: null,
        mittenteVisibile: true,
        dataInvio: null,
        livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" },
        provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null,
        allegati: [],
      },
    ] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(db.storicoStato.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u-admin",
          azione: "export_csv",
          dettagli: expect.stringContaining('"righe":1'),
        }),
      }),
    );
  });

  it("audit trail best-effort: non blocca export se storico fallisce", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1",
        numeroProtocollo: "P1",
        stato: "approvata",
        dataSegnalazione: new Date("2026-01-01"),
        indirizzoVia: "Via 1",
        cap: "24049",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: null,
        chkVetroPianoInclinato: false,
        chkVetroCurvo: false,
        chkAltroTipologia: false,
        notaAltroTipologia: null,
        chkLuceVersoAlto: false,
        chkAbbagliamento: false,
        chkLuceIntrusiva: false,
        chkAltroProblema: false,
        notaAltroProblema: null,
        descrizioneLibera: null,
        destinatarioNome: null,
        includiArpa: false,
        pecCcAggiuntive: null,
        oggettoPec: null,
        mittenteVisibile: true,
        dataInvio: null,
        livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" },
        provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null,
        allegati: [],
      },
    ] as never);
    vi.mocked(db.storicoStato.create).mockRejectedValue(new Error("DB error"));
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    // L'export deve comunque avere successo: l'audit trail è best-effort
    expect(res.status).toBe(200);
  });

  it("rate limit: blocca al 6° export (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    // 5 export permessi, al 6° scatta il blocco
    for (let i = 0; i < 5; i++) {
      const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
      expect(res.status).toBe(200);
    }
    // 6° export: bloccato
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppi export");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test mirati per rami residui (coverage 100%)
  // ---------------------------------------------------------------------------

  it("applica il filtro search alla query con quattro campi in OR", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    // Chiama export con ?search=via: la route deve costruire where.OR con
    // i 4 campi (numeroProtocollo, indirizzoVia, nomeEsercizio, comune.nome).
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?search=via"));
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ numeroProtocollo: expect.objectContaining({ contains: "via" }) }),
            expect.objectContaining({ indirizzoVia: expect.objectContaining({ contains: "via" }) }),
            expect.objectContaining({ nomeEsercizio: expect.objectContaining({ contains: "via" }) }),
            expect.objectContaining({ comune: expect.objectContaining({ nome: expect.any(Object) }) }),
          ]),
        }),
      }),
    );
  });

  it("search viene troncato a 200 caratteri", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    const lungo = "x".repeat(250);
    await EXPORT_GET(makeGetReq(`http://localhost/api/segnalazioni/export?search=${lungo}`));
    // Verifica che il parametro search sia stato troncato a 200 caratteri
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ numeroProtocollo: expect.objectContaining({ contains: "x".repeat(200) }) }),
          ]),
        }),
      }),
    );
  });

  it("stato='all' non applica il filtro stato", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?stato=all"));
    // where non contiene la chiave "stato" perché stato==='all' è escluso
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ stato: expect.anything() }),
      }),
    );
  });

  it("esporta segnalazione con tutti i flag true e campi null", async () => {
    // Segnalazione con tutti i checkbox true, mittenteVisibile false,
    // dataInvio impostato, allegati null, volontario/comune/provincia/regione
    // null, dataSegnalazione null: verifica i valori di ripiego della mappatura CSV.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s-full",
        numeroProtocollo: "P-FULL",
        dataSegnalazione: null,
        stato: "inviata",
        indirizzoVia: "Via Full 1",
        cap: "24049",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: "Bar Full",
        chkVetroPianoInclinato: true,
        chkVetroCurvo: true,
        chkAltroTipologia: true,
        notaAltroTipologia: "Nota tip",
        chkLuceVersoAlto: true,
        chkAbbagliamento: true,
        chkLuceIntrusiva: true,
        chkAltroProblema: true,
        notaAltroProblema: "Nota prob",
        descrizioneLibera: "Descrizione",
        destinatarioNome: "Sindaco",
        includiArpa: true,
        pecCcAggiuntive: "cc@pec.it",
        oggettoPec: "Oggetto",
        mittenteVisibile: false,
        dataInvio: new Date("2026-01-01"),
        livelloRecidiva: 2,
        createdAt: new Date("2026-01-01"),
        comune: null,
        provincia: null,
        regione: null,
        volontario: null,
        referenteApprovatore: null,
        allegati: null,
      },
    ] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Gli otto campi impostati a true (chkVetroPianoInclinato, chkVetroCurvo, chkAltroTipologia,
    // chkLuceVersoAlto, chkAbbagliamento, chkLuceIntrusiva, chkAltroProblema, includiArpa) producono "Sì"
    const siCount = (text.match(/Sì/g) || []).length;
    expect(siCount).toBe(8);
    // Verifica "Referente" (mittenteVisibile false)
    expect(text).toContain("Referente");
    // Verifica che la data di invio sia formattata
    expect(text).toContain("01/01/2026");
  });

  it("audit trail con stato valido e search: copre stato ?? 'tutti' truthy e search ? 'sì'", async () => {
    // stato=bozza (truthy, valido, non 'all') e search=via: l'audit trail
    // registra stato=bozza (non 'tutti') e search='sì'.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s-audit",
        numeroProtocollo: "P-AUDIT",
        dataSegnalazione: new Date("2026-01-01"),
        stato: "bozza",
        indirizzoVia: "Via Audit 1",
        cap: "24049",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: null,
        chkVetroPianoInclinato: false,
        chkVetroCurvo: false,
        chkAltroTipologia: false,
        notaAltroTipologia: null,
        chkLuceVersoAlto: false,
        chkAbbagliamento: false,
        chkLuceIntrusiva: false,
        chkAltroProblema: false,
        notaAltroProblema: null,
        descrizioneLibera: null,
        destinatarioNome: null,
        includiArpa: false,
        pecCcAggiuntive: null,
        oggettoPec: null,
        mittenteVisibile: true,
        dataInvio: null,
        livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" },
        provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null,
        allegati: [],
      },
    ] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?stato=bozza&search=via"));
    // Verifica che where.stato sia impostato a "bozza"
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stato: "bozza" }),
      }),
    );
    // Verifica che l'audit trail registri lo stato filtrato e la ricerca attiva
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dettagli: expect.stringContaining('"stato":"bozza"'),
        }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dettagli: expect.stringContaining('"ricerca":true'),
        }),
      }),
    );
  });
});

describe("GET /api/segnalazioni/export: escaping CSV", () => {
  function rigaCon(sovrascritture: Record<string, unknown>) {
    return {
      id: "s1",
      numeroProtocollo: "P1",
      stato: "approvata",
      dataSegnalazione: new Date("2026-01-01"),
      indirizzoVia: "Via 1",
      cap: "24049",
      latitudine: -3.5,
      longitudine: null,
      nomeEsercizio: null,
      chkVetroPianoInclinato: false,
      chkVetroCurvo: false,
      chkAltroTipologia: false,
      notaAltroTipologia: null,
      chkLuceVersoAlto: false,
      chkAbbagliamento: false,
      chkLuceIntrusiva: false,
      chkAltroProblema: false,
      notaAltroProblema: null,
      descrizioneLibera: null,
      destinatarioNome: null,
      includiArpa: false,
      pecCcAggiuntive: null,
      oggettoPec: null,
      mittenteVisibile: true,
      dataInvio: null,
      livelloRecidiva: 1,
      createdAt: new Date("2026-01-01"),
      comune: { nome: "X" },
      provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
      referenteApprovatore: null,
      allegati: [],
      ...sovrascritture,
    };
  }

  it("neutralizza formule precedute da spazi bianchi e non prefissa i numeri negativi", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      rigaCon({ descrizioneLibera: ' =HYPERLINK("http://x")' }),
    ] as never);
    vi.mocked(db.auditLog.create).mockResolvedValue({} as never);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    const testo = await res.text();
    const righe = testo.split("\n");
    // Formula con spazio iniziale: prefisso apostrofo e campo quotato (contiene virgolette)
    expect(testo).toContain('"\' =HYPERLINK(""http://x"")"');
    // Latitudine negativa numerica: resta -3.5, senza apostrofo
    expect(righe[1]).toMatch(/;-3\.5;/);
    expect(righe[1]).not.toContain("'-3.5");
  });
});

// -----------------------------------------------------------------------------
// Rami residui: paginazione, corpo non valido, CAP, comune, audit export
// -----------------------------------------------------------------------------
describe("segnalazioni - rami residui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
  });

  it("GET usa i valori di default per limit e offset non interi", async () => {
    mockSession(VOL_SESSION);
    await GET(makeGetReq("http://localhost/api/segnalazioni?limit=abc&offset=xyz"));
    const args = vi.mocked(db.segnalazione.findMany).mock.calls[0][0] as { take: number; skip: number };
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
  });

  it("GET limita limit a 200 e porta offset negativo a 0", async () => {
    mockSession(VOL_SESSION);
    await GET(makeGetReq("http://localhost/api/segnalazioni?limit=999&offset=-4"));
    const args = vi.mocked(db.segnalazione.findMany).mock.calls[0][0] as { take: number; skip: number };
    expect(args.take).toBe(200);
    expect(args.skip).toBe(0);
  });

  it("GET applica il default ai parametri vuoti e legge i valori validi", async () => {
    mockSession(VOL_SESSION);
    await GET(makeGetReq("http://localhost/api/segnalazioni?limit=&offset="));
    await GET(makeGetReq("http://localhost/api/segnalazioni?limit=25&offset=10"));
    const chiamate = vi.mocked(db.segnalazione.findMany).mock.calls;
    const primo = chiamate[0][0] as { take: number; skip: number };
    const secondo = chiamate[1][0] as { take: number; skip: number };
    expect([primo.take, primo.skip]).toEqual([50, 0]);
    expect([secondo.take, secondo.skip]).toEqual([25, 10]);
  });

  it("POST ritorna 400 se il corpo non è un oggetto JSON", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(
      new NextRequest("http://localhost/api/segnalazioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "non-json",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("POST ritorna 400 se il comune indicato non esiste", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue(null as never);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 999 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comune non trovato");
  });

  it("POST ritorna 400 se il CAP non è valido", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      cap: "24049",
      provinciaId: 1,
      nomeSindaco: null,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as never);
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1, cap: "12" }));
    expect(res.status).toBe(400);
  });

  it("export: un errore nella registrazione dell'audit non blocca il CSV", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.auditLog.create).mockRejectedValue(new Error("audit non disponibile"));
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
  });
});
