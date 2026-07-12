/**
 * Rate limiting in-memory con escalation dei blocchi.
 *
 * Politica di blocco (applicata al login):
 * - 3 tentativi falliti consecutivi → blocco temporaneo
 * - 1° blocco: 5 minuti
 * - 2° blocco (entro 1 ora dal primo): 15 minuti
 * - 3° blocco (entro 1 ora dal secondo): 1 ora
 * - 4° blocco e successivi (entro 1 ora dal precedente): 24 ore
 *
 * Per ambienti di produzione con più istanze del server, sostituire con
 * una soluzione basata su Redis. Per CieloBuio con una singola istanza VPS,
 * questo è sufficiente.
 *
 * Autore: Fabio Tempera (2026)
 */

type RateLimitEntry = {
  count: number; // tentativi falliti nella finestra corrente
  firstAttempt: number; // timestamp primo tentativo della finestra
  lockedUntil: number | null; // timestamp sblocco
  blockCount: number; // numero di blocchi nella sessione di blocco
  lastBlock: number; // timestamp ultimo blocco
};

const store = new Map<string, RateLimitEntry>();

// Pulizia periodica delle entry scadute (ogni 15 minuti)
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let lastCleanup = Date.now();

export function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store.entries()) {
    // Rimuovi entry con lock scaduto e nessun tentativo recente
    if (entry.lockedUntil && entry.lockedUntil < now && now - entry.lastBlock > 60 * 60 * 1000) {
      store.delete(key);
    } else if (!entry.lockedUntil && now - entry.firstAttempt > 60 * 60 * 1000) {
      store.delete(key);
    }
  }
}

// Durata dei blocchi in base al numero di blocchi precedenti (escalation)
export function getBlockDuration(blockCount: number): number {
  if (blockCount <= 1) return 5 * 60 * 1000; // 5 minuti
  if (blockCount === 2) return 15 * 60 * 1000; // 15 minuti
  if (blockCount === 3) return 60 * 60 * 1000; // 1 ora
  return 24 * 60 * 60 * 1000; // 24 ore
}

// Tipo discriminato: quando allowed=false, retryAfterSeconds è sempre un
// numero positivo; quando allowed=true, è null. Usiamo una unione
// discriminata da `allowed` per permettere a TypeScript di inferire il
// tipo corretto dopo un check `if (!rl.allowed)`, eliminando la
// necessità di fallback difensivi (`?? 0`) nei chiamanti.
export type RateLimitResult =
  | { allowed: true; remaining: number; retryAfterSeconds: null; blockCount: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number; blockCount: number };

/**
 * Verifica se una chiave è entro i limiti. Politica:
 * - maxAttempts tentativi nella finestra windowMs
 * - al superamento, blocco con escalation basata sul numero di blocchi
 *   precedenti (entro BLOCK_RESET_MS dall'ultimo blocco)
 *
 * @param key chiave univoca (es. "login:1.2.3.4" o "pec:user123")
 * @param maxAttempts numero massimo di tentativi (default 3)
 * @param windowMs finestra di osservazione (default 15 min)
 * @param blockResetMs tempo oltre il quale il contatore blocchi si resetta (default 1 ora)
 * @param lockMs durata del blocco iniziale; viene escalation-basata se omesso
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 3,
  windowMs: number = 15 * 60 * 1000,
  blockResetMs: number = 60 * 60 * 1000,
  lockMs?: number
): RateLimitResult {
  cleanup();
  const now = Date.now();

  let entry = store.get(key);

  // Se bloccato, verifica se il lock è scaduto
  if (entry?.lockedUntil && entry.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      blockCount: entry.blockCount,
    };
  }

  // Se il lock è scaduto, mantieni il blockCount per escalation (se entro blockResetMs)
  if (entry?.lockedUntil && entry.lockedUntil < now) {
    const blockExpired = now - entry.lastBlock > blockResetMs;
    if (blockExpired) {
      // Reset completo: il blocco è troppo vecchio
      store.delete(key);
      entry = undefined;
    } else {
      // Reset del lock ma mantieni blockCount per escalation al prossimo superamento
      entry.lockedUntil = null;
      entry.count = 0;
      entry.firstAttempt = now;
    }
  }

  // Se la finestra è passata, reset
  if (entry && now - entry.firstAttempt > windowMs) {
    entry = undefined;
    store.delete(key);
  }

  if (!entry) {
    entry = {
      count: 0,
      firstAttempt: now,
      lockedUntil: null,
      blockCount: 0,
      lastBlock: 0,
    };
    store.set(key, entry);
  }

  entry.count++;
  const remaining = Math.max(0, maxAttempts - entry.count);

  // checkRateLimit è chiamato PRIMA della verifica credenziali.
  // Con maxAttempts=3 e `>`: l'utente ha 3 tentativi effettivi (count 1, 2, 3
  // sono allowed), e al 4° count=4 > 3 scatta il blocco. Questo corrisponde
  // a "3 tentativi falliti → blocco" come da documentazione.
  if (entry.count > maxAttempts) {
    // Escalation: incrementa blockCount e calcola durata
    entry.blockCount++;
    entry.lastBlock = now;
    const duration = lockMs ?? getBlockDuration(entry.blockCount);
    entry.lockedUntil = now + duration;
    store.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(duration / 1000),
      blockCount: entry.blockCount,
    };
  }

  return {
    allowed: true,
    remaining,
    retryAfterSeconds: null,
    blockCount: entry.blockCount,
  };
}

/**
 * Resetta il rate limit per una chiave (chiamare dopo login riuscito).
 *
 * Resetta count, firstAttempt, lockedUntil. Mantiene blockCount e lastBlock
 * per l'escalation: se l'utente accumula altri blocchi entro blockResetMs,
 * la durata escalation-basata cresce. Se l'entry non esiste, non fa nulla.
 */
export function resetRateLimit(key: string) {
  const entry = store.get(key);
  if (!entry) return;
  entry.count = 0;
  entry.firstAttempt = Date.now();
  entry.lockedUntil = null;
  store.set(key, entry);
}

/**
 * Azzera completamente lo store interno e resetta il timestamp di cleanup.
 * Esposta per i test: permette di partire da uno stato noto in ogni test.
 */
export function __resetRateLimitStoreForTests(): void {
  store.clear();
  lastCleanup = Date.now();
}
