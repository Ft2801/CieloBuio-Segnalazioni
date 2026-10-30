import { afterEach, describe, expect, it, vi } from "vitest";
import { computeTotpTimestep, createTotp, generateTotpSecret, verifyTotpWithDelta } from "@/lib/totp";

afterEach(() => vi.useRealTimers());

describe("TOTP e istante della verifica", () => {
  it("usa lo stesso istante per validazione e registrazione anche al cambio finestra", () => {
    vi.useFakeTimers();
    const istante = new Date("2026-10-30T12:00:29.999Z");
    vi.setSystemTime(istante);
    const secret = generateTotpSecret();
    const token = createTotp("utente@example.test", secret).generate({ timestamp: istante.getTime() });
    vi.setSystemTime(new Date(istante.getTime() + 1));
    const verifica = verifyTotpWithDelta(token, secret, istante.getTime());
    expect(verifica).toEqual({ valid: true, delta: 0 });
    if (!verifica.valid) throw new Error("Verifica non riuscita");
    expect(computeTotpTimestep(istante, verifica.delta)).toBe(Math.floor(istante.getTime() / 30_000));
    expect(verifyTotpWithDelta(token, secret)).toEqual({ valid: true, delta: -1 });
  });
});
