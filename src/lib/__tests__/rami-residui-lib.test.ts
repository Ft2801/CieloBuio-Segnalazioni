/**
 * Rami residui di src/lib: difese su path e sessioni, confronto a tempo costante,
 * validazione degli id interi e fallback del destinatario della lettera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "token-prova" }) })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sessione: { findUnique: vi.fn(), delete: vi.fn() },
    segnalazione: { findUnique: vi.fn() },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSessionUser, timingSafeEqualStrings } from "@/lib/auth";
import { risolviPathAllegatoSicuro } from "@/lib/path-guard";
import { normalizzaIdNumerico, parseIdIntero, MAX_ID_DB } from "@/lib/http";
import { buildLetteraContextFromSegnalazione } from "@/lib/lettera";

const UTENTE_ATTIVO = {
  id: "u1",
  nomeCognome: "Mario Rossi",
  email: "m@x.it",
  ruolo: "admin",
  attivo: true,
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "MR",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "token-prova" }) } as never);
  vi.mocked(db.sessione.delete).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("risolviPathAllegatoSicuro", () => {
  it("rifiuta un id di segnalazione che esce dalla radice degli upload", () => {
    expect(risolviPathAllegatoSicuro("../../etc", "passwd")).toBeNull();
  });

  it("accetta un percorso interno alla radice", () => {
    expect(risolviPathAllegatoSicuro("seg1", "foto.jpg")).toContain("seg1");
  });
});

describe("parseIdIntero", () => {
  it("accetta solo ID nell'intervallo PostgreSQL Int32", () => {
    expect(parseIdIntero("9999999999999999")).toBeNull();
    expect(parseIdIntero(String(MAX_ID_DB + 1))).toBeNull();
    expect(parseIdIntero(String(MAX_ID_DB))).toBe(MAX_ID_DB);
    expect(parseIdIntero("42")).toBe(42);
  });
});

describe("normalizzaIdNumerico", () => {
  it("accetta interi decimali, stringhe numeriche e campi vuoti", () => {
    expect(normalizzaIdNumerico(3)).toBe(3);
    expect(normalizzaIdNumerico(" 3 ")).toBe(3);
    expect(normalizzaIdNumerico("")).toBeNull();
    expect(normalizzaIdNumerico(undefined)).toBeUndefined();
  });

  it("non converte booleani, array, notazione esponenziale o valori troppo grandi", () => {
    expect(normalizzaIdNumerico(true)).toBe(true);
    expect(normalizzaIdNumerico([1])).toEqual([1]);
    expect(normalizzaIdNumerico("1e3")).toBe("1e3");
    expect(normalizzaIdNumerico(String(MAX_ID_DB + 1))).toBe(String(MAX_ID_DB + 1));
  });
});

describe("timingSafeEqualStrings", () => {
  it("confronta due stringhe", () => {
    expect(timingSafeEqualStrings("segreto", "segreto")).toBe(true);
    expect(timingSafeEqualStrings("segreto", "altro")).toBe(false);
  });
});

describe("getSessionUser: sessioni da invalidare", () => {
  it("una sessione scaduta viene eliminata e non autorizza", async () => {
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      scadenza: new Date(0),
      user: UTENTE_ATTIVO,
    } as never);
    expect(await getSessionUser()).toBeNull();
    expect(db.sessione.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("se l'eliminazione della sessione scaduta fallisce, registra un avviso e nega l'accesso", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      scadenza: new Date(0),
      user: UTENTE_ATTIVO,
    } as never);
    vi.mocked(db.sessione.delete).mockRejectedValue(new Error("db giù"));
    expect(await getSessionUser()).toBeNull();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it("una sessione di un utente disattivato viene invalidata", async () => {
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s2",
      scadenza: new Date(Date.now() + 60_000),
      user: { ...UTENTE_ATTIVO, attivo: false },
    } as never);
    expect(await getSessionUser()).toBeNull();
    expect(db.sessione.delete).toHaveBeenCalledWith({ where: { id: "s2" } });
  });

  it("se anche l'invalidazione dell'utente disattivato fallisce, nega comunque l'accesso", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s2",
      scadenza: new Date(Date.now() + 60_000),
      user: { ...UTENTE_ATTIVO, attivo: false },
    } as never);
    vi.mocked(db.sessione.delete).mockRejectedValue(new Error("db giù"));
    expect(await getSessionUser()).toBeNull();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it("un ruolo non previsto nel DB rifiuta la sessione", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s3",
      scadenza: new Date(Date.now() + 60_000),
      user: { ...UTENTE_ATTIVO, ruolo: "superuser" },
    } as never);
    expect(await getSessionUser()).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});

describe("buildLetteraContextFromSegnalazione: destinatario di fallback", () => {
  it("senza comune né destinatario usa la formula generica 'Sindaco'", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: UTENTE_ATTIVO,
      comune: null,
      provincia: { sigla: "MI", regione: { nome: "Lombardia", codice: "LOM" } },
      regione: null,
      destinatarioNome: "",
      destinatarioIndirizzo: "",
      destinatarioEmail: "",
      oggettoPec: "",
      testoIntroduttivoPec: "",
      indirizzoVia: "Via Roma 1",
      cap: "20100",
      numeroProtocollo: null,
      dataSegnalazione: new Date("2026-01-01T00:00:00Z"),
    } as never);
    const ctx = await buildLetteraContextFromSegnalazione("s1");
    expect(ctx.destinatarioNome).toBe("Sindaco");
    expect(ctx.comuneNome).toBe("");
  });
});
