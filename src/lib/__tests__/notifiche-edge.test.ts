/**
 * Test per i rami residui di notifiche.ts:
 * - referenti con email null/non disponibile (riga 110, 119)
 * - volontario senza email in notificaVolontarioRifiuto (riga 146)
 * - referente = volontario ID uguale in notificaPecInviata (riga 175-181)
 * - referente senza email in notificaPecInviata
 * - email referente = email volontario (skip)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";

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

vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({
    close: vi.fn(),
    sendMail: vi.fn().mockResolvedValue(true),
  }));
  return { createTransport, default: { createTransport } };
});

import { db } from "@/lib/db";

// Senza SMTP configurato ogni email viene registrata con questo messaggio invece di essere
// inviata: i test verificano quali destinatari sarebbero stati raggiunti.
const MESSAGGIO_NON_INVIATA = "Notifica email non inviata: SMTP non configurato";
function destinatariRegistrati(): string[] {
  return vi
    .mocked(logger.info)
    .mock.calls.filter((c) => c[1] === MESSAGGIO_NON_INVIATA)
    .map((c) => JSON.stringify((c[0] as { to: unknown }).to));
}

describe("notifiche.ts - rami residui per coverage 100%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    delete process.env.PEC_SMTP_HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { emailOrdinaria: null, email: null }, // skip: nessuna email
      { emailOrdinaria: "valid@t.it", email: "alt@t.it" }, // usa emailOrdinaria
    ] as never);

    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await expect(notificaReferenteNuovaRevisione("s1")).resolves.toBeUndefined();
    const destinatari = destinatariRegistrati();
    expect(destinatari).toHaveLength(1);
    expect(destinatari[0]).toContain("valid@t.it");
    expect(destinatari.some((d) => d.includes("alt@t.it"))).toBe(false);
  });

  it("notificaVolontarioRifiuto: volontario con emailOrdinaria ma senza email (riga 142-143)", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s1",
      volontario: { nomeCognome: "Mario", email: null, emailOrdinaria: "mario@ord.it" },
      referenteApprovatore: { nomeCognome: "Referente" },
    } as never);

    const { notificaVolontarioRifiuto } = await import("@/lib/notifiche");
    await expect(notificaVolontarioRifiuto("s1", "nota")).resolves.toBeUndefined();
    const destinatari = destinatariRegistrati();
    expect(destinatari).toHaveLength(1);
    expect(destinatari[0]).toContain("mario@ord.it");
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
    } as never);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s1")).resolves.toBeUndefined();
    const destinatari = destinatariRegistrati();
    expect(destinatari).toHaveLength(1);
    expect(destinatari[0]).toContain("ref@t.it");
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
    } as never);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s2")).resolves.toBeUndefined();
    expect(destinatariRegistrati()).toHaveLength(1);
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
    } as never);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s3")).resolves.toBeUndefined();
    const destinatari = destinatariRegistrati();
    expect(destinatari).toHaveLength(1);
    expect(destinatari[0]).toContain("mario@t.it");
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
    } as never);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s4")).resolves.toBeUndefined();
    expect(destinatariRegistrati()).toHaveLength(1);
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
    } as never);

    const { notificaPecInviata } = await import("@/lib/notifiche");
    await expect(notificaPecInviata("s5")).resolves.toBeUndefined();
    const destinatari = destinatariRegistrati();
    expect(destinatari).toHaveLength(1);
    expect(destinatari[0]).toContain("m@t.it");
  });
  it("notificaReferenteNuovaRevisione: senza comune l'oggetto non riporta luogo vuoto", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s9",
      indirizzoVia: "Via 9",
      comune: null,
      provincia: null,
      regione: { regione: "LOMBARDIA" },
      provinciaId: null,
      regioneId: 1,
      volontario: null,
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ email: "reg@example.it", emailOrdinaria: null }] as never);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s9");
    const oggetti = vi.mocked(logger.info).mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(oggetti).toEqual(["Nuova segnalazione in revisione"]);
  });

  it("notificaReferenteNuovaRevisione: comune senza sigla provincia non mostra parentesi vuote", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s10",
      indirizzoVia: "Via 10",
      comune: { nome: "Verdello" },
      provincia: null,
      regione: null,
      provinciaId: 1,
      regioneId: null,
      volontario: null,
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([{ email: "prov@example.it", emailOrdinaria: null }] as never);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s10");
    const oggetti = vi.mocked(logger.info).mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(oggetti).toEqual(["Nuova segnalazione in revisione: Verdello"]);
  });

  it("notificaReferenteNuovaRevisione: referenti con la stessa email ricevono una sola copia", async () => {
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue({
      id: "s11",
      indirizzoVia: "Via 11",
      comune: { nome: "Verdello" },
      provincia: { sigla: "BG" },
      regione: { regione: "LOMBARDIA" },
      provinciaId: 1,
      regioneId: 1,
      volontario: null,
    } as never);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { email: "condiviso@example.it", emailOrdinaria: null },
      { email: "altro@example.it", emailOrdinaria: "condiviso@example.it" },
    ] as never);
    const { notificaReferenteNuovaRevisione } = await import("@/lib/notifiche");
    await notificaReferenteNuovaRevisione("s11");
    expect(destinatariRegistrati()).toEqual(['"condiviso@example.it"']);
  });
});
