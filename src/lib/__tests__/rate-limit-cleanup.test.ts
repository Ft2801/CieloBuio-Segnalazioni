/**
 * Test per rate-limit.ts cleanup e escalation con fake timers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("rate-limit cleanup e escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cleanup rimuove entry con lock scaduto dopo 1 ora", () => {
    const key = `test-cleanup-${Date.now()}-${Math.random()}`;
    // Blocca la entry
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    // Avanza il tempo oltre il lock (5 min) e oltre 1 ora da lastBlock
    vi.advanceTimersByTime(61 * 60 * 1000); // 61 minuti
    // cleanup dovrebbe rimuovere la entry
    // Una nuova chiamata dovrebbe permettere (entry nuova)
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBe(0);
  });

  it("cleanup rimuove entry senza lock dopo 1 ora di inattività", () => {
    const key = `test-cleanup2-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 3); // count=1, no lock
    // Avanza oltre 1 ora
    vi.advanceTimersByTime(61 * 60 * 1000);
    // Una nuova chiamata dovrebbe creare una nuova entry
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // nuova entry, count=1, remaining=2
  });

  it("getBlockDuration escalation: 1° blocco = 5 min", () => {
    const key = `test-esc1-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(300); // 5 minuti
  });

  it("getBlockDuration escalation: 2° blocco = 15 min", () => {
    const key = `test-esc2-${Date.now()}-${Math.random()}`;
    // Primo blocco
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    checkRateLimit(key, 3); // 1° blocco
    // Aspetta che il lock scada
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 min (> 5 min lock)
    // Secondo blocco
    checkRateLimit(key, 3); // count ricomincia
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3); // 4° tentativo
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(900); // 15 minuti
  });

  it("getBlockDuration escalation: 3° blocco = 1 ora", () => {
    const key = `test-esc3-${Date.now()}-${Math.random()}`;
    // 1° blocco
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    vi.advanceTimersByTime(6 * 60 * 1000);
    // 2° blocco
    checkRateLimit(key, 3);
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    vi.advanceTimersByTime(16 * 60 * 1000);
    // 3° blocco
    checkRateLimit(key, 3);
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(3600); // 1 ora
  });

  it("lock scaduto mantiene blockCount per escalation", () => {
    const key = `test-lock-keep-${Date.now()}-${Math.random()}`;
    // 1° blocco
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    expect(checkRateLimit(key, 3).blockCount).toBe(1);
    // Lock scaduto
    vi.advanceTimersByTime(6 * 60 * 1000);
    // Nuovo tentativo - dovrebbe essere allowed ma blockCount mantenuto
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(true);
    // Ora se fallisce di nuovo, dovrebbe avere blockCount=2
    checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    const blocked = checkRateLimit(key, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockCount).toBe(2);
  });

  it("blockCount si resetta dopo blockResetMs (1 ora)", () => {
    const key = `test-block-reset-${Date.now()}-${Math.random()}`;
    // 1° blocco
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3);
    checkRateLimit(key, 3);
    // Aspetta oltre il lock (5 min) e oltre blockResetMs (1 ora)
    vi.advanceTimersByTime(61 * 60 * 1000);
    // Nuovo tentativo - cleanup dovrebbe resettare tutto
    const result = checkRateLimit(key, 3);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBe(0);
  });
});
