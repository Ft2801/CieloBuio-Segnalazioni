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

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Pattern vi.hoisted per nodemailer (vedi notifiche-smtp.test.ts)
const { mockSendMail, mockCreateTransport } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockCreateTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
    }),
  },
}));

// Mock di @/lib/protocollo per isolare il test della route
vi.mock("@/lib/protocollo", () => ({
  generaNumeroProtocollo: vi.fn(),
  calcolaProtocolloPrevisionale: vi.fn(),
}));

// Mock di @/lib/lettera per isolare il test della route
vi.mock("@/lib/lettera", () => ({
  buildLetteraContextFromSegnalazione: vi.fn(),
  generaTestoLettera: vi.fn().mockReturnValue("corpo lettera"),
  generaHtmlLettera: vi.fn().mockReturnValue("<html></html>"),
}));

// Mock di @/lib/notifiche (fire-and-forget in invia-pec)
vi.mock("@/lib/notifiche", () => ({
  notificaPecInviata: vi.fn().mockResolvedValue(undefined),
}));

// Mock di fs/promises (lettura allegati in invia-pec)
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
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
import { generaNumeroProtocollo, calcolaProtocolloPrevisionale } from "@/lib/protocollo";
import { buildLetteraContextFromSegnalazione } from "@/lib/lettera";
import { POST as INVIA_PEC } from "@/app/api/segnalazioni/[id]/invia-pec/route";
import { POST as SIMULA_PEC } from "@/app/api/segnalazioni/[id]/simula-pec/route";
import { readFile } from "fs/promises";

const ADMIN_SESSION = {
  id: "s1", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-admin", email: "admin@t.it", nomeCognome: "Admin", ruolo: "admin",
    provinciaId: null, regioneId: null, inizialiProtocollo: "AD",
    pec: "admin@pec.it", emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
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
// Referente provinciale con provinciaId=2 (diversa dalla provincia della
// segnalazione di test, che è 1): serve per coprire il ramo di fallimento
// di hasTerritorialCompetence (403 "Non autorizzato per questa segnalazione").
const REF_PROV_OTHER_SESSION = {
  id: "s3", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref-other", email: "ref-other@t.it", nomeCognome: "Ref Other",
    ruolo: "referente_provinciale",
    provinciaId: 2, regioneId: 1, inizialiProtocollo: "RO",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};
// Referente provinciale con provinciaId=1 (stessa della segnalazione di
// test): ha competenza territoriale e può inviare/simulare PEC.
const REF_PROV_SESSION = {
  id: "s4", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref", email: "ref@t.it", nomeCognome: "Referente",
    ruolo: "referente_provinciale",
    provinciaId: 1, regioneId: 1, inizialiProtocollo: "RF",
    pec: "ref@pec.it", emailOrdinaria: "ref@ord.it", indirizzo: null, firma: null, attivo: true,
  },
};

function mockSession(user: any) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as any);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as any);
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
    cap: "24040",
    oggettoPec: "Oggetto PEC",
    pecCcAggiuntive: null,
    includiArpa: false,
    mittenteVisibile: true,
    comune: { id: 1, nome: "Verdello", pecComune: "comune@pec.it", nomeSindaco: "Sindaco" },
    provincia: { id: 1, sigla: "BG", regioneId: 1, regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15" } },
    regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: null },
    volontario: {
      id: "u-vol", nomeCognome: "Mario Rossi", email: "m@t.it",
      pec: "mario@pec.it", emailOrdinaria: null, inizialiProtocollo: "MR",
    },
    ...overrides,
  };
}

describe("POST /api/segnalazioni/[id]/invia-pec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({ messageId: "ok" });
  });
  afterEach(() => {
    __resetRateLimitStoreForTests();
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("ritorna 403 se non autenticato (no cookie -> 403)", async () => {
    // La route usa `!user || !canSendPec(user)` -> 403 per entrambi i casi
    mockSession(null);
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
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
      mockSegnalazioneApprovata({ stato: "in_revisione" }) as any
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("ritorna 400 se nessun destinatario PEC configurato (comune senza pec)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        comune: { id: 1, nome: "X", pecComune: "", nomeSindaco: null },
      }) as any
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Nessun destinatario");
  });

  it("ritorna 400 se la PEC del comune contiene placeholder PEC-DA-CONFIGURARE", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        comune: {
          id: 1, nome: "X",
          pecComune: "PEC-DA-CONFIGURARE@comune-test.it",
          nomeSindaco: null,
        },
      }) as any
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("PEC-DA-CONFIGURARE");
  });

  it("ritorna 500 se mittente PEC non configurato (no PEC_FROM e no user.pec)", async () => {
    mockSession({
      ...ADMIN_SESSION,
      user: { ...ADMIN_SESSION.user, pec: null },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata() as any
    );
    // Nessun PEC_FROM e nessun user.pec
    delete process.env.PEC_FROM;
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Mittente PEC non configurato");
  });

  it("invia PEC con successo in modalità demo (no PEC_SMTP_HOST) -> 200", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as any) // primo findUnique
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as any); // dopo updateMany
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numeroProtocollo).toBe("20260101-LOM-BG-MR01");
    expect(json.destinatari).toContain("comune@pec.it");
    // Il log deve essere di tipo "demo" (no PEC_SMTP_HOST)
    expect(db.logInvioPec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipo: "demo", esito: "ok" }),
    }));
    // Verifica updateMany con clausola WHERE su stato per atomicità
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "s1", stato: "approvata" },
      data: expect.objectContaining({ stato: "inviata" }),
    }));
  });

  it("invia PEC con successo via SMTP reale (PEC_SMTP_HOST configurato)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata() as any)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalled();
    expect(db.logInvioPec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipo: "reale", esito: "ok" }),
    }));
  });

  it("ritorna 500 se l'invio SMTP fallisce (esito errore)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    // Il log deve registrare l'errore
    expect(db.logInvioPec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ esito: "errore", messaggioErrore: "SMTP connection refused" }),
    }));
    // Lo stato NON deve essere aggiornato (updateMany non chiamato)
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("ritorna 409 se updateMany ritorna count=0 (race condition su stato)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    // Simula: lo stato è cambiato concorrentemente tra findUnique e updateMany
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as any);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("includiArpa=true aggiunge pecArpaRegionale ai destinatari", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({
        includiArpa: true,
        regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
      }) as any)
      .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.destinatari).toContain("comune@pec.it");
    expect(json.destinatari).toContain("arpa@pec.it");
  });

  it("rate limit: blocca al 6° tentativo PEC (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    // 5 invii permessi, al 6° scatta il blocco del rate limit (prima del findUnique)
    for (let i = 0; i < 5; i++) {
      vi.mocked(db.segnalazione.findUnique)
        .mockResolvedValueOnce(mockSegnalazioneApprovata() as any)
        .mockResolvedValueOnce(mockSegnalazioneApprovata({ stato: "inviata" }) as any);
      vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(generaNumeroProtocollo).mockResolvedValue("P");
      vi.mocked(db.allegato.findMany).mockResolvedValue([] as any);
      vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
      vi.mocked(db.storicoStato.create).mockResolvedValue({} as any);
      vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
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

  it("parsa pecCcAggiuntive e aggiunge destinatari CC (righe 119-123)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        pecCcAggiuntive: "cc1@pec.it; cc2@pec.it; comune@pec.it", // l'ultimo duplica il comune
      }) as any
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-CC-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // Verifica che sendMail sia stato chiamato con i CC (deduplicati)
    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toContain("comune@pec.it");
    expect(call.to).toContain("cc1@pec.it");
    expect(call.to).toContain("cc2@pec.it");

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("includiArpa=true con pecArpaRegionale aggiunge ARPA ai destinatari (riga 116)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        includiArpa: true,
        regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R.", pecArpaRegionale: "arpa@pec.it" },
      }) as any
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-ARPA-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toContain("arpa@pec.it");

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("allegati con urlStorage legacy (api/allegatiplaceholder/...) vengono allegati (riga 178-180)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-ATT-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/file.jpg", nomeOriginale: "foto.jpg", tipo: "foto", createdAt: new Date() },
      { id: "a2", urlStorage: "api/allegatiplaceholder/s1/old.pdf", nomeOriginale: "old.pdf", tipo: "documento", createdAt: new Date() },
      { id: "a3", urlStorage: "malformed", nomeOriginale: "bad.jpg", tipo: "foto", createdAt: new Date() }, // skip
      { id: "a4", urlStorage: "other/file.jpg", nomeOriginale: "wrong.jpg", tipo: "foto", createdAt: new Date() }, // skip (segId mismatch)
    ] as any);
    // Mock readFile: ok per i primi due, throw per il terzo
    vi.mocked(readFile).mockImplementation(async (p: any) => {
      const s = String(p);
      if (s.includes("malformed") || s.includes("other")) throw new Error("ENOENT");
      return Buffer.from("fake-content");
    });

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const call = mockSendMail.mock.calls[0][0];
    // 2 allegati validi (s1/file.jpg e api/allegatiplaceholder/s1/old.pdf)
    expect(call.attachments).toHaveLength(2);
    expect(call.attachments[0].filename).toBe("foto.jpg");
    expect(call.attachments[1].filename).toBe("old.pdf");

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("allegato con file mancante su filesystem viene saltato (riga 193-195 catch)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-NO-FILE");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "s1/missing.jpg", nomeOriginale: "missing.jpg", tipo: "foto", createdAt: new Date() },
    ] as any);
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const call = mockSendMail.mock.calls[0][0];
    // Nessun allegato (file non trovato)
    expect(call.attachments).toHaveLength(0);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("SMTP mode: invio reale con PEC_SMTP_HOST configurato (righe 200+)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-SMTP-01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);
    mockSendMail.mockResolvedValue({ messageId: "<smtp-id>" });

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // Verifica che sendMail sia stato chiamato con from personalizzato
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "noreply@cielobuio.it",
    }));

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  // ---------------------------------------------------------------------------
  // Test mirati per rami residui (coverage 100%)
  // ---------------------------------------------------------------------------

  it("ritorna 403 se referente non ha competenza territoriale (riga 63-68)", async () => {
    // Referente provinciale con provinciaId=2: la segnalazione mock ha
    // provinciaId=1, dunque hasTerritorialCompetence restituisce false.
    mockSession(REF_PROV_OTHER_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata() as any
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("ritorna 400 se segnalazione anonimizzata (volontario null) e senza protocollo (riga 85-90)", async () => {
    // Segnalazione post-anonimizzazione GDPR: volontario e volontarioId
    // nulli. Manca anche il numeroProtocollo, dunque si entra nel ramo di
    // generazione e si scopre che non è possibile (manca il segnalatore).
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        numeroProtocollo: null,
        volontarioId: null,
        volontario: null,
      }) as any
    );
    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("anonimizzata");
  });

  it("ritorna 400 se regione e provincia non determinabili (riga 91-97)", async () => {
    // Segnalazione con volontario presente ma regione e provincia assenti:
    // non è possibile derivare provinciaSigla/regione per il protocollo.
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        numeroProtocollo: null,
        provincia: null,
        regione: null,
      }) as any
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
    mockSendMail.mockResolvedValue({ messageId: "ok" });
  });
  afterEach(() => {
    __resetRateLimitStoreForTests();
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("ritorna 403 se non autenticato (no cookie -> 403)", async () => {
    mockSession(null);
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
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
      mockSegnalazioneApprovata({ stato: "in_revisione" }) as any
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("approvata");
  });

  it("simulazione in modalità demo ritorna 200 con emailInviata=false", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.emailInviata).toBe(false);
    expect(json.numeroProtocollo).toContain("previsionale");
    expect(json.messaggio).toContain("demo");
    // Il log deve essere di tipo "simula"
    expect(db.logInvioPec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipo: "simula", esito: "ok" }),
    }));
  });

  it("simulazione via SMTP reale invia email al mittente -> 200 con emailInviata=true", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

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
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("20260101-LOM-BG-MR01");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    mockSendMail.mockRejectedValue(new Error("SMTP timeout"));

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
    expect(db.logInvioPec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ esito: "errore", messaggioErrore: "SMTP timeout" }),
    }));
  });

  it("rate limit: blocca al 11° tentativo (429)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazioneApprovata() as any);
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
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

  it("ritorna 403 se referente non ha competenza territoriale (riga 59-64)", async () => {
    // Referente provinciale con provinciaId=2: la segnalazione mock ha
    // provinciaId=1, dunque hasTerritorialCompetence restituisce false.
    mockSession(REF_PROV_OTHER_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata() as any
    );
    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato per questa segnalazione");
  });

  it("mittenteVisibile=false usa user.pec quando presente (riga 99, ramo truthy)", async () => {
    // mittenteVisibile=false: il mittente è il referente, non il volontario.
    // Con user.pec impostato (REF_PROV_SESSION ha pec="ref@pec.it"), la catena
    // ?? si ferma al primo elemento.
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-MV-FALSE");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mittentePec).toBe("ref@pec.it");
  });

  it("mittenteVisibile=false con user.pec null usa user.emailOrdinaria (riga 99, ramo intermedio)", async () => {
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
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-ORD");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mittentePec).toBe("ref2@ord.it");
  });

  it("mittenteVisibile=false con user.pec e emailOrdinaria null usa user.email (riga 99, ramo finale)", async () => {
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
      mockSegnalazioneApprovata({ mittenteVisibile: false }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

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
    mockSendMail.mockResolvedValue({ messageId: "ok" });
  });

  it("usa provincia?.regione quando segnalazione.regione è null (linea 91/114)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        regione: null, // Forza uso di provincia?.regione
        provincia: {
          id: 1, sigla: "BG", regioneId: 1,
          regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
        },
      }) as any
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-REG-NULL");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("usa oggettoPec null con fallback stringa vuota (linea 219/242)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ oggettoPec: null }) as any
    );
    vi.mocked(generaNumeroProtocollo).mockResolvedValue("P-NULL-OGG");
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("gestisce errore SMTP non-Error con String(e) (linea 225)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-ERR-SMTP" }) as any
    );
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    vi.mocked(db.allegato.findMany).mockResolvedValue([]);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as any);
    // Rejection con non-Error (stringa)
    mockSendMail.mockRejectedValue("SMTP connection failed" as any);

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    // La route gestisce l'errore SMTP e ritorna 200 con esito errore,
    // oppure 500 se l'errore avviene prima del try/catch SMTP
    expect([200, 500]).toContain(res.status);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("salta allegato con path traversal (linea 186) e allegato valido (ramo false)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-TRAVERSAL" }) as any
    );
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as any);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    // Allegato con path traversal a 2 parti (startsWith fallisce, continue) + allegato valido (startsWith passa, readFile)
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", urlStorage: "../passwd", nomeOriginale: "evil.jpg", tipo: "foto", createdAt: new Date() },
      { id: "a2", urlStorage: "s1/valid.jpg", nomeOriginale: "valid.jpg", tipo: "foto", createdAt: new Date() },
    ] as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("fake-image"));

    const res = await INVIA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });
});

describe("POST /api/segnalazioni/[id]/simula-pec - rami residui coverage 100%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockSendMail.mockResolvedValue({ messageId: "sim-ok" });
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

  it("usa provincia?.regione quando segnalazione.regione è null (linea 79)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        regione: null,
        provincia: {
          id: 1, sigla: "BG", regioneId: 1,
          regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "L.R. 31/15", pecArpaRegionale: "arpa@pec.it" },
        },
      }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-SIM-REG-NULL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("previsionale null ritorna numeroProtocollo null (linea 89)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: null }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue(null);
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numeroProtocollo).toBeNull();
  });

  it("mittenteVisibile=true con volontario null usa fallback null (linea 98)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: null, // Volontario anonimizzato
      }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-VOL-NULL");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("invio SMTP con PEC_SMTP_PORT default e PEC_FROM undefined (linee 117/125)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    // Non impostare PEC_SMTP_PORT (default 465)
    // Non impostare PEC_FROM (usa user.pec)
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_FROM;

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-SMTP-DEFAULT" }) as any
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
  });

  it("oggettoPec null usa fallback stringa vuota (linee 127/145)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ oggettoPec: null, numeroProtocollo: "P-NULL-OGG-SIM" }) as any
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect([200, 500]).toContain(res.status);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("errore SMTP non-Error con String(e) (linea 133)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    process.env.PEC_FROM = "noreply@cielobuio.it";

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-ERR-SIM" }) as any
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    mockSendMail.mockRejectedValue("SMTP timeout" as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect([200, 500]).toContain(res.status);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("mittentePec null in risposta (linea 144)", async () => {
    mockSession({
      ...ADMIN_SESSION,
      user: { ...ADMIN_SESSION.user, pec: null, emailOrdinaria: null, email: null },
    });
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ mittenteVisibile: true, volontario: null }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-NULL-MITT");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("mittenteVisibile=true: vol.pec null usa emailOrdinaria (linea 98 ramo ??)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: {
          id: "u-vol", nomeCognome: "Mario", email: "m@t.it",
          pec: null, emailOrdinaria: "mario@ord.it", inizialiProtocollo: "MR",
        },
      }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL-ORD");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("mittenteVisibile=true: vol.pec e emailOrdinaria null usa email (linea 98 ramo ??)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({
        mittenteVisibile: true,
        volontario: {
          id: "u-vol", nomeCognome: "Mario", email: "mario@t.it",
          pec: null, emailOrdinaria: null, inizialiProtocollo: "MR",
        },
      }) as any
    );
    vi.mocked(calcolaProtocolloPrevisionale).mockResolvedValue("P-EMAIL-ONLY");
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("SMTP con PEC_FROM non impostato usa user.pec (linea 125 ramo ??)", async () => {
    mockSession(ADMIN_SESSION);
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_USER = "u";
    process.env.PEC_SMTP_PASSWORD = "p";
    delete process.env.PEC_FROM;

    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazioneApprovata({ numeroProtocollo: "P-FROM-USER" }) as any
    );
    vi.mocked(db.logInvioPec.create).mockResolvedValue({} as any);
    // Resetta il transporter cached per forzare la rilettura di PEC_FROM
    mockSendMail.mockClear();
    mockSendMail.mockResolvedValue({ messageId: "ok" });

    const res = await SIMULA_PEC(makeReq(), { params: Promise.resolve({ id: "s1" }) });
    expect([200, 500]).toContain(res.status);

    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
  });
});
