/**
 * Copertura di db.ts: creazione pigra del client, log per ambiente e retry
 * delle operazioni su errori transitori. Il client Prisma è finto e la
 * configurazione dell'estensione viene catturata per invocarla direttamente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

const stato = vi.hoisted(() => ({
  configEstensione: null as null | { query: { $allOperations: (p: unknown) => Promise<unknown> } },
  opzioniCreazione: [] as unknown[],
}));

vi.mock("@/lib/prisma-client", () => ({
  createPrismaClient: vi.fn((opzioni: unknown) => {
    stato.opzioniCreazione.push(opzioni);
    return {
      $disconnect: vi.fn(),
      $extends: (config: NonNullable<typeof stato.configEstensione>) => {
        stato.configEstensione = config;
        return { marcatore: "esteso", $connect: vi.fn(async () => "connesso") };
      },
    };
  }),
}));

const loggerErrore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  logger: { error: loggerErrore, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function errorePrisma(codice: string) {
  return new Prisma.PrismaClientKnownRequestError("errore di test", {
    code: codice,
    clientVersion: "7.10.1",
  });
}

async function caricaDb() {
  vi.resetModules();
  const modulo = await import("@/lib/db");
  // Il client è creato al primo accesso: la lettura forza la creazione.
  void (modulo.db as unknown as { marcatore?: string }).marcatore;
  return modulo;
}

async function invia(operation: string, query: (args: unknown) => Promise<unknown>, args: unknown = {}) {
  await caricaDb();
  const config = stato.configEstensione;
  if (!config) throw new Error("estensione non registrata");
  return config.query.$allOperations({ operation, args, query });
}

beforeEach(() => {
  stato.configEstensione = null;
  stato.opzioniCreazione = [];
  loggerErrore.mockReset();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (globalThis as { prisma?: unknown }).prisma;
});

describe("db - creazione del client", () => {
  it("in sviluppo registra query, errori e avvisi, e riusa il client base", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const primo = await caricaDb();
    expect(stato.opzioniCreazione[0]).toEqual({ log: ["query", "error", "warn"] });
    expect(primo.db).toBeDefined();
    // Un secondo caricamento del modulo riusa il client già presente nel globale.
    await caricaDb();
    expect(stato.opzioniCreazione).toHaveLength(1);
  });

  it("in produzione registra solo errori e avvisi e non cache il client nel globale", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await caricaDb();
    expect(stato.opzioniCreazione[0]).toEqual({ log: ["error", "warn"] });
    expect((globalThis as { prisma?: unknown }).prisma).toBeUndefined();
  });

  it("il proxy espone le proprietà del client esteso e lega i metodi", async () => {
    const { db } = await caricaDb();
    expect((db as unknown as { marcatore: string }).marcatore).toBe("esteso");
    await expect((db as unknown as { $connect: () => Promise<string> }).$connect()).resolves.toBe("connesso");
  });
});

describe("db - retry su errori transitori", () => {
  it("le operazioni non gestite passano direttamente alla query", async () => {
    const query = vi.fn().mockResolvedValue("ok");
    await expect(invia("$connect", query, { x: 1 })).resolves.toBe("ok");
    expect(query).toHaveBeenCalledWith({ x: 1 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("una lettura riuscita restituisce il risultato senza ritentare", async () => {
    const query = vi.fn().mockResolvedValue([{ id: 1 }]);
    await expect(invia("findMany", query)).resolves.toEqual([{ id: 1 }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("una lettura con errore di rete transitorio viene ritentata", async () => {
    const query = vi.fn().mockRejectedValueOnce(errorePrisma("P1001")).mockResolvedValue({ id: "a" });
    await expect(invia("findUnique", query)).resolves.toEqual({ id: "a" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("una lettura interrotta da timeout del pool viene ritentata", async () => {
    const query = vi.fn().mockRejectedValueOnce(errorePrisma("P2024")).mockResolvedValue(3);
    await expect(invia("count", query)).resolves.toBe(3);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("una lettura esaurisce i tentativi e registra l'errore", async () => {
    const query = vi.fn().mockRejectedValue(errorePrisma("P1017"));
    await expect(invia("aggregate", query)).rejects.toMatchObject({ code: "P1017" });
    expect(query).toHaveBeenCalledTimes(5);
    expect(loggerErrore).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "aggregate" }),
      "Prisma retry esaurito senza successo",
    );
  });

  it("una scrittura con deadlock (P2034) viene ritentata", async () => {
    const query = vi.fn().mockRejectedValueOnce(errorePrisma("P2034")).mockResolvedValue({ id: 9 });
    await expect(invia("create", query)).resolves.toEqual({ id: 9 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("una scrittura con errore di rete non viene ritentata per evitare duplicati", async () => {
    const query = vi.fn().mockRejectedValue(errorePrisma("P1001"));
    await expect(invia("createMany", query)).rejects.toMatchObject({ code: "P1001" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("un errore non Prisma non viene ritentato", async () => {
    const query = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(invia("updateMany", query)).rejects.toThrow("boom");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("un errore Prisma con codice non ritentabile non viene ritentato", async () => {
    const query = vi.fn().mockRejectedValue(errorePrisma("P2002"));
    await expect(invia("findFirst", query)).rejects.toMatchObject({ code: "P2002" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("il ritardo tra i tentativi cresce in modo esponenziale", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const timer = vi.spyOn(globalThis, "setTimeout");
    const query = vi
      .fn()
      .mockRejectedValueOnce(errorePrisma("P1008"))
      .mockRejectedValueOnce(errorePrisma("P1008"))
      .mockResolvedValue("fine");
    await expect(invia("groupBy", query)).resolves.toBe("fine");
    const ritardi = timer.mock.calls.map((c) => c[1]).filter((v) => typeof v === "number");
    expect(ritardi).toEqual([100, 200]);
  });
});
