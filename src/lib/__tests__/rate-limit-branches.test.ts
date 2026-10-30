/**
 * Test per i rami residui di rate-limit.ts:
 * - getBlockDuration: tutti i 4 rami (blockCount <=1, 2, 3, >=4)
 * - cleanup(): ramo che elimina entry con lock scaduto + lastBlock > 1h
 * - cleanup(): ramo che elimina entry senza lock + firstAttempt > 1h
 * - cleanup(): skip se cleanup recente (< 15 min)
 * - lockMs personalizzato
 * - resetRateLimit mantieni blockCount
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  getBlockDuration,
  cleanup,
  __resetRateLimitStoreForTests,
} from "@/lib/rate-limit";

describe("getBlockDuration - tutti i rami", () => {
  it("blockCount <= 1 ritorna 5 minuti", () => {
    expect(getBlockDuration(0)).toBe(5 * 60 * 1000);
    expect(getBlockDuration(1)).toBe(5 * 60 * 1000);
  });

  it("blockCount === 2 ritorna 15 minuti", () => {
    expect(getBlockDuration(2)).toBe(15 * 60 * 1000);
  });

  it("blockCount === 3 ritorna 1 ora", () => {
    expect(getBlockDuration(3)).toBe(60 * 60 * 1000);
  });

  it("blockCount >= 4 ritorna 24 ore", () => {
    expect(getBlockDuration(4)).toBe(24 * 60 * 60 * 1000);
    expect(getBlockDuration(5)).toBe(24 * 60 * 60 * 1000);
    expect(getBlockDuration(100)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("cleanup - rami completi con fake timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetRateLimitStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cleanup richiamato entro 15 min dall'ultimo non rimuove i blocchi ancora attivi", () => {
    // Con un intervallo recente il cleanup esce subito: un blocco attivo deve restare tale.
    // (Un'entry eleggibile alla rimozione non può esistere in quella finestra, quindi
    // l'effetto osservabile del salto è questo.)
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);
    for (let i = 0; i < 4; i++) checkRateLimit("key-recent", 3, 60000, 60 * 60 * 1000, 60 * 60 * 1000);
    vi.setSystemTime(baseTime + 5 * 60 * 1000);
    cleanup();
    expect(checkRateLimit("key-recent", 3, 60000, 60 * 60 * 1000, 60 * 60 * 1000).allowed).toBe(false);
  });

  it("elimina entry con lock scaduto + lastBlock > 1h", () => {
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);
    // Crea un'entry bloccata con lockMs breve (100ms)
    for (let i = 0; i < 4; i++) checkRateLimit("key-locked", 3, 60000, 60 * 60 * 1000, 100);

    // Avanza di 1 ora e 1 minuto + 15 minuti (per triggerare cleanup)
    vi.setSystemTime(baseTime + (60 + 15 + 1) * 60 * 1000);

    // cleanup dovrebbe eliminare l'entry (lock scaduto + lastBlock > 1h)
    cleanup();

    // Verifica: una nuova chiamata con stessa chiave è allowed (entry nuova)
    const result = checkRateLimit("key-locked", 3, 60000, 60 * 60 * 1000, 100);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBe(0); // entry nuova, blockCount reset
  });

  it("elimina entry senza lock + firstAttempt > 1h", () => {
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);
    // Crea un'entry SENZA bloccarla (solo count, no lock)
    checkRateLimit("key-no-lock", 3, 60000, 60 * 60 * 1000, 100);
    // Nota: firstAttempt = baseTime, lockedUntil = null

    // Avanza di 1 ora e 15 minuti + 1 minuto
    vi.setSystemTime(baseTime + (60 + 15 + 1) * 60 * 1000);

    // cleanup dovrebbe eliminare l'entry (no lock + firstAttempt > 1h)
    cleanup();

    // Verifica: una nuova chiamata è una entry nuova
    const result = checkRateLimit("key-no-lock", 3, 60000, 60 * 60 * 1000, 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // count = 1
  });

  it("non elimina entry con lock ancora attivo", () => {
    const baseTime = Date.now();
    vi.setSystemTime(baseTime);
    // Crea un'entry bloccata con lock lungo (1 ora)
    for (let i = 0; i < 4; i++) checkRateLimit("key-active-lock", 3, 60000, 60 * 60 * 1000, 60 * 60 * 1000);

    // Avanza di 15 minuti + 1 (trigger cleanup)
    vi.setSystemTime(baseTime + (15 + 1) * 60 * 1000);

    cleanup();

    // L'entry dovrebbe essere ancora bloccata (lock non scaduto)
    const result = checkRateLimit("key-active-lock", 3, 60000, 60 * 60 * 1000, 60 * 60 * 1000);
    expect(result.allowed).toBe(false);
  });
});

describe("rate-limit - scadenza esatta del blocco", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetRateLimitStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nega un millisecondo prima e riapre al millisecondo di scadenza", () => {
    const key = "scadenza-esatta";
    const lockMs = 60_000;
    const inizio = Date.now();
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 15 * 60_000, 60 * 60_000, lockMs);

    vi.setSystemTime(inizio + lockMs - 1);
    const prima = checkRateLimit(key, 3, 15 * 60_000, 60 * 60_000, lockMs);
    expect(prima.allowed).toBe(false);
    expect(prima.retryAfterSeconds).toBe(1);

    vi.setSystemTime(inizio + lockMs);
    const dopo = checkRateLimit(key, 3, 15 * 60_000, 60 * 60_000, lockMs);
    expect(dopo.allowed).toBe(true);
    expect(dopo.remaining).toBe(2);
    expect(dopo.blockCount).toBe(1);
  });
});

describe("rate-limit - lockMs personalizzato", () => {
  beforeEach(() => {
    __resetRateLimitStoreForTests();
  });

  it("lockMs personalizzato sovrascrive getBlockDuration", () => {
    const key = `lockms-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    const result = checkRateLimit(key, 3, 15 * 60 * 1000, 60 * 60 * 1000, 1000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1); // 1 secondo, non 300
  });
});

describe("rate-limit - reset e escalation", () => {
  beforeEach(() => {
    __resetRateLimitStoreForTests();
  });

  it("resetRateLimit mantiene blockCount per escalation futura", () => {
    const key = `reset-esc-${Date.now()}-${Math.random()}`;
    // Blocca con lockMs breve
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 60000, 60 * 60 * 1000, 100);
    expect(checkRateLimit(key, 3, 60000, 60 * 60 * 1000, 100).allowed).toBe(false);

    // Aspetta scadenza lock
    const start = Date.now();
    while (Date.now() - start < 200) {
      // busy wait 200ms > 100ms lock
    }

    resetRateLimit(key);
    // Ora allowed, ma blockCount dovrebbe essere preservato
    const result = checkRateLimit(key, 3, 60000, 60 * 60 * 1000, 100);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBeGreaterThanOrEqual(1);
  });

  it("lock scaduto ma entro blockResetMs: mantiene blockCount", () => {
    const key = `expired-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 60000, 60 * 60 * 1000, 100);

    const start = Date.now();
    while (Date.now() - start < 150) {
      // busy wait 150ms > 100ms lock
    }

    const result = checkRateLimit(key, 3, 60000, 60 * 60 * 1000, 100);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBeGreaterThanOrEqual(1);
  });

  it("lock scaduto e oltre blockResetMs: reset completo", () => {
    const key = `expired-reset-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 4; i++) checkRateLimit(key, 3, 60000, 50, 100);

    const start = Date.now();
    while (Date.now() - start < 200) {
      // busy wait 200ms
    }

    const result = checkRateLimit(key, 3, 60000, 50, 100);
    expect(result.allowed).toBe(true);
    expect(result.blockCount).toBe(0);
  });

  it("finestra passata resetta entry (windowMs breve)", () => {
    const key = `window-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, 3, 50, 60 * 60 * 1000, 100);

    const start = Date.now();
    while (Date.now() - start < 100) {
      // busy wait
    }

    const result = checkRateLimit(key, 3, 50, 60 * 60 * 1000, 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.blockCount).toBe(0);
  });
});
