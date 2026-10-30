/**
 * Test per:
 * - calcolo della giornata dei protocolli nel fuso Europe/Rome, indipendente
 *   dal fuso del processo (in Docker il server è spesso in UTC);
 * - validazione delle soglie intere lette da variabili d'ambiente (cron-utils).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    segnalazione: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    sessione: { deleteMany: vi.fn() },
    allegato: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { calcolaProtocolloPrevisionale } from "@/lib/protocollo";
import {
  getReminderGiorni,
  getRetentionAnni,
  getTransizioneGiorni,
  REMINDER_GIORNI_DEFAULT,
  RETENTION_SEGNALAZIONI_ANNI_DEFAULT,
  TRANSIZIONE_INVIATA_GIORNI_DEFAULT,
} from "@/lib/cron-utils";

const PARAMS_BASE = {
  regione: "LOMBARDIA",
  provinciaSigla: "MI",
  segnalatoreId: "u1",
  segnalatoreNomeCognome: "Mario Rossi",
  inizialiProtocollo: "MR",
};

describe("calcolaProtocolloPrevisionale: giornata nel fuso Europe/Rome", () => {
  beforeEach(() => {
    vi.mocked(db.segnalazione.count).mockReset();
    vi.mocked(db.segnalazione.count).mockResolvedValue(0 as never);
  });

  it("23:30 UTC del 27 ottobre è già il 28 ottobre a Roma (ora solare, UTC+1)", async () => {
    const protocollo = await calcolaProtocolloPrevisionale({
      ...PARAMS_BASE,
      data: new Date("2026-10-27T23:30:00.000Z"),
    });
    expect(protocollo?.startsWith("20261028-LOM-MI-")).toBe(true);
    expect(db.segnalazione.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataSegnalazione: {
            gte: new Date("2026-10-27T23:00:00.000Z"),
            lt: new Date("2026-10-28T23:00:00.000Z"),
          },
        }),
      }),
    );
  });

  it("in estate (ora legale, UTC+2) la mezzanotte romana è alle 22:00 UTC", async () => {
    const protocollo = await calcolaProtocolloPrevisionale({
      ...PARAMS_BASE,
      data: new Date("2026-07-01T10:00:00.000Z"),
    });
    expect(protocollo?.startsWith("20260701-LOM-MI-")).toBe(true);
    expect(db.segnalazione.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataSegnalazione: {
            gte: new Date("2026-06-30T22:00:00.000Z"),
            lt: new Date("2026-07-01T22:00:00.000Z"),
          },
        }),
      }),
    );
  });

  it("il giorno del cambio d'ora (25 ottobre 2026) ha 25 ore: il bound successivo è corretto", async () => {
    await calcolaProtocolloPrevisionale({
      ...PARAMS_BASE,
      data: new Date("2026-10-25T12:00:00.000Z"),
    });
    const args = vi.mocked(db.segnalazione.count).mock.calls[0][0] as {
      where: { dataSegnalazione: { gte: Date; lt: Date } };
    };
    const ore = (args.where.dataSegnalazione.lt.getTime() - args.where.dataSegnalazione.gte.getTime()) / 3_600_000;
    expect(ore).toBe(25);
  });
});

describe("soglie intere da variabili d'ambiente", () => {
  const VARIABILI = ["RETENTION_SEGNALAZIONI_ANNI", "TRANSIZIONE_INVIATA_GIORNI", "REMINDER_GIORNI"] as const;
  const originali: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARIABILI) originali[v] = process.env[v];
  });

  afterEach(() => {
    for (const v of VARIABILI) {
      if (originali[v] === undefined) delete process.env[v];
      else process.env[v] = originali[v];
    }
  });

  it("RETENTION_SEGNALAZIONI_ANNI accetta solo interi tra 1 e 100", () => {
    const casi: Array<[string, number]> = [
      ["7", 7],
      ["100", 100],
      ["10.5", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
      ["0", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
      ["-3", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
      ["101", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
      ["abc", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
      ["", RETENTION_SEGNALAZIONI_ANNI_DEFAULT],
    ];
    for (const [raw, atteso] of casi) {
      process.env.RETENTION_SEGNALAZIONI_ANNI = raw;
      expect(getRetentionAnni(), `valore "${raw}"`).toBe(atteso);
    }
  });

  it("TRANSIZIONE_INVIATA_GIORNI rifiuta decimali e valori oltre 36500", () => {
    const casi: Array<[string, number]> = [
      ["3", 3],
      ["7.5", TRANSIZIONE_INVIATA_GIORNI_DEFAULT],
      ["36501", TRANSIZIONE_INVIATA_GIORNI_DEFAULT],
      ["NaN", TRANSIZIONE_INVIATA_GIORNI_DEFAULT],
    ];
    for (const [raw, atteso] of casi) {
      process.env.TRANSIZIONE_INVIATA_GIORNI = raw;
      expect(getTransizioneGiorni(), `valore "${raw}"`).toBe(atteso);
    }
  });

  it("REMINDER_GIORNI usa il default per valori non validi", () => {
    process.env.REMINDER_GIORNI = "-1";
    expect(getReminderGiorni()).toBe(REMINDER_GIORNI_DEFAULT);
    process.env.REMINDER_GIORNI = "14";
    expect(getReminderGiorni()).toBe(14);
  });
});
