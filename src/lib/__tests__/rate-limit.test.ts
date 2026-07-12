/**
 * Test completi per src/lib/rate-limit.ts
 */
import { describe, it, expect } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("permette fino a 3 tentativi (maxAttempts=3)", () => {
    const key = `test-allow-${Date.now()}`;
    expect(checkRateLimit(key, 3).allowed).toBe(true);  // count=1
    expect(checkRateLimit(key, 3).allowed).toBe(true);  // count=2
    expect(checkRateLimit(key, 3).allowed).toBe(true);  // count=3
  });

  it("blocca al 4° tentativo", () => {
    const key = `test-block-${Date.now()}`;
    checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.blockCount).toBe(1);
    expect(result.retryAfterSeconds).toBeTruthy();
  });

  it("remaining calcolato correttamente", () => {
    const key = `test-remaining-${Date.now()}-${Math.random()}`;
    let result = checkRateLimit(key, 3);
    expect(result.remaining).toBe(2);
    result = checkRateLimit(key, 3);
    expect(result.remaining).toBe(1);
    result = checkRateLimit(key, 3);
    expect(result.remaining).toBe(0);
  });

  it("resetRateLimit sblocca il rate limit", () => {
    const key = `test-reset-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    resetRateLimit(key);
    expect(checkRateLimit(key, 3).allowed).toBe(true);
  });

  it("resetRateLimit su chiave inesistente è no-op", () => {
    expect(() => resetRateLimit("chiave-inesistente")).not.toThrow();
  });

  it("blockCount cresce con escalation", () => {
    const key = `test-esc-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    let result = checkRateLimit(key, 3);
    expect(result.blockCount).toBe(1);
  });

  it("chiavi diverse sono indipendenti", () => {
    const key1 = `test-ind1-${Date.now()}`;
    const key2 = `test-ind2-${Date.now()}`;
    checkRateLimit(key1, 3);
    checkRateLimit(key1, 3);
    checkRateLimit(key1, 3);
    expect(checkRateLimit(key1, 3).allowed).toBe(false);
    // key2 non è stata toccata
    expect(checkRateLimit(key2, 3).allowed).toBe(true);
  });

  it("default maxAttempts=3 se non specificato", () => {
    const key = `test-default-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(false);
  });

  it("custom maxAttempts", () => {
    const key = `test-custom-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, 5).allowed).toBe(true);
    expect(checkRateLimit(key, 5).allowed).toBe(true);
    expect(checkRateLimit(key, 5).allowed).toBe(true);
    expect(checkRateLimit(key, 5).allowed).toBe(true);
    expect(checkRateLimit(key, 5).allowed).toBe(true);
    expect(checkRateLimit(key, 5).allowed).toBe(false);
  });

  it("blocked key ritorna retryAfterSeconds > 0", () => {
    const key = `test-retry-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
