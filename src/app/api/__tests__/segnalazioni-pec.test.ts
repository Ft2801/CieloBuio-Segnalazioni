/**
 * Test di integrazione per:
 * - POST /api/segnalazioni/[id]/invia-pec
 * - POST /api/segnalazioni/[id]/simula-pec
 *
 * Copre: 403 (non autorizzato), 404 (non trovata), 400 (stato non approvata,
 * PEC-DA-CONFIGURARE, nessun destinatario), 409 (race condition su updateMany),
 * 429 (rate limit), 500 (errore SMTP, mittente non configurato), 200 (successo).
 *
 * Il mock di nodemailer usa il pattern vi.hoisted come in
 * src/lib/__tests__/notifiche-smtp.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Configurazione SMTP di base per tutti i test del file: i casi senza SMTP la rimuovono esplicitamente.
beforeEach(() => {
  process.env.PEC_SMTP_HOST = "smtp.pec.it";
  process.env.PEC_SMTP_PORT = "465";
  process.env.PEC_SMTP_USER = "user@pec.it";
  process.env.PEC_SMTP_PASSWORD = "pass";
  process.env.PEC_FROM = "from@pec.it";
});

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Pattern vi.hoisted per nodemailer (vedi notifiche-smtp.test.ts)
const { mockSendMail, mockCreateTransport } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockCreateTransport: vi.fn(),
}));
vi.mock("nodemailer", () => {
  const createTransport = mockCreateTransport.mockReturnValue({
    close: vi.fn(),
    sendMail: mockSendMail,
  });
  return { createTransport, default: { createTransport } };
});

// Mock di @/lib/protocollo per isolare il test della route
vi.mock("@/lib/protocollo", () => ({
  generaNumeroProtocollo: vi.fn(),
  calcolaProtocolloPrevisionale: vi.fn(),
  ErroreProtocollo: class ErroreProtocollo extends Error {
    constructor(messaggio: string) {
      super(messaggio);
      this.name = "ErroreProtocollo";
    }
  },
}));

// Mock di @/lib/lettera per isolare il test della route
vi.mock("@/lib/lettera", () => ({
  buildLetteraContextFromSegnalazione: vi.fn(),
  generaTestoLettera: vi.fn().mockReturnValue("corpo lettera"),
  generaHtmlLettera: vi.fn().mockReturnValue("<html></html>"),
  PEC_MITTENTE_NON_CONFIGURATA: "indirizzo PEC non configurato",
}));

// Mock di @/lib/notifiche (fire-and-forget in invia-pec)
vi.mock("@/lib/notifiche", () => ({
  notificaPecInviata: vi.fn().mockResolvedValue(undefined),
}));

// Mock di fs/promises (verifica esistenza allegati in invia-pec)
vi.mock("fs/promises", () => ({
  lstat: vi.fn().mockResolvedValue({ isSymbolicLink: () => false }),
  stat: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    segnalazione: {
      findUnique: vi.fn(),
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
    logInvioPec: {
      create: vi.fn().mockResolvedValue({ id: "log-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  // $transaction: la callback riceve lo stesso mock come tx.
  Object.assign(mockDb, {
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  });
  return { db: mockDb };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { ErroreProtocollo, calcolaProtocolloPrevisionale, generaNumeroProtocollo } from "@/lib/protocollo";
import { buildLetteraContextFromSegnalazione } from "@/lib/lettera";
import { POST as INVIA_PEC } from "@/app/api/segnalazioni/[id]/invia-pec/route";
import { POST as SIMULA_PEC } from "@/app/api/segnalazioni/[id]/simula-pec/route";
import { stat } from "fs/promises";

const ADMIN_SESSION = {
  id: "s1",
  token: "tok",
  scadenza: new Date(Date.now() + 365 * 86400 * 1000),
  user: {
    id: "u-admin",
    email: "admin@t.it",
    nomeCognome: "Admin",
    ruolo: "admin",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "AD",
    pec: "admin@pec.it",
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
const VOL_SESSION = {
  id: "s2",
  token: "tok",
  scadenza: new Date(Date.now() + 365 * 86400 * 1000),
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
// Referente provinciale con provinciaId=2 (diversa dalla provincia della
// segnalazione di test, che è 1): serve per coprire il ramo di fallimento
// di hasTerritorialCompetence (403 "Non autorizzato per questa segnalazione").
const REF_PROV_OTHER_SESSION = {
  id: "s3",
  token: "tok",
  scadenza: new Date(Date.now() + 365 * 86400 * 1000),
  user: {
    id: "u-ref-other",
    email: "ref-other@t.it",
    nomeCognome: "Ref Other",
    ruolo: "referente_provinciale",
    provinciaId: 2,
    regioneId: 1,
    inizialiProtocollo: "RO",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
// Referente provinciale con provinciaId=1 (stessa della segnalazione di
// test): ha competenza territoriale e può inviare/simulare PEC.
const REF_PROV_SESSION = {
  id: "s4",
  token: "tok",
  scadenza: new Date(Date.now() + 365 * 86400 * 1000),
  user: {
    id: "u-ref",
    email: "ref@t.it",
    nomeCognome: "Referente",
    ruolo: "referente_provinciale",
    provinciaId: 1,
    regioneId: 1,
    inizialiProtocollo: "RF",
    pec: "ref@pec.it",
    emailOrdinaria: "ref@ord.it",
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};

/**
 * updateMany riceve sia il lease PEC (campi invioPecLock*) sia l'aggiornamento
 * dello stato: il mock risponde in modo diverso ai due casi.
 */
function impostaUpdateMany(conteggioStato: number, conteggioLock = 1) {
  vi.mocked(db.segnalazione.updateMany).mockImplementation((async (args: { data: Record<string, unknown> }) =>
    "stato" in args.data ? { count: conteggioStato } : { count: conteggioLock }) as never);
}

function mockSession(user: unknown) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

function makeReq(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/segnalazioni/s1/invia-pec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Crea una segnalazione "approvata" con comune/provincia/regione popolati,
 * pronta per l'invio PEC. Il parametro overrides permette di personalizzare
 * campi specifici nei test (es. stato, comune.pecComune, regione.pecArpaRegionale).
 */
function mockSegnalazioneApprovata(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    stato: "approvata",
    numeroProtocollo: null,
    volontarioId: "u-vol",
    provinciaId: 1,
    regioneId: 1,
    dataSegnalazione: new Date("2026-01-01"),
    indirizzoVia: "Via Roma 1",
    cap: "24049",
    oggettoPec: "Oggetto PEC",
    pecCcAggiuntive: null,
    includiArpa: false,
    mittenteVisibile: true,
    comune: { id: 1, nome: "Verdello", pecComune: "comune@pec.it", nomeSindaco: "Sindaco" },
    provincia: {
      id: 1,
      sigla: "BG",
      regioneId: 1,
      regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15" },
    },
    regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: null },
    volontario: {
      id: "u-vol",
      nomeCognome: "Mario Rossi",
      email: "m@t.it",
      pec: "mario@pec.it",
      emailOrdinaria: null,
      inizialiProtocollo: "MR",
    },
    ...overrides,
  };
}

describe("POST /api/segnalazioni/[id]/invia-pec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
    impostaUpdateMany(1);
  });
  afterEach(() => {
    __resetRateLimitStoreForTests();
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario (non può inviare PEC)", async () => {
    mockSession(VOL_SESSION);
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se stato non è approvata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ stato: "in_revisione" }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("ritorna 400 se il comune non ha PEC, anche con ARPA o CC aggiuntive", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        comune: { id: 1, nome: "X", pecComune: "", nomeSindaco: null },
        includiArpa: true,
        pecCcAggiuntive: "altro@pec.it",
      }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Il Comune non ha una PEC");
    expect(vi.mocked(db.segnalazione.update)).not.toHaveBeenCalled();
  });

  it("ritorna 400 se la PEC del comune non è un indirizzo valido", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        comune: {
          id: 1,
          nome: "X",
          pecComune: "PEC-DA-CONFIGURARE",
          nomeSindaco: null,
        },
      }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("indirizzi non validi");
    expect(db.segnalazione.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "inviata" }),
      }),
    );
  });

  it("ritorna 500 se mittente PEC non configurato (no PEC_FROM e no user.pec)", async () => {
    mockSession({
      ...ADMIN_SESSION,
      user: { ...ADMIN_SESSION.user, pec: null },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    // Nessun PEC_FROM e nessun user.pec
    delete process.env.PEC_FROM;
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Mittente PEC non configurato");
  });

  it("senza configurazione SMTP ritorna 503 e non modifica lo stato", async () => {
    delete process.env.PEC_SMTP_HOST;
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(503);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "inviata" }),
      }),
    );
    expect(db.logInvioPec.create).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("invia PEC con successo via SMTP reale (PEC_SMTP_HOST configurato)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as never)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    impostaUpdateMany(1);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalled();
    expect(db.logInvioPec.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: "reale", esito: "in_corso" }) }),
    );
    expect(db.logInvioPec.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ esito: "ok" }) }),
    );
  });

  it("ritorna 500 se l'invio SMTP fallisce (esito errore)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    // Il tentativo resta bloccato in caso di esito SMTP incerto.
    expect(db.logInvioPec.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "incerto", messaggioErrore: "SMTP connection refused" }),
      }),
    );
    // Lo stato NON deve essere aggiornato (updateMany non chiamato)
    expect(db.segnalazione.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: expect.anything() }),
      }),
    );
  });

  it("ritorna 409 se updateMany ritorna count=0 (race condition su stato)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    // Simula: lo stato è cambiato concorrentemente tra findUnique e updateMany
    impostaUpdateMany(0);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("includiArpa=true aggiunge pecArpaRegionale ai destinatari", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(
        mockSegnalazioneApprovata({
          includiArpa: true,
          regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
        }) as never,
      )
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    impostaUpdateMany(1);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.destinatari).toContain("comune@pec.it");
    expect(json.destinatari).toContain("arpa@pec.it");
  });

  it("rate limit: blocca al 6° tentativo PEC (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    // 5 invii permessi, al 6° scatta il blocco del rate limit (prima del findUnique)
    for (let i = 0; i < 5; i++) {
      vi.mocked(db.segnalazione.findUnique)
        .mockResolvedValueOnce(mockSegnalazioneApprovata() as never)
        .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
      impostaUpdateMany(1);
      vi.mocked(generaNumeroProtocollo).mockResolvedValue("P");
      vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
      vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
      vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
      vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
      const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
      expect(res.status).toBe(200);
    }
    // 6° tentativo: bloccato dal rate limit
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppi invii PEC");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("parsa pecCcAggiuntive e aggiunge destinatari CC deduplicati", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        pecCcAggiuntive: "cc1@pec.it; cc2@pec.it; comune@pec.it", // l'ultimo duplica il comune
      }) as never,
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-CC-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // Verifica che sendMail sia stato chiamato con i CC (deduplicati)
    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toContain("comune@pec.it");
    expect(call.to).toContain("cc1@pec.it");
    expect(call.to).toContain("cc2@pec.it");

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("includiArpa=true con pecArpaRegionale aggiunge ARPA ai destinatari", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        includiArpa: true,
        regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R.", pecArpaRegionale: "arpa@pec.it" },
      }) as never,
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-ARPA-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toContain("arpa@pec.it");

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("allegato con urlStorage fuori formato blocca l'invio PEC con 500", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-ATT-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/file.jpg", nomeOriginale: "foto.jpg", tipo: "foto", createdAt: new Date() },
      {
        id: "a2",
        urlStorage: "formato/non/valido/s1/old.pdf",
        nomeOriginale: "old.pdf",
        tipo: "documento",
        createdAt: new Date(),
      },
    ] as never);
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("allegato con file mancante blocca l'invio PEC senza modificare lo stato", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-NO-FILE");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/missing.jpg", nomeOriginale: "missing.jpg", tipo: "foto", createdAt: new Date() },
    ] as never);
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"));
    mockSendMail.mockClear();

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("missing.jpg");
    expect(json.error).toContain("PEC non inviata");
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(generaNumeroProtocollo).not.toHaveBeenCalled();
    expect(db.segnalazione.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: "inviata" }) }),
    );

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("invio reale con PEC_SMTP_HOST configurato usa PEC_FROM come mittente", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-SMTP-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);
    mockSendMail.mockResolvedValue({
      messageId: "<smtp-id>",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // Verifica che sendMail sia stato chiamato con from personalizzato
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@cielobuio.it",
      }),
    );

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  // ---------------------------------------------------------------------------
  // Test mirati per rami residui (coverage 100%)
  // ---------------------------------------------------------------------------

  it("ritorna 403 se referente non ha competenza territoriale", async () => {
    // Referente provinciale con provinciaId=2: la segnalazione mock ha
    // provinciaId=1, dunque hasTerritorialCompetence restituisce false.
    mockSession(REF_PROV_OTHER_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("ritorna 400 se segnalazione anonimizzata (volontario null) e senza protocollo", async () => {
    // Segnalazione post-anonimizzazione GDPR: volontario e volontarioId
    // nulli. Manca anche il numeroProtocollo, dunque si entra nel ramo di
    // generazione e si scopre che non è possibile (manca il segnalatore).
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        numeroProtocollo: null,
        volontarioId: null,
        volontario: null,
      }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("anonimizzata");
  });

  it("ritorna 400 se regione e provincia non determinabili", async () => {
    // Segnalazione con volontario presente ma regione e provincia assenti:
    // non è possibile derivare provinciaSigla/regione per il protocollo.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        numeroProtocollo: null,
        provincia: null,
        regione: null,
      }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Regione o provincia non determinabile");
  });
});

describe("POST /api/segnalazioni/[id]/simula-pec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
  });
  afterEach(() => {
    __resetRateLimitStoreForTests();
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 403 per volontario", async () => {
    mockSession(VOL_SESSION);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se stato non è approvata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ stato: "in_revisione" }) as never,
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("simulazione senza invio ritorna 200 con emailInviata=false", async () => {
    delete process.env.PEC_SMTP_HOST;
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.emailInviata).toBe(false);
    expect(json.numeroProtocollo).toContain("previsionale");
    expect(json.messaggio).toContain("Simulazione registrata");
    // Il log deve essere di tipo "simula"
    expect(db.logInvioPec.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: "simula", esito: "ok" }),
      }),
    );
  });

  it("simulazione via SMTP reale invia email al mittente -> 200 con emailInviata=true", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailInviata).toBe(true);
    expect(json.mittentePec).toBeTruthy();
    expect(mockSendMail).toHaveBeenCalled();
  });

  it("ritorna 500 se l'invio SMTP fallisce in modalità reale", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    mockSendMail.mockRejectedValue(new Error("SMTP timeout"));

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(db.logInvioPec.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "errore", messaggioErrore: "SMTP timeout" }),
      }),
    );
  });

  it("rate limit: blocca al 11° tentativo (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    // 10 simulazioni permesse, al 11° scatta il blocco
    for (let i = 0; i < 10; i++) {
      const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
      expect(res.status).toBe(200);
    }
    // 11° tentativo: bloccato
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppe simulazioni");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test mirati per rami residui (coverage 100%)
  // ---------------------------------------------------------------------------

  it("ritorna 403 se referente non ha competenza territoriale (simulazione)", async () => {
    // Referente provinciale con provinciaId=2: la segnalazione mock ha
    // provinciaId=1, dunque hasTerritorialCompetence restituisce false.
    mockSession(REF_PROV_OTHER_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("mittenteVisibile=false usa user.pec quando presente", async () => {
    // mittenteVisibile=false: il mittente è il referente, non il volontario.
    // Con user.pec impostato (REF_PROV_SESSION ha pec="ref@pec.it"), la catena
    // ?? si ferma al primo elemento.
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-MV-FALSE");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mittentePec).toBe("ref@pec.it");
  });

  it("mittenteVisibile=false con user.pec null usa user.emailOrdinaria", async () => {
    // user.pec null, user.emailOrdinaria="ref2@ord.it": la catena ?? salta
    // pec nullish e restituisce emailOrdinaria.
    mockSession({
      ...REF_PROV_SESSION,
      user: {
        ...REF_PROV_SESSION.user,
        pec: null,
        emailOrdinaria: "ref2@ord.it",
      },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-ORD");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mittentePec).toBe("ref2@ord.it");
  });

  it("mittenteVisibile=false con user.pec e emailOrdinaria null usa user.email", async () => {
    // user.pec null, user.emailOrdinaria null: la catena ?? arriva fino a
    // user.email, coprendo l'ultimo ramo della catena.
    mockSession({
      ...REF_PROV_SESSION,
      user: {
        ...REF_PROV_SESSION.user,
        pec: null,
        emailOrdinaria: null,
        email: "ref3@t.it",
      },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mittentePec).toBe("ref3@t.it");
  });
});

// ============================================================================
// Test per copertura 100% branches residui in invia-pec e simula-pec
// ============================================================================

describe("POST /api/segnalazioni/[id]/invia-pec - rami residui coverage 100%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
  });

  it("usa provincia.regione quando segnalazione.regione è null (invio)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        regione: null, // Forza uso di provincia?.regione
        provincia: {
          id: 1,
          sigla: "BG",
          regioneId: 1,
          regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
        },
      }) as never,
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-REG-NULL");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("usa oggettoPec null con oggetto vuoto (invio)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata({ oggettoPec: null }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-NULL-OGG");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("gestisce errore SMTP non-Error come esito di errore (invio)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-ERR-SMTP" }) as never,
    );
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);
    impostaUpdateMany(1);
    // Rejection con non-Error (stringa)
    mockSendMail.mockRejectedValue("SMTP connection failed" as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(db.logInvioPec.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ esito: "incerto" }) }),
    );

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("allegato con path traversal blocca l'invio PEC", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-TRAVERSAL" }) as never,
    );
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "../passwd", nomeOriginale: "evil.jpg", tipo: "foto", createdAt: new Date() },
      { id: "a2", urlStorage: "s1/valid.jpg", nomeOriginale: "valid.jpg", tipo: "foto", createdAt: new Date() },
    ] as never);
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    mockSendMail.mockClear();

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();

    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });
});

describe("POST /api/segnalazioni/[id]/simula-pec - rami residui coverage 100%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "sim-ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
    // Pulisci tutte le env vars SMTP tra i test
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_FROM;
  });

  afterEach(() => {
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_FROM;
  });

  it("usa provincia.regione quando segnalazione.regione è null (simulazione)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        regione: null,
        provincia: {
          id: 1,
          sigla: "BG",
          regioneId: 1,
          regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
        },
      }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-SIM-REG-NULL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("previsionale null ritorna numeroProtocollo null", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: null }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue(null);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numeroProtocollo).toBeNull();
  });

  it("mittenteVisibile=true con volontario null non blocca la simulazione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: null, // Volontario anonimizzato
      }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-VOL-NULL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("invio SMTP con porta di default e PEC_FROM assente", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    // Non impostare PEC_SMTP_PORT (default 465)
    // Non impostare PEC_FROM (usa user.pec)
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_FROM;

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-SMTP-DEFAULT" }) as never,
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
  });

  it("oggettoPec null usa oggetto vuoto (simulazione)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ oggettoPec: null, numeroProtocollo: "P-NULL-OGG-SIM" }) as never,
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).emailInviata).toBe(true);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("errore SMTP non-Error come esito di errore (simulazione)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-ERR-SIM" }) as never,
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    mockSendMail.mockRejectedValue("SMTP timeout" as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(db.logInvioPec.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "errore" }),
      }),
    );

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("mittentePec assente dalla risposta quando il volontario è anonimizzato", async () => {
    mockSession({
      ...ADMIN_SESSION,
      user: { ...ADMIN_SESSION.user, pec: null, emailOrdinaria: null, email: null },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: true, volontario: null }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-NULL-MITT");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).mittentePec).toBeUndefined();
  });

  it("mittenteVisibile=true: vol.pec null usa emailOrdinaria", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: {
          id: "u-vol",
          nomeCognome: "Mario",
          email: "m@t.it",
          pec: null,
          emailOrdinaria: "mario@ord.it",
          inizialiProtocollo: "MR",
        },
      }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL-ORD");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).mittentePec).toBe("mario@ord.it");
  });

  it("mittenteVisibile=true: vol.pec e emailOrdinaria null usa email", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: {
          id: "u-vol",
          nomeCognome: "Mario",
          email: "mario@t.it",
          pec: null,
          emailOrdinaria: null,
          inizialiProtocollo: "MR",
        },
      }) as never,
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL-ONLY");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).mittentePec).toBe("mario@t.it");
  });

  it("SMTP senza PEC_FROM usa la PEC dell'utente come mittente", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    delete process.env.PEC_FROM;

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-FROM-USER" }) as never,
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    mockSendMail.mockClear();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "admin@pec.it" }));

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
  });
});

describe("POST /api/segnalazioni/[id]/invia-pec: lease persistito", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
  });

  it("ritorna 409 se un altro processo detiene il lease (nessun invio)", async () => {
    mockSession(ADMIN_SESSION);
    impostaUpdateMany(1, 0);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValueOnce({ id: "s1" } as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("già in corso");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("ritorna 404 se il lease non è acquisibile perché la segnalazione non esiste", async () => {
    mockSession(ADMIN_SESSION);
    impostaUpdateMany(1, 0);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValueOnce(null);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "inesistente" }) });
    expect(res.status).toBe(404);
  });

  it("completa l'invio anche se il rilascio del lease fallisce (il lock scade da solo)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as never)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(db.segnalazione.updateMany).mockImplementation((async (args: { data: Record<string, unknown> }) => {
      if (args.data.invioPecLockToken === null) throw new Error("db non raggiungibile");
      return { count: 1 };
    }) as never);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// simula-pec: rami del destinatario di controllo e del mittente
// -----------------------------------------------------------------------------
describe("POST /api/segnalazioni/[id]/simula-pec - rami residui", () => {
  const SESSIONE_SENZA_PEC = {
    id: "s9",
    token: "tok",
    scadenza: new Date(Date.now() + 365 * 86400 * 1000),
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

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_FROM = "mittente@pec.it";
  });

  afterEach(() => {
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_FROM;
  });

  it("con mittente non visibile il destinatario di controllo è la PEC dell'utente", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as never,
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@pec.it" }));
  });

  it("se manca ogni recapito del volontario la simulazione non invia e registra l'errore", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ volontario: null, mittenteVisibile: true }) as never,
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(vi.mocked(db.logInvioPec.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "errore", destinatari: "" }),
      }),
    );
  });

  it("senza PEC_FROM e senza PEC sull'utente la simulazione non invia", async () => {
    delete process.env.PEC_FROM;
    mockSession(SESSIONE_SENZA_PEC);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("senza PEC_FROM usa la PEC dell'utente come mittente", async () => {
    delete process.env.PEC_FROM;
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "admin@pec.it" }));
  });

  it("un errore nella registrazione del log non blocca la risposta", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as never);
    vi.mocked(db.logInvioPec.create).mockRejectedValue(new Error("db down"));
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Rami residui di invia-pec: mittente non visibile, segnaposto, allegati non
// validi, errori di log, di transazione e di notifica (non bloccanti).
// -----------------------------------------------------------------------------
describe("POST /api/segnalazioni/[id]/invia-pec - rami residui", () => {
  function impostaInvioDemo(allegati: unknown[] = []) {
    mockSession(ADMIN_SESSION);
    // Azzera eventuali valori "once" rimasti da un test precedente.
    vi.mocked(db.segnalazione.findUnique).mockReset();
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as never)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR02");
    vi.mocked(db.allegato.findMany).mockResolvedValue(allegati as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    impostaUpdateMany(1);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.segnalazione.findUnique).mockReset();
    vi.mocked(db.logInvioPec.findFirst).mockReset().mockResolvedValue(null);
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({
      messageId: "ok",
      accepted: ["comune@pec.it", "arpa@pec.it", "cc1@pec.it", "cc2@pec.it"],
    });
    delete process.env.PEC_FROM;
  });

  it("non invia di nuovo se un tentativo precedente è ancora incerto", async () => {
    impostaInvioDemo();
    vi.mocked(db.logInvioPec.findFirst).mockResolvedValueOnce({ id: "precedente" } as never);
    mockSendMail.mockClear();
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(generaNumeroProtocollo).not.toHaveBeenCalled();
  });

  it("rifiuta una prenotazione concorrente anche dopo il controllo preliminare", async () => {
    impostaInvioDemo();
    vi.mocked(db.logInvioPec.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "gia-iniziato" } as never);
    mockSendMail.mockClear();
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    expect(db.logInvioPec.create).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("non invia se il lease è stato riassegnato durante la preparazione", async () => {
    impostaInvioDemo();
    vi.mocked(db.segnalazione.updateMany).mockImplementation((async (args: { data: Record<string, unknown> }) => ({
      count: "invioPecLockAt" in args.data && !("invioPecLockToken" in args.data) ? 0 : 1,
    })) as never);
    mockSendMail.mockClear();
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("una consegna SMTP parziale richiede verifica e non cambia lo stato", async () => {
    impostaInvioDemo();
    mockSendMail.mockResolvedValueOnce({ messageId: "parziale", accepted: ["arpa@pec.it"] });
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).invioSmtpIncerto).toBe(true);
    expect(db.logInvioPec.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "incerto" }),
      }),
    );
    expect(db.segnalazione.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: "inviata" }),
      }),
    );
  });

  it("la mancata scrittura dell'esito incerto conserva il tentativo in corso", async () => {
    impostaInvioDemo();
    vi.mocked(db.logInvioPec.update).mockRejectedValueOnce(new Error("disco DB pieno"));
    mockSendMail.mockRejectedValueOnce(new Error("SMTP timeout"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(db.logInvioPec.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ esito: "in_corso" }),
      }),
    );
  });

  it("con mittente non visibile e PEC_FROM assente rifiuta l'invio con 400", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValueOnce(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as never,
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("PEC_FROM");
  });

  it("una lettera con mittente non configurato blocca l'invio con 400", async () => {
    process.env.PEC_FROM = "from@pec.it";
    impostaInvioDemo();
    const lettera = await import("@/lib/lettera");
    vi.mocked(lettera.generaTestoLettera).mockReturnValueOnce("testo con indirizzo PEC non configurato");
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("non configurato");
  });

  it("un allegato con URL non valido o di un'altra segnalazione blocca l'invio", async () => {
    mockSendMail.mockClear();
    impostaInvioDemo([{ urlStorage: "formato-non-valido", nomeOriginale: "a.pdf" }]);
    const primo = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(primo.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();

    impostaInvioDemo([{ urlStorage: "altra-segnalazione/file.pdf", nomeOriginale: "b.pdf" }]);
    const secondo = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(secondo.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("un errore di protocollo (regione non valida) risponde 400 con il messaggio", async () => {
    impostaInvioDemo();
    vi.mocked(generaNumeroProtocollo).mockRejectedValueOnce(
      new ErroreProtocollo('Regione "X" non riconosciuta per il numero di protocollo'),
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non riconosciuta");
  });

  it("un errore non di protocollo nella generazione del numero risponde 500 senza inviare", async () => {
    impostaInvioDemo();
    mockSendMail.mockClear();
    vi.mocked(generaNumeroProtocollo).mockRejectedValueOnce(new Error("db giù"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("non invia se il tentativo non può essere registrato prima di SMTP", async () => {
    impostaInvioDemo();
    vi.mocked(db.logInvioPec.create).mockRejectedValueOnce(new Error("log non disponibile"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(503);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("la mancata registrazione dell'esito dopo SMTP non autorizza un secondo invio", async () => {
    impostaInvioDemo();
    vi.mocked(db.logInvioPec.update).mockRejectedValueOnce(new Error("log non disponibile"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("un errore nell'aggiornamento dello stato dopo l'invio risponde 500 senza ritentare", async () => {
    impostaInvioDemo();
    vi.mocked(db.$transaction)
      .mockImplementationOnce((async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)) as never)
      .mockRejectedValueOnce(new Error("transazione annullata"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.invioSmtpAvvenuto).toBe(true);
    expect(json.error).toContain("Non ritentare l'invio");
  });

  it("un errore della notifica email non blocca la risposta", async () => {
    impostaInvioDemo();
    const notifiche = await import("@/lib/notifiche");
    vi.mocked(notifiche.notificaPecInviata).mockRejectedValueOnce(new Error("smtp giù"));
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifiche.notificaPecInviata).toHaveBeenCalled();
  });
});

// Il percorso degli allegati è risolto da path-guard: il wrapper resta fedele
// all'implementazione reale e consente di simulare un percorso non risolvibile.
vi.mock("@/lib/path-guard", async (importOriginale) => {
  const originale = await importOriginale<typeof import("@/lib/path-guard")>();
  return { ...originale, risolviPathAllegatoSicuro: vi.fn(originale.risolviPathAllegatoSicuro) };
});

describe("POST invia-pec - allegato con percorso non risolvibile", () => {
  it("l'allegato senza percorso risolvibile blocca l'invio PEC", async () => {
    const pg = await import("@/lib/path-guard");
    __resetRateLimitStoreForTests();
    delete process.env.PEC_FROM;
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockReset()
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as never)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as never);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR03");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { urlStorage: "s1/file.pdf", nomeOriginale: "file.pdf" },
    ] as never);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as never);
    impostaUpdateMany(1);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(pg.risolviPathAllegatoSicuro).mockReturnValueOnce(null);
    mockSendMail.mockClear();
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("POST /api/segnalazioni/[id]/simula-pec - errori del numero previsionale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSession(ADMIN_SESSION);
    // reset: rimuove eventuali valori "once" rimasti dai test precedenti
    vi.mocked(db.segnalazione.findUnique).mockReset();
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: null }) as never,
    );
  });

  it("regione non riconosciuta nel calcolo previsionale risponde 400 con il messaggio", async () => {
    vi.mocked(calcolaProtocolloPrevisionale).mockRejectedValueOnce(
      new ErroreProtocollo('Regione "X" non riconosciuta per il numero di protocollo'),
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("non riconosciuta");
  });

  it("un errore non di protocollo nel calcolo previsionale risponde 500", async () => {
    vi.mocked(calcolaProtocolloPrevisionale).mockRejectedValueOnce(new Error("db giù"));
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
  });
});
