import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// In produzione logghiamo solo gli errori; in sviluppo logghiamo anche
// le query per debug. Evita leak di PII nei log di produzione.
const logConfig: ('query' | 'error' | 'warn' | 'info')[] =
  process.env.NODE_ENV === 'production'
    ? ['error', 'warn']
    : ['query', 'error', 'warn']

// Operazioni di scrittura che possono incontrare conflitti di
// concorrenza (deadlock, serialization failure, connection timeout).
const WRITE_OPERATIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

const baseClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient

/**
 * Estende il client Prisma con retry automatico sulle scritture per
 * gestire conflitti di concorrenza PostgreSQL: P2024 (connection
 * timeout), P2034 (transaction conflict/deadlock), P4014 (connection
 * closed unexpectedly).
 *
 * PostgreSQL supporta concorrenza multi-writer con MVCC, ma sotto
 * elevato carico concorrente possono verificarsi serialization failures
 * e deadlock. L'estensione ritenta con backoff esponenziale jitterato
 * (100ms, 200ms, 400ms, 800ms, 1600ms + jitter random) prima di arrendersi.
 *
 * Nota architetturale: il retry è sicuro per le operazioni attualmente
 * usate nel progetto perché quasi tutte usano updateMany con clausola
 * WHERE atomica sullo stato (idempotente per costruzione). Se in futuro
 * si aggiungono operazioni non idempotenti (es. incrementi non
 * condizionati, create senza unique constraint), valutare l'impatto
 * del retry automatico su tali operazioni.
 */
export const db = baseClient.$extends({
  query: {
    $allOperations: async ({ operation, args, query }) => {
      if (!WRITE_OPERATIONS.has(operation)) {
        return query(args);
      }
      const maxRetries = 5;
      const baseDelayMs = 100;
      let lastError: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await query(args);
        } catch (e) {
          lastError = e;
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            (e.code === "P2024" || e.code === "P2034" || e.code === "P4014")
          ) {
            const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 50;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw e;
        }
      }
      throw lastError;
    },
  },
});
