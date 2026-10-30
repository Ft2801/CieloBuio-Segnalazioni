/**
 * Copertura dei rami di PUT /api/segnalazioni/[id] non esercitati dagli altri
 * test: corpo non JSON, validazione di comuneId e CAP, coordinate geografiche
 * e conflitto di concorrenza (updateMany con count 0).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { rm } from "fs/promises";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("")),
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
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
import { PUT, DELETE } from "@/app/api/segnalazioni/[id]/route";
import path from "path";
import { UPLOADS_ROOT } from "@/lib/path-guard";

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

function makeReq(body?: unknown, raw?: string): NextRequest {
  return new NextRequest("http://localhost/api/segnalazioni/s1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const params = { params: Promise.resolve({ id: "s1" }) };

/** Segnalazione in bozza di proprietà del volontario, con comune 1 associato. */
function segnalazioneBozza(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    volontarioId: "u-vol",
    provinciaId: 1,
    regioneId: 1,
    stato: "bozza",
    comuneId: 1,
    cap: "24049",
    latitudine: null,
    longitudine: null,
    indirizzoVia: "Via Vecchia",
    nomeEsercizio: null,
    pecCcAggiuntive: null,
    oggettoPec: null,
    testoIntroduttivoPec: null,
    destinatarioNome: null,
    notaAltroTipologia: null,
    notaAltroProblema: null,
    descrizioneLibera: null,
    includiArpa: false,
    mittenteVisibile: true,
    chkVetroPianoInclinato: false,
    chkVetroCurvo: false,
    chkAltroTipologia: false,
    chkLuceVersoAlto: false,
    chkAbbagliamento: false,
    chkLuceIntrusiva: false,
    chkAltroProblema: false,
    ...extra,
  };
}

function comuneNuovo(extra: Record<string, unknown> = {}) {
  return {
    id: 2,
    cap: "24100",
    provinciaId: 7,
    provincia: { regioneId: 3, regione: { id: 3, regione: "LOMBARDIA" } },
    nomeSindaco: "Mario Rossi",
    ...extra,
  };
}

describe("PUT /api/segnalazioni/[id] - rami di validazione aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza() as never);
  });

  it("ritorna 400 se il corpo non è un oggetto JSON (testo malformato)", async () => {
    const res = await PUT(makeReq(undefined, "{non json"), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("ritorna 400 se il corpo è un array JSON", async () => {
    const res = await PUT(makeReq(undefined, "[]"), params);
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se comuneId non è un intero positivo", async () => {
    const res = await PUT(makeReq({ comuneId: "abc" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("comuneId non valido");
  });

  it("ritorna 400 se comuneId supera il range PostgreSQL Int32", async () => {
    const res = await PUT(makeReq({ comuneId: 2147483648 }), params);
    expect(res.status).toBe(400);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("comuneId null non può eliminare il territorio obbligatorio", async () => {
    const res = await PUT(makeReq({ comuneId: null }), params);
    expect(res.status).toBe(400);
    expect(db.comune.findUnique).not.toHaveBeenCalled();
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("richiede un Comune per correggere una pratica storica senza Comune", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza({ comuneId: null }) as never);
    const res = await PUT(makeReq({ nomeEsercizio: "Bar" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Comune obbligatorio");
  });

  it("controlla la versione e il territorio nel filtro di concorrenza", async () => {
    const updatedAt = new Date("2026-01-01T09:00:00Z");
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza({ updatedAt }) as never);
    const res = await PUT(makeReq({ nomeEsercizio: "Bar" }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "s1",
          stato: "bozza",
          updatedAt,
          volontarioId: "u-vol",
          provinciaId: 1,
          regioneId: 1,
        }),
      }),
    );
  });

  it.each([
    ["clock avanti", -1000, 0],
    ["stesso millisecondo", 0, 1],
    ["timestamp nel futuro", 1000, 1001],
  ])("avanza la versione temporale con %s", async (_caso, differenza, incremento) => {
    const ora = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(ora);
    try {
      const aggiornata = new Date(ora + differenza);
      vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza({ updatedAt: aggiornata }) as never);
      const res = await PUT(makeReq({ nomeEsercizio: "Nuovo" }), params);
      expect(res.status).toBe(200);
      expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ updatedAt: aggiornata }),
          data: expect.objectContaining({ updatedAt: new Date(ora + incremento) }),
        }),
      );
    } finally {
      clock.mockRestore();
    }
  });

  it("ritorna 400 se il CAP non ha 5 cifre", async () => {
    const res = await PUT(makeReq({ cap: "123" }), params);
    expect(res.status).toBe(400);
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("rifiuta un CAP di tipo errato, senza confermare un salvataggio che lo ignora", async () => {
    const res = await PUT(makeReq({ cap: 12345 }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("CAP non valido");
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it.each([{ includiArpa: "false" }, { chkVetroCurvo: "false" }, { mittenteVisibile: 0 }])(
    "rifiuta flag non booleani in modifica: %j",
    async (flag) => {
      const res = await PUT(makeReq(flag), params);
      expect(res.status).toBe(400);
      expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
    },
  );

  it("conserva la compatibilità con la stringa esatta false per mittenteVisibile", async () => {
    const res = await PUT(makeReq({ mittenteVisibile: "false" }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mittenteVisibile: false }) }),
    );
  });

  it("cap null azzera il CAP della segnalazione", async () => {
    const res = await PUT(makeReq({ cap: null }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cap: null }),
      }),
    );
  });

  it("un referente non può spostare una pratica in un Comune fuori dal proprio territorio", async () => {
    mockSession({
      ...VOL_SESSION,
      user: { ...VOL_SESSION.user, id: "u-ref", ruolo: "referente_provinciale", provinciaId: 1 },
    });
    vi.mocked(db.comune.findUnique).mockResolvedValue(comuneNuovo() as never);
    const res = await PUT(makeReq({ comuneId: 2 }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("competenza territoriale");
    expect(db.segnalazione.updateMany).not.toHaveBeenCalled();
  });

  it("un referente può cambiare Comune all'interno della propria provincia", async () => {
    mockSession({
      ...VOL_SESSION,
      user: { ...VOL_SESSION.user, id: "u-ref", ruolo: "referente_provinciale", provinciaId: 1 },
    });
    vi.mocked(db.comune.findUnique).mockResolvedValue(comuneNuovo({ provinciaId: 1 }) as never);
    const res = await PUT(makeReq({ comuneId: 2 }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalled();
  });

  it("con un cambio di comune, il CAP esplicito nel body prevale su quello del comune", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue(comuneNuovo() as never);
    const res = await PUT(makeReq({ comuneId: 2, cap: "20121" }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comuneId: 2, cap: "20121", provinciaId: 7, regioneId: 3 }),
      }),
    );
  });

  it("con un cambio di comune e destinatario già indicato, non sovrascrive il destinatario", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue(comuneNuovo() as never);
    const res = await PUT(makeReq({ comuneId: 2, destinatarioNome: "Ufficio Tecnico" }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ destinatarioNome: "Ufficio Tecnico" }),
      }),
    );
  });

  it("con un cambio di comune senza destinatario, imposta il sindaco come destinatario", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue(comuneNuovo() as never);
    const res = await PUT(makeReq({ comuneId: 2 }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ destinatarioNome: "Sindaco Mario Rossi" }),
      }),
    );
  });

  it("ritorna 400 se la longitudine è fuori range (latitudine valida)", async () => {
    const res = await PUT(makeReq({ latitudine: 45.4, longitudine: 200 }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Longitudine");
  });

  it("ritorna 400 se latitudine è numerica e longitudine è null", async () => {
    const res = await PUT(makeReq({ latitudine: 45.4, longitudine: null }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("entrambe numeriche o entrambe assenti");
  });

  it("accetta coordinate valide e le salva", async () => {
    const res = await PUT(makeReq({ latitudine: 45.4642, longitudine: 9.19 }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitudine: 45.4642, longitudine: 9.19 }),
      }),
    );
  });

  it("entrambe le coordinate null azzerano la geolocalizzazione", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      segnalazioneBozza({ latitudine: 45, longitudine: 9 }) as never,
    );
    const res = await PUT(makeReq({ latitudine: null, longitudine: null }), params);
    expect(res.status).toBe(200);
    expect(db.segnalazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitudine: null, longitudine: null }),
      }),
    );
  });

  it("ritorna 409 se updateMany non aggiorna nessun record (modifica concorrente)", async () => {
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await PUT(makeReq({ nomeEsercizio: "Bar" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("modificata concorrentemente");
  });
});

// -----------------------------------------------------------------------------
// PUT con comune inesistente, DELETE con id non sicuro nel record
// -----------------------------------------------------------------------------
describe("segnalazioni/[id] - rami residui", () => {
  const paramsResidui = { params: Promise.resolve({ id: "s1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza() as never);
    vi.mocked(db.segnalazione.deleteMany).mockResolvedValue({ count: 1 } as never);
  });

  it("ritorna 400 se il comune indicato non esiste", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue(null as never);
    const res = await PUT(makeReq({ comuneId: 999 }), paramsResidui);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comune non trovato");
  });

  it("DELETE di una bozza con id sicuro rimuove la cartella degli allegati (controllo positivo)", async () => {
    const res = await DELETE(makeReq(), paramsResidui);
    expect(res.status).toBe(200);
    expect(rm).toHaveBeenCalledWith(path.join(UPLOADS_ROOT, "s1"), { recursive: true, force: true });
  });

  it("DELETE con id non sicuro nel record elimina il DB senza toccare il file system", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(segnalazioneBozza({ id: "../evasione" }) as never);
    const res = await DELETE(makeReq(), { params: Promise.resolve({ id: "../evasione" }) });
    expect(res.status).toBe(200);
    expect(db.segnalazione.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "../evasione",
        stato: "bozza",
        volontarioId: "u-vol",
        updatedAt: undefined,
        invioPecLockToken: null,
      },
    });
    expect(rm).not.toHaveBeenCalled();
  });

  it("DELETE non elimina la cartella se il path calcolato esce dalla radice upload", async () => {
    const joinSpy = vi.spyOn(path, "join").mockReturnValueOnce("/etc");
    const res = await DELETE(makeReq(), paramsResidui);
    expect(res.status).toBe(200);
    expect(rm).not.toHaveBeenCalled();
    joinSpy.mockRestore();
  });
});
