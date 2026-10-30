/**
 * Copertura dei rami delle route di azione sulle segnalazioni non esercitati
 * dagli altri test: corpo non JSON, nota vuota, errori delle notifiche
 * fire-and-forget, errore della transazione di stato, rate limit della lettera,
 * allegati senza estensione e HTML della lettera senza </body>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { notificaVolontarioRifiuto, notificaReferenteNuovaRevisione } from "@/lib/notifiche";

const p = (id: string) => ({ params: Promise.resolve({ id }) });

function reqJsonRaw(raw: string): NextRequest {
  return new NextRequest("http://localhost/api/segnalazioni/s1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

const attesaNotifiche = () => new Promise((r) => setTimeout(r, 20));

describe("POST /api/segnalazioni/[id]/cambia-stato - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
  });

  it("ritorna 400 se il corpo non è JSON valido", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(reqJsonRaw("{rotto"), p("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 se il corpo è un array JSON", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    const res = await CAMBIA_STATO(reqJsonRaw("[]"), p("s1"));
    expect(res.status).toBe(400);
  });

  it("una nota composta solo da spazi viene trattata come assente", async () => {
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
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione", nota: "   " }), p("s1"));
    expect(res.status).toBe(200);
    expect(db.storicoStato.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nota: null }) }),
    );
  });

  it("ritorna 500 se la transazione di cambio stato fallisce", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "u-vol",
      provinciaId: 1,
      regioneId: 1,
      stato: "bozza",
    } as never);
    vi.mocked(db.$transaction).mockRejectedValueOnce(new Error("tx fallita"));
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), p("s1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("transazione di stato");
  });

  it("una notifica al referente fallita non blocca il cambio stato", async () => {
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
    vi.mocked(notificaReferenteNuovaRevisione).mockRejectedValueOnce(new Error("smtp down"));
    const res = await CAMBIA_STATO(makeReq("POST", { stato: "in_revisione" }), p("s1"));
    expect(res.status).toBe(200);
    await attesaNotifiche();
    expect(notificaReferenteNuovaRevisione).toHaveBeenCalledWith("s1");
  });
});

describe("POST /api/segnalazioni/[id]/rifiuta - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.storicoStato.create).mockResolvedValue({} as never);
  });

  it("ritorna 400 se il corpo non è JSON valido", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
      stato: "in_revisione",
    } as never);
    const res = await RIFIUTA(reqJsonRaw("non-json"), p("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("una notifica al volontario fallita non blocca il rifiuto", async () => {
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
    vi.mocked(notificaVolontarioRifiuto).mockRejectedValueOnce(new Error("smtp down"));
    const res = await RIFIUTA(makeReq("POST", { nota: "Manca la foto" }), p("s1"));
    expect(res.status).toBe(200);
    await attesaNotifiche();
    expect(notificaVolontarioRifiuto).toHaveBeenCalledWith("s1", "Manca la foto", "Admin");
  });
});

describe("GET /api/segnalazioni/[id]/lettera - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 429 dopo 30 generazioni nella stessa ora", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    for (let i = 0; i < 30; i++) {
      await LETTERA(new NextRequest("http://localhost/api/segnalazioni/s1", { method: "GET" }), p("s1"));
    }
    const res = await LETTERA(new NextRequest("http://localhost/api/segnalazioni/s1", { method: "GET" }), p("s1"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("salta allegati senza estensione e lascia invariato l'HTML senza </body>", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<div>Lettera senza chiusura</div>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/senza-estensione", nomeOriginale: "senza" },
    ] as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, p("s1"));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Nessun allegato incluso: l'HTML resta identico a quello generato.
    expect(text).toBe("<div>Lettera senza chiusura</div>");
  });
});

// Il percorso degli allegati è risolto da path-guard: il wrapper resta fedele
// all'implementazione reale e consente di simulare un percorso non risolvibile.
vi.mock("@/lib/path-guard", async (importOriginale) => {
  const originale = await importOriginale<typeof import("@/lib/path-guard")>();
  return { ...originale, risolviPathAllegatoSicuro: vi.fn(originale.risolviPathAllegatoSicuro) };
});

describe("GET lettera con allegati - HTML con chiusura e allegati non risolvibili", () => {
  it("inserisce le immagini prima di </body> e salta il file non risolvibile", async () => {
    const pg = await import("@/lib/path-guard");
    const fsp = await import("fs/promises");
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<html><body>Lettera</body></html>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/prima.jpg", nomeOriginale: "prima.jpg" },
      { id: "a2", segnalazioneId: "s1", urlStorage: "s1/non-risolvibile.jpg", nomeOriginale: "x.jpg" },
    ] as never);
    vi.mocked(fsp.readFile).mockResolvedValue(Buffer.from("img") as never);
    vi.mocked(pg.risolviPathAllegatoSicuro).mockReturnValueOnce(null);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, p("s1"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.indexOf("</body>")).toBeGreaterThan(text.indexOf("data:"));
    expect(text.split("</body>").length).toBe(2);
  });
});

describe("GET lettera con allegati - HTML senza chiusura </body>", () => {
  it("accoda la sezione allegati quando il marker </body> manca", async () => {
    const fsp = await import("fs/promises");
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    } as never);
    vi.mocked(buildLetteraContextFromSegnalazione).mockResolvedValue({} as never);
    vi.mocked(generaHtmlLettera).mockReturnValue("<div>Senza chiusura</div>");
    vi.mocked(db.allegato.findMany).mockResolvedValue([
      { id: "a1", segnalazioneId: "s1", urlStorage: "s1/foto.jpg", nomeOriginale: "foto.jpg" },
    ] as never);
    vi.mocked(fsp.readFile).mockResolvedValue(Buffer.from("img") as never);
    const req = new NextRequest("http://localhost/api/segnalazioni/s1?with_attachments=1", { method: "GET" });
    const res = await LETTERA(req, p("s1"));
    const text = await res.text();
    expect(text.startsWith("<div>Senza chiusura</div>")).toBe(true);
    expect(text).toContain("data:");
  });
});
