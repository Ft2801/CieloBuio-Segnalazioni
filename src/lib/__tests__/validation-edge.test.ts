/**
 * Test per il ramo residuo di validation.ts:
 * - validate() ritorna "Validazione fallita" se result.error.issues è vuoto (riga 178)
 *
 * Per coprire questo ramo usiamo vi.spyOn su ZodSchema.prototype.safeParse
 * per simulare un risultato di errore senza issues.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate, validaPecCcAggiuntive } from "@/lib/validation";

describe("validate - ramo fallback 'Validazione fallita'", () => {
  it("ritorna il messaggio della prima issue quando presente", () => {
    const schema = z.string().min(5, "Almeno 5 caratteri");
    const result = validate(schema, "ab");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Almeno 5 caratteri");
    }
  });

  it("ritorna 'Validazione fallita' se result.error.issues è vuoto (ramo ??)", () => {
    const schema = z.string();
    const fakeResult = {
      success: false,
      error: {
        issues: [], // issues vuoto: firstError sarà undefined -> ramo ??
      },
    };
    vi.spyOn(schema, "safeParse").mockReturnValue(fakeResult as any);

    const result = validate(schema, "test");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Validazione fallita");
    }
    vi.restoreAllMocks();
  });

  it("ritorna 'Validazione fallita' se firstError.message è undefined", () => {
    const schema = z.string();
    const fakeResult = {
      success: false,
      error: {
        issues: [{ message: undefined, path: [], code: "custom" }],
      },
    };
    vi.spyOn(schema, "safeParse").mockReturnValue(fakeResult as any);

    const result = validate(schema, "test");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Validazione fallita");
    }
    vi.restoreAllMocks();
  });

  it("validate con schema any ritorna success", () => {
    const schema = z.any();
    const result = validate(schema, "anything");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("anything");
    }
  });

  it("validate con schema literal", () => {
    const schema = z.literal("hello");
    expect(validate(schema, "hello").success).toBe(true);
    expect(validate(schema, "world").success).toBe(false);
  });
});

describe("validaPecCcAggiuntive - rami aggiuntivi", () => {
  it("accetta input con solo spazi e punti e virgola", () => {
    expect(validaPecCcAggiuntive("   ").ok).toBe(true);
    expect(validaPecCcAggiuntive("; ; ;").ok).toBe(true);
  });

  it("accetta un singolo indirizzo valido", () => {
    const result = validaPecCcAggiuntive("a@b.it");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emails).toEqual(["a@b.it"]);
  });

  it("rifiuta un singolo indirizzo non valido", () => {
    const result = validaPecCcAggiuntive("non-email");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("non-email");
  });
});
