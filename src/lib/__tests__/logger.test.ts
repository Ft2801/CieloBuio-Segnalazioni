/**
 * Test di configurazione del logger Pino: livello, formato e redazione.
 * Pino è mockato per ispezionare le opzioni senza creare worker di trasporto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pinoMock = vi.hoisted(() => vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })));

vi.mock("pino", () => ({ default: pinoMock }));

async function caricaLogger(ambiente: Record<string, string | undefined>) {
  for (const [chiave, valore] of Object.entries(ambiente)) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
  vi.resetModules();
  pinoMock.mockClear();
  await import("@/lib/logger");
  const [opzioni] = pinoMock.mock.calls[0] as unknown as [Record<string, unknown>];
  return opzioni;
}

const originali = {
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  LOG_FORMAT: process.env.LOG_FORMAT,
};

afterEach(() => {
  for (const [chiave, valore] of Object.entries(originali)) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});

describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("in produzione usa livello info e JSON senza transport", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "production", LOG_LEVEL: undefined, LOG_FORMAT: undefined });
    expect(opzioni.level).toBe("info");
    expect(opzioni).not.toHaveProperty("transport");
  });

  it("fuori dalla produzione usa livello debug", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "development", LOG_LEVEL: undefined, LOG_FORMAT: undefined });
    expect(opzioni.level).toBe("debug");
  });

  it("LOG_LEVEL ha la precedenza sul livello predefinito", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "production", LOG_LEVEL: "warn", LOG_FORMAT: undefined });
    expect(opzioni.level).toBe("warn");
  });

  it("LOG_FORMAT=pretty attiva il formattatore pino-pretty", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "development", LOG_LEVEL: undefined, LOG_FORMAT: "pretty" });
    expect(opzioni.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
    });
  });

  it("redige i segreti e i dati personali, a qualsiasi profondità", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "production", LOG_LEVEL: undefined, LOG_FORMAT: undefined });
    const redact = opzioni.redact as { paths: string[]; censor: string };
    expect(redact.censor).toBe("[REDACTED]");
    for (const percorso of [
      "passwordHash",
      "*.totpSecret",
      "*.totpPendingSecret",
      "**.totpPendingSecret",
      "**.token",
      "user.pec",
      "req.headers.cookie",
    ]) {
      expect(redact.paths).toContain(percorso);
    }
  });

  it("espone nel log il livello come etichetta testuale e il servizio", async () => {
    const opzioni = await caricaLogger({ NODE_ENV: "production", LOG_LEVEL: undefined, LOG_FORMAT: undefined });
    const formatters = opzioni.formatters as { level: (label: string) => unknown };
    expect(formatters.level("warn")).toEqual({ level: "warn" });
    expect(opzioni.base).toEqual({ service: "cielobuio-segnalazioni", version: "1.0.0" });
  });
});
