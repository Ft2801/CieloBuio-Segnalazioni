/**
 * Test per i rami residui di notifiche.ts:
 * - getTransporter con PEC_SMTP_PORT configurato (ramo ?? true)
 * - inviaEmail con PEC_FROM configurato (ramo ?? true)
 * - notificaReferenteNuovaRevisione: segnalazione con tutti campi null
 * - notificaVolontarioRifiuto: segnalazione con referenteApprovatore null
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(true);
  const createTransport = vi.fn(() => ({ sendMail }));
  return { mockSendMail: sendMail, mockCreateTransport: createTransport };
});

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

import { db } from "@/lib/db";
import { __resetTransporterCacheForTests } from "@/lib/notifiche";

describe("notifiche.ts - rami PEC_SMTP_PORT e PEC_FROM configurati", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();
    __resetTransporterCacheForTests();
    // Configura env completo per esercitare entrambi i rami
    process.env.PEC_SMTP_HOST = "smtp.pec.it";
    process.env.PEC_SMTP_PORT = "587";
    process.env.PEC_SMTP_USER = "user";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "noreply@cielobuio.it";
  });

  afterEach(() => {
    // Ripristina env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("getTransporter usa PEC_SMTP_PORT e PEC_FROM personalizzati", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      indirizzoVia: "Via 1",
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1,
      regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: "ref@t.it", email: "ref@t.it" },
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s1");

    // Verifica che createTransport sia stato chiamato con port 587
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.pec.it",
        port: 587,
      })
    );
    // Verifica che sendMail sia stato chiamato con from personalizzato
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@cielobuio.it",
        to: "ref@t.it",
      })
    );
  });

  it("getTransporter usa PEC_SMTP_PORT default 465 se non configurato", async () => {
    delete process.env.PEC_SMTP_PORT;
    __resetTransporterCacheForTests();
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s2",
      indirizzoVia: "Via 2",
      comune: { nome: "Bergamo" },
      provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1,
      regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: "ref2@t.it", email: "ref2@t.it" },
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s2");

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
      })
    );
  });

  it("inviaEmail usa PEC_FROM default se non configurato", async () => {
    delete process.env.PEC_FROM;
    __resetTransporterCacheForTests();
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s3",
      indirizzoVia: "Via 3",
      comune: { nome: "Milano" },
      provincia: { sigla: "MI" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1,
      regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: "ref3@t.it", email: "ref3@t.it" },
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s3");

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "no-reply@tuodominio.it",
      })
    );
  });

  it("notificaReferenteNuovaRevisione: segnalazione con campi null nel subject/text", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s4",
      indirizzoVia: "Via 4",
      comune: null, // null -> subject ha "(, n/d)"
      provincia: null, // null -> sigla vuota
      regione: null, // null -> regione n/d
      provinciaId: null,
      regioneId: null,
      volontario: { nomeCognome: null, email: "m@t.it" }, // null
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: "ref4@t.it", email: "ref4@t.it" },
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s4");

    // Verifica che sendMail sia stato chiamato (subject con valori null gestiti)
    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.text).toContain("n/d");
  });

  it("notificaVolontarioRifiuto: referenteApprovatore null nel text", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s5",
      volontario: { nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: null, // null -> text ha "rifiutata dal referente "
    } as any);

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await notificaVolontarioRifiuto("s5", "nota test");

    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0][0];
    // "rifiutata" (femminile, si riferisce a "segnalazione")
    expect(call.text).toContain("rifiutata dal referente");
    expect(call.text).toContain("nota test");
  });

  it("notificaVolontarioRifiuto: volontario con solo emailOrdinaria", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s6",
      volontario: { nomeCognome: "Mario", email: null, emailOrdinaria: "mario@ord.it" },
      referenteApprovatore: { nomeCognome: "Ref" },
    } as any);

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await notificaVolontarioRifiuto("s6", "nota");

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "mario@ord.it",
      })
    );
  });

  it("notificaPecInviata: segnalazione con tutti campi null ma email disponibile", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s7",
      numeroProtocollo: null,
      indirizzoVia: "Via 7",
      dataInvio: null,
      comune: null,
      provincia: null,
      volontario: { id: "v7", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: null,
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await notificaPecInviata("s7");

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "m@t.it",
      })
    );
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain("PEC inviata:");
    expect(call.text).toContain("n/d");
  });
});
