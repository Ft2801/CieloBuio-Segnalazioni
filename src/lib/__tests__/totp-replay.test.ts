/**
 * Test per registraTimestepTotp: la registrazione del timestep TOTP è
 * condizionata, quindi un codice già usato non viene accettato due volte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      updateMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { registraTimestepTotp } from "@/lib/totp-replay";

describe("registraTimestepTotp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registra il timestep e ritorna true quando il codice non è ancora stato usato", async () => {
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);
    const ok = await registraTimestepTotp("u1", 500, "secret-attivo");
    expect(ok).toBe(true);
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "u1",
        totpSecret: "secret-attivo",
        totpVerifiedAt: { not: null },
        OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: 500 } }],
      },
      data: { totpLastUsedTimestep: 500 },
    });
  });

  it("ritorna false quando nessuna riga è aggiornata (codice già usato o più recente)", async () => {
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 0 } as never);
    expect(await registraTimestepTotp("u1", 500, "secret-scaduto")).toBe(false);
  });
});
