/**
 * Test per notifiche.ts - error path SMTP
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const mockSendMail = vi.fn();
vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({ close: vi.fn(), sendMail: mockSendMail }));
  return { createTransport, default: { createTransport } };
});

import { db } from "@/lib/db";

describe("notifiche.ts - SMTP error path", () => {
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

  it("gestisce errore SMTP in notificaReferenteNuovaRevisione", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      indirizzoVia: "Via 1",
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1,
      regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ emailOrdinaria: "ref@t.it", email: "ref@t.it" }] as never);
    mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    // Non dovrebbe lanciare, solo loggare l'errore: si verifica che l'invio sia stato tentato.
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalled();
  });

  it("gestisce errore SMTP in notificaVolontarioRifiuto", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as never);
    mockSendMail.mockRejectedValue(new Error("SMTP timeout"));

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota")).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalled();
  });

  it("gestisce errore SMTP in notificaPecInviata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      numeroProtocollo: "P1",
      indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "r1", nomeCognome: "Ref", email: "r@t.it", emailOrdinaria: null },
    } as never);
    mockSendMail.mockRejectedValue(new Error("SMTP auth failed"));

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalled();
  });
});
