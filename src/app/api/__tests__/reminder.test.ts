/**
 * Test di integrazione per /api/reminder
 * Copre:
 * - GET: elenco pratiche in_attesa oltre soglia (con filtro territoriale per referente)
 * - POST: azioni di manutenzione (cleanup, auto-transition, gdpr-anonymize)
 *
 * - 401 per non autenticato, 403 per volontario (la route richiede canReviewSegnalazioni)
 * - 403 per referente sulle azioni di manutenzione POST (riservate all'admin)
 * - 400 per action non valida
 * - 200 con count=0 per referente senza territorio (fail-closed)
 * - 200 con risultati per admin/referente territoriale
 * - 200 per ogni action ammessa (cleanup, auto-transition, gdpr-anonymize)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/db", () => {
  const inner = {
    segnalazione: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    allegato: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    storicoStato: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    logInvioPec: {
      updateMany: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
  };
  // $transaction supporta due forme in Prisma:
  //  - array di PrismaPromise: ritorna Promise<result[]>
  //  - callback interattiva (tx) => Promise<T>: ritorna Promise<T>
  // Il mock gestisce entrambe: se l'argomento è una funzione, la esegue
  // passandogli `inner` come "tx"; se è un array, esegue tutte le promise
  // in parallelo e ritorna i risultati.
  const dbMock = {
    ...inner,
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: typeof inner) => Promise<unknown>)(inner);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return undefined;
    }),
  };
  return { db: dbMock };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/reminder/route";

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
const REF_REG_SESSION = {
  id: "s4",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-refr",
    email: "refr@t.it",
    nomeCognome: "Referente Regionale",
    ruolo: "referente_regionale",
    provinciaId: null,
    regioneId: 2,
    inizialiProtocollo: "RR",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
const REF_PROV_NO_TERR_SESSION = {
  id: "s5",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-refnt",
    email: "refnt@t.it",
    nomeCognome: "Ref No Terr",
    ruolo: "referente_provinciale",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "RT",
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

function makeGetReq(): NextRequest {
  return new NextRequest("http://localhost/api/reminder", { method: "GET" });
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/reminder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario (non può vedere i reminder)", async () => {
    mockSession(VOL_SESSION);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(403);
  });

  it("ritorna 200 con count=0 per referente provinciale senza territorio assegnato (fail-closed)", async () => {
    mockSession(REF_PROV_NO_TERR_SESSION);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(0);
    expect(json.pratiche).toHaveLength(0);
    // Non deve aver chiamato findMany: ritorna prima senza fare la query
    expect(db.segnalazione.findMany).not.toHaveBeenCalled();
  });

  it("applica filtro provinciaId per referente provinciale con territorio", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    await GET(makeGetReq());
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stato: "in_attesa",
          provinciaId: 5,
        }),
      }),
    );
  });

  it("applica filtro regioneId per referente regionale con territorio", async () => {
    mockSession(REF_REG_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    await GET(makeGetReq());
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stato: "in_attesa",
          regioneId: 2,
        }),
      }),
    );
  });

  it("ritorna 200 con count=0 per referente regionale senza territorio (fail-closed)", async () => {
    const REF_REG_NO_TERR = {
      ...REF_REG_SESSION,
      user: { ...REF_REG_SESSION.user, regioneId: null },
    };
    mockSession(REF_REG_NO_TERR);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(0);
    expect(json.pratiche).toHaveLength(0);
    expect(db.segnalazione.findMany).not.toHaveBeenCalled();
  });

  it("count riporta il totale delle pratiche oltre la pagina restituita (massimo 100)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      { id: "s1", stato: "in_attesa", comune: { nome: "Verdello" }, provincia: { sigla: "BG" }, volontario: null },
    ] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(150 as never);
    const res = await GET(makeGetReq());
    const json = await res.json();
    expect(db.segnalazione.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(json.pratiche).toHaveLength(1);
    expect(json.count).toBe(150);
  });

  it("ritorna 200 con pratiche per admin (nessun filtro territoriale)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([
      {
        id: "s1",
        stato: "in_attesa",
        comune: { nome: "Verdello" },
        provincia: { sigla: "BG" },
        volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it" },
      },
    ] as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(1 as never);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.pratiche).toHaveLength(1);
    expect(json.sogliaGiorni).toBe(30);
    expect(json.transizioneGiorni).toBe(7);
  });
});

describe("POST /api/reminder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await POST(makePostReq({ action: "cleanup" }));
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario (non può eseguire maintenance)", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makePostReq({ action: "cleanup" }));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 per referente non admin (anche con territorio)", async () => {
    // Le azioni di maintenance sono riservate al solo admin
    mockSession(REF_PROV_SESSION);
    const res = await POST(makePostReq({ action: "cleanup" }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("amministratore");
  });

  it("ritorna 400 se action non valida", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makePostReq({ action: "azione-inventata" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Azione non valida");
  });

  it("ritorna 400 se action mancante", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);
  });

  it("azione cleanup: ritorna 200 con sessioniPulite", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 7 } as never);
    const res = await POST(makePostReq({ action: "cleanup" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("cleanup");
    expect(json.sessioniPulite).toBe(7);
    expect(json.transizioniAutomatiche).toBe(0);
    expect(json.segnalazioniAnonimizzate).toBe(0);
  });

  it("azione auto-transition: transita inviata -> in_attesa dopo soglia giorni", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await POST(makePostReq({ action: "auto-transition" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("auto-transition");
    expect(json.transizioniAutomatiche).toBe(2);
    // Verifica che updateMany usi clausola WHERE su stato="inviata" per atomicità
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stato: "inviata" }),
        data: { stato: "in_attesa" },
      }),
    );
    // Verifica che lo storico sia stato creato per ogni transizione
    expect(db.storicoStato.create).toHaveBeenCalledTimes(2);
  });

  it("azione auto-transition: salta storico se updateMany count=0 (race condition)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([{ id: "s1" }] as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    const res = await POST(makePostReq({ action: "auto-transition" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transizioniAutomatiche).toBe(0);
    // Lo storico non deve essere creato se la transizione non è avvenuta
    expect(db.storicoStato.create).not.toHaveBeenCalled();
  });

  it("azione gdpr-anonymize: anonimizza segnalazioni oltre retention", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([{ id: "s1" }] as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([{ id: "a1", urlStorage: "s1/file.jpg" }] as never);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 3 } as never);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(db.storicoStato.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.logInvioPec.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await POST(makePostReq({ action: "gdpr-anonymize" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("gdpr-anonymize");
    expect(json.segnalazioniAnonimizzate).toBe(1);
    // Verifica eliminazione allegati
    expect(db.allegato.deleteMany).toHaveBeenCalledWith({ where: { segnalazioneId: "s1" } });
    // Verifica update con dati anonimizzati
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "s1", volontarioId: { not: null } }),
        data: expect.objectContaining({
          volontarioId: null,
          indirizzoVia: "[ANONIMIZZATA]",
          nomeEsercizio: null,
          latitudine: null,
          longitudine: null,
        }),
      }),
    );
    // Verifica storico di anonimizzazione
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          segnalazioneId: "s1",
          statoPrecedente: null,
          statoNuovo: null,
          nota: expect.stringContaining("GDPR"),
        }),
      }),
    );
  });

  it("azione gdpr-anonymize: ritorna 0 se nessuna segnalazione oltre retention", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findMany).mockResolvedValue([] as never);
    const res = await POST(makePostReq({ action: "gdpr-anonymize" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segnalazioniAnonimizzate).toBe(0);
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
    expect(db.segnalazione.update).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// POST /api/reminder - corpo non valido
// -----------------------------------------------------------------------------
describe("POST /api/reminder - corpo non valido", () => {
  it("ritorna 400 se il corpo non è un oggetto JSON (nessuna azione riconosciuta)", async () => {
    mockSession(ADMIN_SESSION);
    const res = await POST(
      new NextRequest("http://localhost/api/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "non-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
