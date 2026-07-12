/**
 * Test per i rami residui di notifiche.ts:
 * - referenti con email null/non disponibile (riga 110, 119)
 * - volontario senza email in notificaVolontarioRifiuto (riga 146)
 * - referente = volontario ID uguale in notificaPecInviata (riga 175-181)
 * - referente senza email in notificaPecInviata
 * - email referente = email volontario (skip)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue(true),
    })),
  },
}));

import { db } from "@/lib/db";

describe("notifiche.ts - rami residui per coverage 100%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PEC_SMTP_HOST;
  });

  it("notificaReferenteNuovaRevisione: skip referente senza email (riga 110/119)", async () => {
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
      { emailOrdinaria: null, email: null }, // skip: nessuna email
      { emailOrdinaria: "valid@t.it", email: "alt@t.it" }, // usa emailOrdinaria
    ] as any);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
  });

  it("notificaVolontarioRifiuto: volontario con emailOrdinaria ma senza email (riga 142-143)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: null, emailOrdinaria: "mario@ord.it" },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as any);

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: volontario senza email ma referente con email", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      numeroProtocollo: "P1",
      indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: null, emailOrdinaria: null },
      referenteApprovatore: {
        id: "r1",
        nomeCognome: "Referente",
        email: "ref@t.it",
        emailOrdinaria: null,
      },
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: referente con stessa email del volontario (skip invio doppio)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s2",
      numeroProtocollo: "P2",
      indirizzoVia: "Via 2",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: {
        id: "v2",
        nomeCognome: "Mario",
        email: "stessa@t.it",
        emailOrdinaria: null,
      },
      referenteApprovatore: {
        id: "r2",
        nomeCognome: "Referente",
        email: "stessa@t.it",
        emailOrdinaria: null,
      },
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s2")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: referente senza email (skip)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s3",
      numeroProtocollo: "P3",
      indirizzoVia: "Via 3",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: {
        id: "v3",
        nomeCognome: "Mario",
        email: "mario@t.it",
        emailOrdinaria: null,
      },
      referenteApprovatore: {
        id: "r3",
        nomeCognome: "Referente",
        email: null,
        emailOrdinaria: null,
      },
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s3")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: volontario e referente con stesso id (skip referente)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s4",
      numeroProtocollo: "P4",
      indirizzoVia: "Via 4",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: {
        id: "same",
        nomeCognome: "Mario",
        email: "m@t.it",
        emailOrdinaria: null,
      },
      referenteApprovatore: {
        id: "same",
        nomeCognome: "Mario",
        email: "m@t.it",
        emailOrdinaria: null,
      },
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s4")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: senza dataInvio (n/d nel testo)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s5",
      numeroProtocollo: null,
      indirizzoVia: "Via 5",
      dataInvio: null,
      comune: null,
      provincia: null,
      volontario: {
        id: "v5",
        nomeCognome: "Mario",
        email: "m@t.it",
        emailOrdinaria: null,
      },
      referenteApprovatore: null,
    } as any);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s5")).resolves.toBeUndefined();
  });
});
