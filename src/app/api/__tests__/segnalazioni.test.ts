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

vi.mock("@/lib/db", () => ({
  db: {
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
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { GET, POST } from "@/app/api/segnalazioni/route";
import { GET as EXPORT_GET } from "@/app/api/segnalazioni/export/route";

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
    ] as any);
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
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    await GET(makeGetReq("http://localhost/api/segnalazioni?stato=approvata&search=via"));
    // Verifica che findMany sia stato chiamato con where contenente stato e OR
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stato: "approvata",
        OR: expect.arrayContaining([
          expect.objectContaining({ numeroProtocollo: expect.any(Object) }),
        ]),
      }),
    }));
  });

  it("ignora stato non valido (non presente nella whitelist)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    await GET(makeGetReq("http://localhost/api/segnalazioni?stato=STATO_INVENTATO"));
    // Lo stato non viene applicato perché non è nella whitelist
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ stato: "STATO_INVENTATO" }),
    }));
  });

  it("propaga l'errore DB al caller (GET senza try/catch)", async () => {
    // La GET non ha try/catch: un errore DB viene propagato al framework,
    // che lo converte in 500 a runtime. A livello di test verifichiamo che
    // la promise venga rigettata.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockRejectedValue(new Error("DB error"));
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
    await expect(GET(makeGetReq("http://localhost/api/segnalazioni"))).rejects.toThrow("DB error");
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

  it("ritorna 400 se latitudine fuori range", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      latitudine: 200, longitudine: 10,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Latitudine");
  });

  it("ritorna 400 se longitudine fuori range", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      latitudine: 45, longitudine: 999,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Longitudine");
  });

  it("ritorna 400 se solo una tra latitudine/longitudine è numerica", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      latitudine: 45, longitudine: "non-numero",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se PEC CC aggiuntive non sono email valide", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      pecCcAggiuntive: "non-email",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se oggettoPec contiene a capo (CRLF injection)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      oggettoPec: "riga1\nriga2",
    }));
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

  it("ritorna 400 se segnalazionePrecedenteId non accessibile", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old", volontarioId: "altro-utente", livelloRecidiva: 1,
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      segnalazionePrecedenteId: "s-old",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("precedente");
  });

  it("crea segnalazione valida con successo ritorna 201", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1, nomeSindaco: "Mario Rossi",
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({
      id: "s-new", stato: "bozza", indirizzoVia: "Via 1", comuneId: 1,
    } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      nomeEsercizio: "Bar Roma",
      chkVetroPianoInclinato: true,
      descrizioneLibera: "descrizione",
      includiArpa: true,
      pecCcAggiuntive: "cc1@pec.it; cc2@pec.it",
      mittenteVisibile: true,
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.segnalazione.id).toBe("s-new");
    // Verifica che lo storico sia stato creato con stato "bozza"
    expect(db.storicoStato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statoNuovo: "bozza",
        statoPrecedente: null,
      }),
    }));
  });

  it("livelloRecidiva incrementa se segnalazionePrecedenteId valido", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old", volontarioId: "u-vol", livelloRecidiva: 2,
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      segnalazionePrecedenteId: "s-old",
    }));
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        livelloRecidiva: 3,
        segnalazionePrecedenteId: "s-old",
      }),
    }));
  });

  it("ritorna 500 se create solleva errore", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makePostReq({ indirizzoVia: "Via 1", comuneId: 1 }));
    expect(res.status).toBe(500);
  });

  it("rate limit: blocca al 21esimo tentativo (429)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "x" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
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
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      latitudine: 45.5, longitudine: 9.6,
    }));
    expect(res.status).toBe(201);
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ latitudine: 45.5, longitudine: 9.6 }),
    }));
  });

  it("ritorna 400 se longitudine < -180 (branch short-circuit)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    const res = await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      latitudine: 45, longitudine: -999,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Longitudine");
  });

  it("body.cap non stringa (typeof check false branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      cap: 12345, // numero, non stringa
    }));
    // cap non è stringa → '' → poi sovrascritto da comune.cap
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cap: "24040" }),
    }));
  });

  it("notaAltroTipologia e notaAltroProblema non stringa (typeof check false branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      notaAltroTipologia: 123, // numero, non stringa
      notaAltroProblema: 456, // numero, non stringa
    }));
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        notaAltroTipologia: null,
        notaAltroProblema: null,
      }),
    }));
  });

  it("livelloRecidiva fallback a 1 se precedente.livelloRecidiva è null", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s-old", volontarioId: "u-vol", livelloRecidiva: null,
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      segnalazionePrecedenteId: "s-old",
    }));
    // livelloRecidiva null → ?? 1 → 1 + 1 = 2
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ livelloRecidiva: 2 }),
    }));
  });

  it("body.cap come stringa (typeof check true branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      cap: "24100",
    }));
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cap: "24100" }),
    }));
  });

  it("notaAltroTipologia e notaAltroProblema come stringa (typeof check true branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1, cap: "24040", provinciaId: 1,
      provincia: { regioneId: 1, regione: { id: 1, regione: "LOMBARDIA" } },
    } as any);
    vi.mocked(db.segnalazione.create).mockResolvedValue({ id: "s-new" } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await POST(makePostReq({
      indirizzoVia: "Via 1", comuneId: 1,
      notaAltroTipologia: "Tipo personalizzato",
      notaAltroProblema: "Problema personalizzato",
    }));
    expect(db.segnalazione.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        notaAltroTipologia: "Tipo personalizzato",
        notaAltroProblema: "Problema personalizzato",
      }),
    }));
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
        id: "s1", numeroProtocollo: "P1", dataSegnalazione: new Date("2026-01-01"),
        stato: "approvata", indirizzoVia: "Via Roma 1", cap: "24040",
        latitudine: 45.5, longitudine: 9.6, nomeEsercizio: "Bar",
        chkVetroPianoInclinato: true, chkVetroCurvo: false,
        chkAltroTipologia: false, notaAltroTipologia: null,
        chkLuceVersoAlto: true, chkAbbagliamento: false,
        chkLuceIntrusiva: false, chkAltroProblema: false, notaAltroProblema: null,
        descrizioneLibera: null, destinatarioNome: "Sindaco",
        includiArpa: false, pecCcAggiuntive: null, oggettoPec: "Oggetto",
        mittenteVisibile: true, dataInvio: null, livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it" },
        referenteApprovatore: { id: "r1", nomeCognome: "Referente" },
        allegati: [{ id: "a1" }],
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
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
    expect(text).toContain("Indirizzo");
    // Contiene il valore della riga
    expect(text).toContain("P1");
    expect(text).toContain("Via Roma 1");
  });

  it("applica escaping contro formula injection (=HYPERLINK...)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1", numeroProtocollo: null, dataSegnalazione: new Date("2026-01-01"),
        stato: "bozza", indirizzoVia: "Via 1", cap: "24040",
        latitudine: null, longitudine: null, nomeEsercizio: "=HYPERLINK(\"http://evil\")",
        chkVetroPianoInclinato: false, chkVetroCurvo: false,
        chkAltroTipologia: false, notaAltroTipologia: null,
        chkLuceVersoAlto: false, chkAbbagliamento: false,
        chkLuceIntrusiva: false, chkAltroProblema: false, notaAltroProblema: null,
        descrizioneLibera: null, destinatarioNome: null,
        includiArpa: false, pecCcAggiuntive: null, oggettoPec: null,
        mittenteVisibile: true, dataInvio: null, livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" }, provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null, allegati: [],
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Il campo malevolo viene prefissato con apostrofo
    expect(text).toContain("'=HYPERLINK");
  });

  it("propaga l'errore DB al caller (export senza try/catch su findMany)", async () => {
    // L'export non ha try/catch attorno al findMany: l'errore viene propagato
    // al framework, che lo converte in 500 a runtime.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockRejectedValue(new Error("DB error"));
    await expect(EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"))).rejects.toThrow("DB error");
  });

  it("audit trail: registra voce di storico per export con segnalazioni", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1", numeroProtocollo: "P1", stato: "approvata",
        dataSegnalazione: new Date("2026-01-01"),
        indirizzoVia: "Via 1", cap: "24040",
        latitudine: null, longitudine: null, nomeEsercizio: null,
        chkVetroPianoInclinato: false, chkVetroCurvo: false,
        chkAltroTipologia: false, notaAltroTipologia: null,
        chkLuceVersoAlto: false, chkAbbagliamento: false,
        chkLuceIntrusiva: false, chkAltroProblema: false, notaAltroProblema: null,
        descrizioneLibera: null, destinatarioNome: null,
        includiArpa: false, pecCcAggiuntive: null, oggettoPec: null,
        mittenteVisibile: true, dataInvio: null, livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" }, provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null, allegati: [],
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(db.storicoStato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        segnalazioneId: "s1",
        userId: "u-admin",
        nota: expect.stringContaining("Export CSV"),
      }),
    }));
  });

  it("audit trail best-effort: non blocca export se storico fallisce", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1", numeroProtocollo: "P1", stato: "approvata",
        dataSegnalazione: new Date("2026-01-01"),
        indirizzoVia: "Via 1", cap: "24040",
        latitudine: null, longitudine: null, nomeEsercizio: null,
        chkVetroPianoInclinato: false, chkVetroCurvo: false,
        chkAltroTipologia: false, notaAltroTipologia: null,
        chkLuceVersoAlto: false, chkAbbagliamento: false,
        chkLuceIntrusiva: false, chkAltroProblema: false, notaAltroProblema: null,
        descrizioneLibera: null, destinatarioNome: null,
        includiArpa: false, pecCcAggiuntive: null, oggettoPec: null,
        mittenteVisibile: true, dataInvio: null, livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" }, provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null, allegati: [],
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockRejectedValue(new Error("DB error"));
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    // L'export deve comunque avere successo: l'audit trail è best-effort
    expect(res.status).toBe(200);
  });

  it("rate limit: blocca al 6° export (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
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

  it("applica il filtro search alla query (riga 91-99: where.OR con 4 campi)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    // Chiama export con ?search=via: la route deve costruire where.OR con
    // i 4 campi (numeroProtocollo, indirizzoVia, nomeEsercizio, comune.nome).
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?search=via"));
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ numeroProtocollo: expect.objectContaining({ contains: "via" }) }),
          expect.objectContaining({ indirizzoVia: expect.objectContaining({ contains: "via" }) }),
          expect.objectContaining({ nomeEsercizio: expect.objectContaining({ contains: "via" }) }),
          expect.objectContaining({ comune: expect.objectContaining({ nome: expect.any(Object) }) }),
        ]),
      }),
    }));
  });

  it("search viene troncato a 200 caratteri (riga 92: search.slice(0, 200))", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    const lungo = "x".repeat(250);
    await EXPORT_GET(makeGetReq(`http://localhost/api/segnalazioni/export?search=${lungo}`));
    // Verifica che il parametro search sia stato troncato a 200 caratteri
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ numeroProtocollo: expect.objectContaining({ contains: "x".repeat(200) }) }),
        ]),
      }),
    }));
  });

  it("stato='all' non applica il filtro stato (riga 90: short-circuit su stato !== 'all')", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?stato=all"));
    // where non contiene la chiave "stato" perché stato==='all' è escluso
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ stato: expect.anything() }),
    }));
  });

  it("esporta segnalazione con tutti i flag true e campi null (rami ternari e ?? su righe 175-205)", async () => {
    // Segnalazione con tutti i checkbox true, mittenteVisibile false,
    // dataInvio impostato, allegati null, volontario/comune/provincia/regione
    // null, dataSegnalazione null: copre tutti i rami residui della
    // mappatura CSV (ternari true, ?? "" su null, dataInvio true, ecc.).
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s-full",
        numeroProtocollo: "P-FULL",
        dataSegnalazione: null, // ? : "" false branch (riga 175)
        stato: "inviata",
        indirizzoVia: "Via Full 1",
        cap: "24040",
        latitudine: null,
        longitudine: null,
        nomeEsercizio: "Bar Full",
        chkVetroPianoInclinato: true,
        chkVetroCurvo: true, // ? "Sì" true (riga 189)
        chkAltroTipologia: true, // ? "Sì" true (riga 190)
        notaAltroTipologia: "Nota tip",
        chkLuceVersoAlto: true,
        chkAbbagliamento: true, // ? "Sì" true (riga 193)
        chkLuceIntrusiva: true, // ? "Sì" true (riga 194)
        chkAltroProblema: true, // ? "Sì" true (riga 195)
        notaAltroProblema: "Nota prob",
        descrizioneLibera: "Descrizione",
        destinatarioNome: "Sindaco",
        includiArpa: true, // ? "Sì" true (riga 199)
        pecCcAggiuntive: "cc@pec.it",
        oggettoPec: "Oggetto",
        mittenteVisibile: false, // ? "Referente" false (riga 202)
        dataInvio: new Date("2026-01-01"), // ? true (riga 203)
        livelloRecidiva: 2,
        createdAt: new Date("2026-01-01"),
        comune: null, // ?? "" (riga 181)
        provincia: null, // ?? "" (riga 183)
        regione: null, // ?? "" (riga 184)
        volontario: null, // ?? "" (riga 177, 178)
        referenteApprovatore: null,
        allegati: null, // ?? 0 (riga 205)
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    const res = await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Verifica che i valori "Sì" siano presenti per tutti i checkbox true
    const siCount = (text.match(/Sì/g) || []).length;
    expect(siCount).toBeGreaterThanOrEqual(6); // 6 checkbox true
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
        cap: "24040",
        latitudine: null, longitudine: null, nomeEsercizio: null,
        chkVetroPianoInclinato: false, chkVetroCurvo: false,
        chkAltroTipologia: false, notaAltroTipologia: null,
        chkLuceVersoAlto: false, chkAbbagliamento: false,
        chkLuceIntrusiva: false, chkAltroProblema: false, notaAltroProblema: null,
        descrizioneLibera: null, destinatarioNome: null,
        includiArpa: false, pecCcAggiuntive: null, oggettoPec: null,
        mittenteVisibile: true, dataInvio: null, livelloRecidiva: 1,
        createdAt: new Date("2026-01-01"),
        comune: { nome: "X" }, provincia: { sigla: "BG" },
        regione: { regione: "LOMBARDIA" },
        volontario: { id: "v1", nomeCognome: "M", email: "m@t.it" },
        referenteApprovatore: null, allegati: [],
      },
    ] as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    await EXPORT_GET(makeGetReq("http://localhost/api/segnalazioni/export?stato=bozza&search=via"));
    // Verifica che where.stato sia impostato a "bozza"
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stato: "bozza" }),
    }));
    // Verifica che l'audit trail registri stato=bozza e search=sì
    expect(db.storicoStato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nota: expect.stringContaining("stato=bozza"),
      }),
    }));
    expect(db.storicoStato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nota: expect.stringContaining("search=sì"),
      }),
    }));
  });
});
