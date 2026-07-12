/**
 * Test aggiuntivi per src/lib/rate-limit.ts - branch coverage
 */
import { describe, it, expect } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

describe("rate-limit edge cases", () => {
  it("entry bloccata ritorna allowed=false con retryAfterSeconds", () => {
    const key = `test-locked-${Date.now()}-${Math.random()}`;
    // Blocca la entry
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    // Ora è bloccata: ulteriori chiamate ritornano blocked
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.remaining).toBe(0);
  });

  it("custom lockMs sovrascrive la durata del blocco", () => {
    const key = `test-lockms-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 15000, 60000, 60000);
    const result = checkRateLimit(key, 3, 15000, 60000, 60000);
    expect(result.allowed).toBe(false);
    // lockMs=60000ms = 60s, quindi retryAfterSeconds dovrebbe essere 60
    expect(result.retryAfterSeconds).toBe(60);
  });

  it("custom windowMs sovrascrive la finestra di osservazione", () => {
    const key = `test-window-${Date.now()}-${Math.random()}`;
    // Con windowMs molto piccolo (1ms), dopo 2ms la finestra scade
    checkRateLimit(key, 100, 1); // maxAttempts=100, windowMs=1ms
    // Aspetta che la finestra passi
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Dopo che la finestra è passata, dovrebbe permettere di nuovo
        const result = checkRateLimit(key, 100, 1);
        expect(result.allowed).toBe(true);
        resolve();
      }, 10);
    });
  });

  it("blockCount si resetta dopo blockResetMs", () => {
    const key = `test-reset-block-${Date.now()}-${Math.random()}`;
    // Causa un blocco con blockResetMs molto corto (1ms)
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 60000, 1, 1); // blockResetMs=1ms
    // Il blocco è attivo
    expect(checkRateLimit(key, 3, 60000, 1, 1).allowed).toBe(false);
    // Aspetta che il lock scada e il blockResetMs passi
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Ora dovrebbe essere resettato completamente
        const result = checkRateLimit(key, 3, 60000, 1, 1);
        expect(result.allowed).toBe(true);
        expect(result.blockCount).toBe(0);
        resolve();
      }, 100);
    });
  });

  it("due chiavi con stesso prefisso ma suffisso diverso sono indipendenti", () => {
    const base = `test-prefix-${Date.now()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(`${base}-a`, 3);
    expect(checkRateLimit(`${base}-a`, 3).allowed).toBe(false);
    expect(checkRateLimit(`${base}-b`, 3).allowed).toBe(true);
  });

  it("blockCount=0 quando allowed=true", () => {
    const key = `test-bc0-${Date.now()}-${Math.random()}`;
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBe(0);
  });

  it("blockCount > 0 quando blocked", () => {
    const key = `test-bc1-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.blockCount).toBeGreaterThan(0);
  });
});
