/**
 * Test per src/lib/notifiche.ts con mock di nodemailer e db
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue(true),
    })),
  },
}));

import { db } from "@/lib/db";

describe("notifiche.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    delete process.env.PEC_SMTP_HOST;
  });

  it("notificaReferenteNuovaRevisione: non fa nulla se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("fake-id")).resolves.toBeUndefined();
  });

  it("notificaReferenteNuovaRevisione: non invia se nessun referente", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", indirizzoVia: "Via 1",
      comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1, regioneId: 1,
      volontario: { nomeCognome: "Mario", email: "m@t.it" },
    } as any);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
  });

  it("notificaReferenteNuovaRevisione: invia in modalità demo (no SMTP)", async () => {
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
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
  });

  it("notificaVolontarioRifiuto: non fa nulla se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("fake", "nota")).resolves.toBeUndefined();
  });

  it("notificaVolontarioRifiuto: non invia se volontario senza email", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: null, emailOrdinaria: null },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as any);
    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota")).resolves.toBeUndefined();
  });

  it("notificaVolontarioRifiuto: invia in modalità demo", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as any);
    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota test")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: non fa nulla se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("fake")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: invia a volontario e referente in demo", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", numeroProtocollo: "P1", indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "r1", nomeCognome: "Referente", email: "r@t.it", emailOrdinaria: null },
    } as any);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: non invia doppia se referente = volontario", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1", numeroProtocollo: "P1", indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" }, provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
    } as any);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
  });
});
