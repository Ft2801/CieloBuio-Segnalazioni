/**
 * Test per src/lib/notifiche.ts - SMTP path con env PEC_SMTP_HOST
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock del modulo db
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

// Mock di nodemailer
const mockSendMail = vi.fn().mockResolvedValue(true);
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

import { db } from "@/lib/db";

describe("notifiche.ts - SMTP path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PEC_SMTP_HOST = "smtp.pec.test.it";
    process.env.PEC_SMTP_PORT = "465";
    process.env.PEC_SMTP_USER = "user@pec.it";
    process.env.PEC_SMTP_PASSWORD = "pass";
    process.env.PEC_FROM = "from@pec.it";
  });

  afterEach(() => {
    delete process.env.PEC_SMTP_HOST;
    delete process.env.PEC_SMTP_PORT;
    delete process.env.PEC_SMTP_USER;
    delete process.env.PEC_SMTP_PASSWORD;
    delete process.env.PEC_FROM;
  });

  it("notificaReferenteNuovaRevisione: invia email reale via SMTP", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", indirizzoVia: "Via 1",
      comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1, regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: "ref@t.it", email: "ref@t.it" },
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s1");
    expect(mockSendMail).toHaveBeenCalled();
  });

  it("notificaVolontarioRifiuto: invia email reale via SMTP", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as any);

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await notificaVolontarioRifiuto("s1", "nota test");
    expect(mockSendMail).toHaveBeenCalled();
  });

  it("notificaPecInviata: invia email reale via SMTP", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", numeroProtocollo: "P1", indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "r1", nomeCognome: "Referente", email: "r@t.it", emailOrdinaria: null },
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await notificaPecInviata("s1");
    expect(mockSendMail).toHaveBeenCalled();
  });
});
