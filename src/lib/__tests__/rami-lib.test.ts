/**
 * Copertura dei rami di moduli di libreria non esercitati altrove:
 * client Prisma, configurazione SMTP, sicurezza dei path, vincoli di
 * ruolo/territorio, PEC CC e assegnazione del numero di protocollo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateTransport, mockLogger } = vi.hoisted(() => ({
  mockCreateTransport: vi.fn(),
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("nodemailer", () => ({ createTransport: mockCreateTransport }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

vi.mock("@prisma/client", () => {
  class MockPrismaError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = code;
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError: MockPrismaError },
    PrismaClient: class {
      opzioni: unknown;
      constructor(opzioni: unknown) {
        this.opzioni = opzioni;
      }
    },
  };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    configurazione: unknown;
    constructor(configurazione: unknown) {
      this.configurazione = configurazione;
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === "function") return fn();
      return fn;
    }),
  },
}));

import { createPrismaClient } from "@/lib/prisma-client";
import { leggiConfigurazioneSmtp, getTransporter } from "@/lib/smtp";
import { isSafePathSegment, parseUrlStorageSicuro } from "@/lib/path-guard";
import { applicaVincoliRuoloTerritorio, validaPecCcAggiuntive } from "@/lib/validation";
import { generaNumeroProtocollo } from "@/lib/protocollo";
import { db } from "@/lib/db";

// -----------------------------------------------------------------------------
// Client Prisma
// -----------------------------------------------------------------------------

describe("createPrismaClient", () => {
  const originale = process.env.DATABASE_URL;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Ripristino fedele: se la variabile non era definita va rimossa, non impostata a "undefined".
    if (originale === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originale;
  });

  it("lancia errore se DATABASE_URL non è configurata", () => {
    delete process.env.DATABASE_URL;
    expect(() => createPrismaClient()).toThrow("DATABASE_URL non configurata");
  });

  it("crea il client con l'adapter PostgreSQL e le opzioni passate", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    const client = createPrismaClient({ log: ["error"] }) as unknown as {
      opzioni: { log: string[]; adapter: { configurazione: { connectionString: string } } };
    };
    expect(client.opzioni.log).toEqual(["error"]);
    expect(client.opzioni.adapter.configurazione.connectionString).toBe("postgresql://u:p@localhost:5432/db");
  });
});

// -----------------------------------------------------------------------------
// Configurazione SMTP e transporter
// -----------------------------------------------------------------------------

describe("leggiConfigurazioneSmtp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna null senza host", () => {
    expect(leggiConfigurazioneSmtp({} as never)).toBeNull();
    expect(leggiConfigurazioneSmtp({ PEC_SMTP_HOST: "   " } as never)).toBeNull();
  });

  it("porta non valida: usa 465 come fallback e registra un warning", () => {
    const cfg = leggiConfigurazioneSmtp({
      PEC_SMTP_HOST: "smtp.pec.it",
      PEC_SMTP_PORT: "abc",
    } as never);
    expect(cfg?.port).toBe(465);
    expect(cfg?.secure).toBe(true);
    expect(cfg?.requireTLS).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("porta 587 usa STARTTLS obbligatorio e credenziali e mittente dall'ambiente", () => {
    const cfg = leggiConfigurazioneSmtp({
      PEC_SMTP_HOST: " smtp.pec.it ",
      PEC_SMTP_PORT: "587",
      PEC_SMTP_USER: "utente",
      PEC_SMTP_PASSWORD: "segreta",
      PEC_FROM: " pec@associazione.it ",
    } as never);
    expect(cfg).toEqual({
      host: "smtp.pec.it",
      port: 587,
      secure: false,
      requireTLS: true,
      user: "utente",
      pass: "segreta",
      from: "pec@associazione.it",
    });
  });

  it("senza credenziali né mittente imposta i campi a undefined", () => {
    const cfg = leggiConfigurazioneSmtp({
      PEC_SMTP_HOST: "smtp.pec.it",
      PEC_SMTP_PORT: "465",
    } as never);
    expect(cfg?.user).toBeUndefined();
    expect(cfg?.pass).toBeUndefined();
    expect(cfg?.from).toBeUndefined();
  });
});

describe("getTransporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("riusa il transporter quando la configurazione non cambia", () => {
    mockCreateTransport.mockImplementation(() => ({ close: vi.fn() }));
    const cfg = { host: "h1", port: 465, secure: true, requireTLS: false } as never;
    const primo = getTransporter(cfg as never);
    const secondo = getTransporter({ ...(cfg as object) } as never);
    expect(secondo).toBe(primo);
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it("crea un nuovo transporter con autenticazione e chiude il precedente se cambia configurazione", () => {
    const chiusura = vi.fn();
    mockCreateTransport.mockImplementation(() => ({ close: chiusura }));
    getTransporter({ host: "h2", port: 465, secure: true, requireTLS: false } as never);
    getTransporter({ host: "h2", port: 465, secure: true, requireTLS: false, user: "u", pass: "p" } as never);
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auth: { user: "u", pass: "p" },
      }),
    );
    expect(chiusura).toHaveBeenCalled();
  });

  it("senza utente non configura l'autenticazione", () => {
    mockCreateTransport.mockImplementation(() => ({ close: vi.fn() }));
    getTransporter({ host: "h3", port: 587, secure: false, requireTLS: true, pass: "solo-pass" } as never);
    expect(mockCreateTransport).toHaveBeenLastCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it("utente senza password usa stringa vuota come password", () => {
    mockCreateTransport.mockImplementation(() => ({ close: vi.fn() }));
    getTransporter({ host: "h4", port: 587, secure: false, requireTLS: true, user: "solo-utente" } as never);
    expect(mockCreateTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auth: { user: "solo-utente", pass: "" },
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// Sicurezza dei path
// -----------------------------------------------------------------------------

describe("path-guard: rami aggiuntivi", () => {
  it("rifiuta segmenti con caratteri di controllo", () => {
    expect(isSafePathSegment("file\nnome.jpg")).toBe(false);
    expect(isSafePathSegment("file\tnome.jpg")).toBe(false);
  });

  it("rifiuta urlStorage con segmenti vuoti (doppio slash)", () => {
    expect(parseUrlStorageSicuro("seg1//foto.jpg")).toBeNull();
    expect(parseUrlStorageSicuro("/foto.jpg")).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Vincoli di ruolo e PEC CC
// -----------------------------------------------------------------------------

describe("applicaVincoliRuoloTerritorio", () => {
  it("non aggiunge errori quando il referente ha il territorio assegnato", () => {
    const ctx = { addIssue: vi.fn() };
    applicaVincoliRuoloTerritorio({ ruolo: "referente_provinciale", provinciaId: 5 }, ctx as never);
    applicaVincoliRuoloTerritorio({ ruolo: "referente_regionale", regioneId: 2 }, ctx as never);
    expect(ctx.addIssue).not.toHaveBeenCalled();
  });

  it("segnala il provinciaId mancante per il referente provinciale", () => {
    const ctx = { addIssue: vi.fn() };
    applicaVincoliRuoloTerritorio({ ruolo: "referente_provinciale", provinciaId: null }, ctx as never);
    expect(ctx.addIssue).toHaveBeenCalledWith(expect.objectContaining({ path: ["provinciaId"] }));
  });

  it("segnala il regioneId mancante per il referente regionale", () => {
    const ctx = { addIssue: vi.fn() };
    applicaVincoliRuoloTerritorio({ ruolo: "referente_regionale", regioneId: null }, ctx as never);
    expect(ctx.addIssue).toHaveBeenCalledWith(expect.objectContaining({ path: ["regioneId"] }));
  });
});

describe("validaPecCcAggiuntive", () => {
  it("elimina i duplicati (anche con maiuscole diverse) senza errori", () => {
    const risultato = validaPecCcAggiuntive("a@x.it; A@x.it; b@x.it");
    expect(risultato).toEqual({ ok: true, emails: ["a@x.it", "b@x.it"] });
  });

  it("ritorna errore se un indirizzo non è valido", () => {
    const risultato = validaPecCcAggiuntive("a@x.it; non-un-indirizzo");
    expect(risultato.ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Assegnazione del numero di protocollo: segnalazione già protocollata o scomparsa
// -----------------------------------------------------------------------------

describe("generaNumeroProtocollo - assegnazione concorrente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.segnalazione.count).mockResolvedValue(0);
  });

  it("restituisce il protocollo già assegnato se updateMany non aggiorna nulla", async () => {
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({ numeroProtocollo: "20260115-LOM-BG-MR01" } as never);
    const risultato = await generaNumeroProtocollo({
      data: new Date(2026, 0, 15),
      regione: "LOMBARDIA",
      provinciaSigla: "BG",
      segnalatoreId: "user-1",
      segnalatoreNomeCognome: "Mario Rossi",
      inizialiProtocollo: "MR",
      segnalazioneId: "seg-1",
    });
    expect(risultato).toBe("20260115-LOM-BG-MR01");
  });

  it("lancia errore se la segnalazione non esiste più durante l'assegnazione", async () => {
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    await expect(
      generaNumeroProtocollo({
        data: new Date(2026, 0, 15),
        regione: "LOMBARDIA",
        provinciaSigla: "BG",
        segnalatoreId: "user-1",
        segnalatoreNomeCognome: "Mario Rossi",
        inizialiProtocollo: "MR",
        segnalazioneId: "seg-scomparsa",
      }),
    ).rejects.toThrow("non trovata durante assegnazione protocollo");
  });

  it("lancia errore se la segnalazione esiste ma senza protocollo", async () => {
    vi.mocked(db.segnalazione.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({ numeroProtocollo: null } as never);
    await expect(
      generaNumeroProtocollo({
        data: new Date(2026, 0, 15),
        regione: "LOMBARDIA",
        provinciaSigla: "BG",
        segnalatoreId: "user-1",
        segnalatoreNomeCognome: "Mario Rossi",
        inizialiProtocollo: "MR",
        segnalazioneId: "seg-2",
      }),
    ).rejects.toThrow("assegnazione protocollo");
  });
});
