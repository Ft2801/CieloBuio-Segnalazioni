/**
 * Test di integrazione per /api/segnalazioni/[id]
 * Copre: GET dettaglio, PUT modifica, DELETE elimina.
 *
 * - 401 per non autenticato
 * - 403 per non autorizzato (IDOR prevention, competenza territoriale)
 * - 404 per segnalazione non trovata
 * - 400 per input non valido / stato non più modificabile
 * - 409 per race condition su deleteMany con clausola WHERE su stato
 * - 200/200 per caso successo
 * - 500 per errore DB
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Mock di fs/promises per il cleanup fire-and-forget della DELETE
vi.mock("fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("")),
}));

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
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
import { rm } from "fs/promises";
import { GET, PUT, DELETE } from "@/app/api/segnalazioni/[id]/route";

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
const REF_PROV_SESSION = {
  id: "s3", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref", email: "ref@t.it", nomeCognome: "Referente", ruolo: "referente_provinciale",
    provinciaId: 5, regioneId: null, inizialiProtocollo: "RF",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};

function mockSession(user: any) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as any);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as any);
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/segnalazioni/s1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/segnalazioni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se volontario tenta di vedere segnalazione altrui", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "altro-utente", provinciaId: 1, regioneId: 1,
    } as any);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 403 se referente senza territorio assegnato (fail-closed)", async () => {
    const REF_NO_TERR = {
      ...REF_PROV_SESSION,
      user: { ...REF_PROV_SESSION.user, provinciaId: null },
    };
    mockSession(REF_NO_TERR);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "altro", provinciaId: 1, regioneId: 1,
    } as any);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 200 con dettaglio per admin", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1,
      stato: "bozza", indirizzoVia: "Via 1",
      comune: { id: 1, nome: "Verdello" },
      provincia: { id: 1, sigla: "BG", regione: { id: 1, regione: "LOMBARDIA" } },
      regione: { id: 1, regione: "LOMBARDIA" },
      volontario: { id: "u-vol", nomeCognome: "Vol" },
      referenteApprovatore: null,
      allegati: [], storicoStati: [],
    } as any);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segnalazione.id).toBe("s1");
  });

  it("ritorna 200 se volontario vede la propria segnalazione", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1,
    } as any);
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/segnalazioni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await PUT(makeReq("PUT", {}), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se volontario tenta di modificare segnalazione altrui", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "altro", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se segnalazione è in stato approvata (non più modificabile)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "approvata",
    } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    // Il volontario proprietario riceve "solo in stato bozza" (check isOwner),
    // il referente riceve "non più modificabile" (check stati terminali).
    // Entrambi sono 400, il messaggio dipende dal ruolo.
    expect(json.error).toBeTruthy();
  });

  it("ritorna 400 se volontario proprietario modifica in stato in_revisione (pacchetto probatorio congelato)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "in_revisione",
    } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("solo in stato bozza");
  });

  it("permette al referente di modificare in stato in_revisione (fix minori)", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 5, regioneId: 1, stato: "in_revisione",
    } as any);
    vi.mocked(db.comune.findUnique).mockResolvedValue(null);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    const res = await PUT(makeReq("PUT", { oggettoPec: "Oggetto", testoIntroduttivoPec: "", destinatarioNome: "Sindaco", pecCcAggiuntive: "" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("ritorna 400 'non più modificabile' se referente modifica in stato approvata", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 5, regioneId: 1, stato: "approvata",
    } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non più modificabile");
  });

  it("ritorna 400 se segnalazione è in stato inviata (non più modificabile)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "inviata",
    } as any);
    const res = await PUT(makeReq("PUT", {}), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se oggettoPec contiene a capo (CRLF injection)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { oggettoPec: "riga1\nriga2" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se PEC CC aggiuntive non valide", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { pecCcAggiuntive: "non-email" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se latitudine fuori range", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { latitudine: 200, longitudine: 10 }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se solo una tra lat/long è numerica", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { latitudine: 45, longitudine: "x" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("modifica con successo ritorna 200 (volontario sulla propria bozza)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via Vecchia", nomeEsercizio: null,
      pecCcAggiuntive: null, oggettoPec: null, testoIntroduttivoPec: null,
      destinatarioNome: null,
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({
      id: "s1", nomeEsercizio: "Bar Roma",
    } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "Bar Roma", indirizzoVia: "Via Nuova 1" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.segnalazione.nomeEsercizio).toBe("Bar Roma");
  });

  it("referente con competenza territoriale può modificare in stato in_revisione", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "altro", provinciaId: 5, regioneId: 1, stato: "in_revisione",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1", nomeEsercizio: null,
      pecCcAggiuntive: null, oggettoPec: null, testoIntroduttivoPec: null,
      destinatarioNome: null,
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("aggiorna comuneId derivando provincia/regione/cap dal nuovo comune", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1", nomeEsercizio: null,
      pecCcAggiuntive: null, oggettoPec: null, testoIntroduttivoPec: null,
      destinatarioNome: null,
    } as any);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 2, cap: "24100", provinciaId: 7,
      provincia: { regioneId: 3, regione: { id: 3, regione: "LOMBARDIA" } },
      nomeSindaco: "Mario Rossi",
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    await PUT(makeReq("PUT", { comuneId: 2 }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        comuneId: 2,
        provinciaId: 7,
        regioneId: 3,
        // Il cap viene mantenuto da quello esistente se già presente
        // (logica `cap = cap || comune.cap` nel route).
        cap: "24040",
      }),
    }));
  });

  it("ritorna 500 se update solleva errore", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1", nomeEsercizio: null,
      pecCcAggiuntive: null, oggettoPec: null, testoIntroduttivoPec: null,
      destinatarioNome: null,
    } as any);
    vi.mocked(db.segnalazione.update).mockRejectedValue(new Error("DB error"));
    const res = await PUT(makeReq("PUT", { nomeEsercizio: "X" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/segnalazioni/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se volontario tenta di eliminare segnalazione altrui", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "altro", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se la segnalazione non è una bozza", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "inviata",
    } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("bozze");
  });

  it("elimina bozza con successo (admin)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    vi.mocked(db.segnalazione.deleteMany).mockResolvedValue({ count: 1 } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("elimina bozza con successo (volontario proprietario)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    vi.mocked(db.segnalazione.deleteMany).mockResolvedValue({ count: 1 } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("ritorna 409 se deleteMany ritorna count=0 (race condition su stato)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    // Simula: tra findUnique e deleteMany lo stato è cambiato concorrentemente
    vi.mocked(db.segnalazione.deleteMany).mockResolvedValue({ count: 0 } as any);
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("bozza");
  });
});

describe("PUT /api/segnalazioni/[id] - edge cases per copertura rami", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 400 se latitudine < -90 (branch short-circuit)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { latitudine: -100, longitudine: 10 }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Latitudine");
  });

  it("ritorna 400 se longitudine fuori range (latitudine valida)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    const res = await PUT(makeReq("PUT", { latitudine: 45, longitudine: 999 }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Longitudine");
  });

  it("PUT con tutti i campi booleani e testuali impostati (ternary true branches)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1", nomeEsercizio: null,
      pecCcAggiuntive: null, oggettoPec: null, testoIntroduttivoPec: null,
      destinatarioNome: null,
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    await PUT(makeReq("PUT", {
      chkVetroPianoInclinato: true,
      chkVetroCurvo: true,
      chkAltroTipologia: true,
      notaAltroTipologia: "Nota tipologia",
      chkLuceVersoAlto: true,
      chkAbbagliamento: true,
      chkLuceIntrusiva: true,
      chkAltroProblema: true,
      notaAltroProblema: "Nota problema",
      descrizioneLibera: "Descrizione",
      destinatarioNome: "Sindaco Rossi",
      includiArpa: true,
      pecCcAggiuntive: "cc1@pec.it; cc2@pec.it",
      oggettoPec: "Oggetto PEC",
      testoIntroduttivoPec: "Testo intro",
      mittenteVisibile: true,
    }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        chkVetroPianoInclinato: true,
        chkVetroCurvo: true,
        chkAltroTipologia: true,
        notaAltroTipologia: "Nota tipologia",
        chkLuceVersoAlto: true,
        chkAbbagliamento: true,
        chkLuceIntrusiva: true,
        chkAltroProblema: true,
        notaAltroProblema: "Nota problema",
        descrizioneLibera: "Descrizione",
        destinatarioNome: "Sindaco Rossi",
        includiArpa: true,
        pecCcAggiuntive: "cc1@pec.it; cc2@pec.it",
        oggettoPec: "Oggetto PEC",
        testoIntroduttivoPec: "Testo intro",
        mittenteVisibile: true,
      }),
    }));
  });

  it("PUT con latitudine e longitudine valide (imposta nuovi valori)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "24040", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1",
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    await PUT(makeReq("PUT", { latitudine: 45.5, longitudine: 9.6 }), { params: Promise.resolve({ id: "s1" }) });
    expect(db.segnalazione.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ latitudine: 45.5, longitudine: 9.6 }),
    }));
  });

  it("PUT cambio comuneId con cap esistente vuoto (cap || comune.cap false branch)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
      comuneId: 1, cap: "", latitudine: null, longitudine: null,
      indirizzoVia: "Via 1",
    } as any);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 2, cap: "24100", provinciaId: 7,
      provincia: { regioneId: 3, regione: { id: 3, regione: "LOMBARDIA" } },
      nomeSindaco: "Mario Rossi",
    } as any);
    vi.mocked(db.segnalazione.update).mockResolvedValue({ id: "s1" } as any);
    await PUT(makeReq("PUT", { comuneId: 2 }), { params: Promise.resolve({ id: "s1" }) });
    // cap esistente è "" (falsy) → usa comune.cap = "24100"
    expect(db.segnalazione.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cap: "24100" }),
    }));
  });
});

describe("DELETE /api/segnalazioni/[id] - edge case per catch rm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignora errore rm (fire-and-forget catch block)", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", volontarioId: "u-vol", provinciaId: 1, regioneId: 1, stato: "bozza",
    } as any);
    vi.mocked(db.segnalazione.deleteMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(rm).mockRejectedValue(new Error("ENOENT"));
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    // attesa che il fire-and-forget completi (non blocca la risposta)
    await new Promise((r) => setTimeout(r, 50));
  });
});
