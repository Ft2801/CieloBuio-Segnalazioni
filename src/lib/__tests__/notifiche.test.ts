/**
 * Test per src/lib/notifiche.ts con mock di nodemailer e db
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";

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
vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({
    close: vi.fn(),
    sendMail: vi.fn().mockResolvedValue(true),
  }));
  return { createTransport, default: { createTransport } };
});

import { db } from "@/lib/db";

// Senza SMTP configurato ogni email viene registrata con questo messaggio invece di essere
// inviata: il test verifica quali destinatari sarebbero stati raggiunti.
const MESSAGGIO_NON_INVIATA = "Notifica email non inviata: SMTP non configurato";
function destinatariRegistrati(): string[] {
  return vi
    .mocked(logger.info)
    .mock.calls.filter((c) => c[1] === MESSAGGIO_NON_INVIATA)
    .map((c) => JSON.stringify((c[0] as { to: unknown }).to));
}

describe("notifiche.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    // Reset env
    delete process.env.PEC_SMTP_HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notificaReferenteNuovaRevisione: non fa nulla se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("fake-id")).resolves.toBeUndefined();
  });

  it("notificaReferenteNuovaRevisione: non invia se nessun referente", async () => {
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
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
    expect(destinatariRegistrati()).toEqual([]);
  });

  it("notificaReferenteNuovaRevisione: senza SMTP registra l'email destinata al referente", async () => {
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
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
    expect(destinatariRegistrati().some((d) => d.includes("ref@t.it"))).toBe(true);
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
    } as never);
    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota")).resolves.toBeUndefined();
    expect(destinatariRegistrati()).toEqual([]);
  });

  it("notificaVolontarioRifiuto: senza SMTP registra l'email destinata al volontario", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as never);
    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota test")).resolves.toBeUndefined();
    expect(destinatariRegistrati().some((d) => d.includes("m@t.it"))).toBe(true);
  });

  it("notificaPecInviata: non fa nulla se segnalazione non trovata", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("fake")).resolves.toBeUndefined();
  });

  it("notificaPecInviata: senza SMTP registra l'email per volontario e referente", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      numeroProtocollo: "P1",
      indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "r1", nomeCognome: "Referente", email: "r@t.it", emailOrdinaria: null },
    } as never);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
    expect(destinatariRegistrati().some((d) => d.includes("m@t.it"))).toBe(true);
    expect(destinatariRegistrati().some((d) => d.includes("r@t.it"))).toBe(true);
  });

  it("notificaPecInviata: non invia doppia se referente = volontario", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      numeroProtocollo: "P1",
      indirizzoVia: "Via 1",
      dataInvio: new Date(),
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      volontario: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
      referenteApprovatore: { id: "v1", nomeCognome: "Mario", email: "m@t.it", emailOrdinaria: null },
    } as never);
    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
    expect(destinatariRegistrati()).toHaveLength(1);
  });
});
