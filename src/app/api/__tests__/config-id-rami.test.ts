/**
 * Copertura dei rami delle route di modifica ed eliminazione della
 * configurazione territoriale (/api/config/{province,regioni,comuni,users}/[id]).
 *
 * Ogni test verifica una condizione specifica: corpo non valido, cambio di
 * collegamento territoriale con dipendenze presenti, errori Prisma (P2002,
 * P2003, P2025) e re-verifica delle dipendenze dentro la transazione.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { mockHash } = vi.hoisted(() => ({
  mockHash: vi.fn(),
}));
vi.mock("bcryptjs", () => ({
  default: { hash: mockHash },
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    provincia: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    regioneLegge: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comune: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    segnalazione: { count: vi.fn() },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
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
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { PUT as PUT_PROVINCIA, DELETE as DELETE_PROVINCIA } from "@/app/api/config/province/[id]/route";
import { PUT as PUT_REGIONE, DELETE as DELETE_REGIONE } from "@/app/api/config/regioni/[id]/route";
import { PUT as PUT_COMUNE, DELETE as DELETE_COMUNE } from "@/app/api/config/comuni/[id]/route";
import { PATCH as PATCH_USER, DELETE as DELETE_USER } from "@/app/api/config/users/[id]/route";

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

function mockSession(user: unknown) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

function makeReq(method: string, body?: unknown, raw?: string): NextRequest {
  return new NextRequest("http://localhost/api/config/x/1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function erroreNoto(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("errore prisma", {
    code,
    clientVersion: "test",
  });
}

const p = (id: string) => ({ params: Promise.resolve({ id }) });

// -----------------------------------------------------------------------------
// Province /api/config/province/[id]
// -----------------------------------------------------------------------------

describe("PUT /api/config/province/[id] - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
  });

  it("ritorna 400 se il corpo non è un oggetto JSON (testo non JSON)", async () => {
    const res = await PUT_PROVINCIA(makeReq("PUT", undefined, "non-json"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 se il corpo è un array JSON", async () => {
    const res = await PUT_PROVINCIA(makeReq("PUT", undefined, "[1,2]"), p("1"));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se si cambia regione con segnalazioni collegate", async () => {
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1,
      regioneId: 1,
      _count: { segnalazioni: 3 },
    } as never);
    const res = await PUT_PROVINCIA(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 2 }), p("1"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Impossibile cambiare regione");
    expect(json.error).toContain("3 segnalazione/i");
    expect(db.provincia.update).not.toHaveBeenCalled();
  });

  it("ritorna 400 'Sigla già presente' su errore P2002", async () => {
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockRejectedValue(erroreNoto("P2002"));
    const res = await PUT_PROVINCIA(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Sigla già presente");
  });

  it("ritorna 404 se l'aggiornamento trova il record scomparso (P2025)", async () => {
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockRejectedValue(erroreNoto("P2025"));
    const res = await PUT_PROVINCIA(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), p("1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Provincia non trovata");
  });

  it("ritorna 500 su errore Prisma non gestito esplicitamente", async () => {
    vi.mocked(db.provincia.findUnique).mockResolvedValue({ id: 1, regioneId: 1, _count: { segnalazioni: 0 } } as never);
    vi.mocked(db.provincia.update).mockRejectedValue(erroreNoto("P2011"));
    const res = await PUT_PROVINCIA(makeReq("PUT", { sigla: "BG", nome: "Bergamo", regioneId: 1 }), p("1"));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/config/province/[id] - rami della transazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.provincia.findUnique).mockResolvedValue({
      id: 1,
      _count: { comuni: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(0 as never);
  });

  it("ritorna 400 se un comune viene collegato durante la transazione", async () => {
    vi.mocked(db.comune.count).mockResolvedValue(2 as never);
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("2 comune/i collegati");
    expect(db.provincia.delete).not.toHaveBeenCalled();
  });

  it("ritorna 400 se una segnalazione viene collegata durante la transazione", async () => {
    vi.mocked(db.comune.count).mockResolvedValue(0 as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(4 as never);
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("4 segnalazione/i collegate");
  });

  it("ritorna 400 se un referente viene assegnato durante la transazione", async () => {
    vi.mocked(db.comune.count).mockResolvedValue(0 as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
    // Prima chiamata: pre-check (0), seconda: ri-verifica in transazione (1).
    vi.mocked(db.user.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(1 as never);
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("1 referente/i provinciale/i");
  });

  it("ritorna 409 su P2003 (dipendenza creata in concorrenza)", async () => {
    vi.mocked(db.comune.count).mockResolvedValue(0 as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
    vi.mocked(db.provincia.delete).mockRejectedValue(erroreNoto("P2003"));
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(409);
  });

  it("ritorna 500 se la transazione fallisce con errore generico", async () => {
    vi.mocked(db.comune.count).mockResolvedValue(0 as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
    vi.mocked(db.provincia.delete).mockRejectedValue(new Error("boom"));
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(500);
  });

  it("ritorna 500 se il controllo iniziale delle dipendenze fallisce (catch esterno)", async () => {
    vi.mocked(db.provincia.findUnique).mockRejectedValue(new Error("db down"));
    const res = await DELETE_PROVINCIA(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
  });
});

// -----------------------------------------------------------------------------
// Regioni /api/config/regioni/[id]
// -----------------------------------------------------------------------------

describe("PUT /api/config/regioni/[id] - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
  });

  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await PUT_REGIONE(makeReq("PUT", undefined, "{{"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 'Esiste già una regione' su errore P2002", async () => {
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({ id: 1, regione: "LOM" } as never);
    vi.mocked(db.regioneLegge.update).mockRejectedValue(erroreNoto("P2002"));
    const res = await PUT_REGIONE(
      makeReq("PUT", { regione: "LOMBARDIA", riferimentoLegge: "L.R.", pecArpaRegionale: "" }),
      p("1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Esiste già una regione con questo nome");
  });
});

describe("DELETE /api/config/regioni/[id] - rami della transazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.regioneLegge.findUnique).mockResolvedValue({
      id: 1,
      _count: { province: 0, segnalazioni: 0 },
    } as never);
    vi.mocked(db.user.count).mockResolvedValue(0 as never);
    vi.mocked(db.provincia.count).mockResolvedValue(0 as never);
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
  });

  it("ritorna 400 se una provincia viene collegata durante la transazione", async () => {
    vi.mocked(db.provincia.count).mockResolvedValue(2 as never);
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("2 provincia/e collegate");
    expect(db.regioneLegge.delete).not.toHaveBeenCalled();
  });

  it("ritorna 400 se una segnalazione viene collegata durante la transazione", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(5 as never);
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("5 segnalazione/i collegate");
  });

  it("ritorna 400 se un referente regionale viene assegnato durante la transazione", async () => {
    vi.mocked(db.user.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(1 as never);
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("1 referente/i regionale/i");
  });

  it("ritorna 409 su P2003 (dipendenza creata in concorrenza)", async () => {
    vi.mocked(db.regioneLegge.delete).mockRejectedValue(erroreNoto("P2003"));
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(409);
  });

  it("ritorna 500 se la transazione fallisce con errore generico", async () => {
    vi.mocked(db.regioneLegge.delete).mockRejectedValue(new Error("boom"));
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(500);
  });

  it("ritorna 500 se il controllo iniziale fallisce (catch esterno)", async () => {
    vi.mocked(db.regioneLegge.findUnique).mockRejectedValue(new Error("db down"));
    const res = await DELETE_REGIONE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Errore interno del server");
  });
});

// -----------------------------------------------------------------------------
// Comuni /api/config/comuni/[id]
// -----------------------------------------------------------------------------

describe("PUT /api/config/comuni/[id] - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
  });

  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await PUT_COMUNE(makeReq("PUT", undefined, "7"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("ritorna 400 se si cambia provincia con segnalazioni collegate", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      provinciaId: 1,
      _count: { segnalazioni: 2 },
    } as never);
    const res = await PUT_COMUNE(
      makeReq("PUT", { nome: "Bergamo", provinciaId: 2, cap: "24100", pecComune: "x@pec.it" }),
      p("1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Impossibile cambiare provincia");
    expect(db.comune.update).not.toHaveBeenCalled();
  });

  it("ritorna 400 'Comune già presente' su errore P2002", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      provinciaId: 1,
      _count: { segnalazioni: 0 },
    } as never);
    vi.mocked(db.comune.update).mockRejectedValue(erroreNoto("P2002"));
    const res = await PUT_COMUNE(
      makeReq("PUT", { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }),
      p("1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comune già presente in questa provincia");
  });

  it("ritorna 404 se il comune scompare durante l'aggiornamento (P2025)", async () => {
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      provinciaId: 1,
      _count: { segnalazioni: 0 },
    } as never);
    vi.mocked(db.comune.update).mockRejectedValue(erroreNoto("P2025"));
    const res = await PUT_COMUNE(
      makeReq("PUT", { nome: "Bergamo", provinciaId: 1, cap: "24100", pecComune: "x@pec.it" }),
      p("1"),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Comune non trovato");
  });
});

describe("DELETE /api/config/comuni/[id] - rami della transazione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
    vi.mocked(db.comune.findUnique).mockResolvedValue({
      id: 1,
      _count: { segnalazioni: 0 },
    } as never);
  });

  it("ritorna 400 se una segnalazione viene collegata durante la transazione", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(3 as never);
    const res = await DELETE_COMUNE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("3 segnalazione/i collegate");
    expect(db.comune.delete).not.toHaveBeenCalled();
  });

  it("ritorna 409 su P2003 (dipendenza creata in concorrenza)", async () => {
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
    vi.mocked(db.comune.delete).mockRejectedValue(erroreNoto("P2003"));
    const res = await DELETE_COMUNE(makeReq("DELETE"), p("1"));
    expect(res.status).toBe(409);
  });
});

// -----------------------------------------------------------------------------
// Utenti /api/config/users/[id]
// -----------------------------------------------------------------------------

describe("PATCH /api/config/users/[id] - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
    mockHash.mockResolvedValue("hashed-pwd");
    mockSession(ADMIN_SESSION);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 0 } as never);
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 400 se il corpo non è un oggetto JSON", async () => {
    const res = await PATCH_USER(makeReq("PATCH", undefined, "null"), p("u1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Corpo della richiesta non valido");
  });

  it("l'admin può modificare il proprio profilo senza cambiare ruolo o stato", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-admin",
      email: "admin@t.it",
      ruolo: "admin",
      attivo: true,
      provinciaId: null,
      regioneId: null,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u-admin", email: "admin@t.it" } as never);
    const res = await PATCH_USER(makeReq("PATCH", { nomeCognome: "Nuovo Nome" }), p("u-admin"));
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nomeCognome: "Nuovo Nome" }),
      }),
    );
  });

  it("cambio email verso un indirizzo libero aggiorna l'utente", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce({ id: "u1", email: "old@t.it", ruolo: "volontario", attivo: true } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u1", email: "new@t.it" } as never);
    const res = await PATCH_USER(makeReq("PATCH", { email: "new@t.it" }), p("u1"));
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "new@t.it" }),
      }),
    );
  });

  it("ruolo referente_provinciale senza regioneId azzera la regione", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "x@t.it",
      ruolo: "volontario",
      attivo: true,
      provinciaId: null,
      regioneId: 4,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u1" } as never);
    const res = await PATCH_USER(makeReq("PATCH", { ruolo: "referente_provinciale", provinciaId: 7 }), p("u1"));
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provinciaId: 7, regioneId: null }),
      }),
    );
  });

  it("ruolo referente_regionale senza provinciaId azzera la provincia", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "x@t.it",
      ruolo: "volontario",
      attivo: true,
      provinciaId: 3,
      regioneId: null,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u1" } as never);
    const res = await PATCH_USER(makeReq("PATCH", { ruolo: "referente_regionale", regioneId: 2 }), p("u1"));
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provinciaId: null, regioneId: 2 }),
      }),
    );
  });

  it("ritorna 400 se l'admin rimuove il proprio ruolo amministratore", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-admin",
      email: "admin@t.it",
      ruolo: "admin",
      attivo: true,
      provinciaId: null,
      regioneId: null,
    } as never);
    const res = await PATCH_USER(makeReq("PATCH", { ruolo: "volontario" }), p("u-admin"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Non puoi rimuovere il tuo ruolo amministratore");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("aggiorna tutti i campi opzionali forniti (rami true)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "x@t.it",
      ruolo: "volontario",
      attivo: true,
      provinciaId: null,
      regioneId: null,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u1" } as never);
    const res = await PATCH_USER(
      makeReq("PATCH", {
        nomeCognome: "Mario Rossi",
        pec: "mario@pec.it",
        emailOrdinaria: "mario@mail.it",
        indirizzo: "Via Roma 1, Milano",
        firma: "Mario Rossi",
        inizialiProtocollo: "mr",
        attivo: true,
      }),
      p("u1"),
    );
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pec: "mario@pec.it",
          emailOrdinaria: "mario@mail.it",
          indirizzo: "Via Roma 1, Milano",
          firma: "Mario Rossi",
          inizialiProtocollo: "MR",
          attivo: true,
        }),
      }),
    );
  });

  it("ritorna 400 'Email già in uso' su errore P2002 in update", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "x@t.it",
      ruolo: "volontario",
      attivo: true,
      provinciaId: null,
      regioneId: null,
    } as never);
    vi.mocked(db.user.update).mockRejectedValue(erroreNoto("P2002"));
    const res = await PATCH_USER(makeReq("PATCH", { nomeCognome: "Nuovo" }), p("u1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Email già in uso");
  });
});

describe("DELETE /api/config/users/[id] - rami aggiuntivi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(ADMIN_SESSION);
  });

  it("ritorna 409 su P2003 (utente collegato ad altri dati)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u-other",
      email: "x@t.it",
      ruolo: "volontario",
      _count: { segnalazioni: 0, segnalazioniApprovate: 0 },
    } as never);
    vi.mocked(db.user.delete).mockRejectedValue(erroreNoto("P2003"));
    const res = await DELETE_USER(makeReq("DELETE"), p("u-other"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Disattivarlo");
  });
});
