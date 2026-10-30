import { afterEach, describe, expect, it, vi } from "vitest";
import { prossimaVersione, versioneCorrisponde } from "@/lib/versione";

describe("versioni delle pratiche", () => {
  afterEach(() => vi.useRealTimers());
  it("mantiene una progressione stretta anche con orologio fermo o arretrato", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    expect(prossimaVersione().getTime()).toBe(1000);
    expect(prossimaVersione(new Date(2000)).getTime()).toBe(2001);
    expect(prossimaVersione(new Date(1000)).getTime()).toBe(1001);
    expect(prossimaVersione(new Date(500)).getTime()).toBe(1000);
    vi.restoreAllMocks();
  });
  it("accetta solo il tag forte dello snapshot o un client senza precondizione", () => {
    const corrente = new Date("2026-01-01T00:00:00.123Z");
    expect(versioneCorrisponde(null, corrente)).toBe(true);
    expect(versioneCorrisponde(JSON.stringify(corrente.toISOString()), corrente)).toBe(true);
    for (const attesa of ["", "*", 'W/"2026-01-01T00:00:00.123Z"', '"2026-01-01T00:00:00.122Z"']) {
      expect(versioneCorrisponde(attesa, corrente)).toBe(false);
    }
  });
});
