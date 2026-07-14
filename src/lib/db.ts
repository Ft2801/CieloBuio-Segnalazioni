import { PrismaClient, Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'

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

// Operazioni di lettura: idempotenti per natura, possono essere ritentate
// in sicurezza sulle stesse condizioni di errore delle scritture.
const READ_OPERATIONS = new Set(['findUnique', 'findMany', 'findFirst', 'count', 'aggregate', 'groupBy']);

const baseClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient

// Codici di errore Prisma che indicano problemi transitori di
// connessione o conflitti di concorrenza ritentabili:
// - P2024: connection pool timeout (tutti i connection slot occupati)
// - P2034: serialization failure / deadlock (MVCC conflict)
// - P1017: server has closed the connection unexpectedly
// - P1001: can't reach database server (network blip)
// - P1002: database server is still starting up
// - P1008: operations timed out
// - P1011: error writing to socket (connection unstable)
const RETRYABLE_CODES = new Set([
  'P2024',
  'P2034',
  'P1017',
  'P1001',
  'P1002',
  'P1008',
  'P1011',
])

/**
 * Estende il client Prisma con retry automatico sulle scritture e sulle
 * letture per gestire conflitti di concorrenza PostgreSQL e transient
 * connection errors: P2024 (connection timeout), P2034 (transaction
 * conflict/deadlock), P1017 (server closed connection), P1001/P1002/
 * P1008/P1011 (network/transient).
 *
 * PostgreSQL supporta concorrenza multi-writer con MVCC, ma sotto
 * elevato carico concorrente possono verificarsi serialization failures
 * e deadlock. L'estensione ritenta con backoff esponenziale jitterato
 * (100ms, 200ms, 400ms, 800ms, 1600ms + jitter random full-range) prima
 * di arrendersi.
 *
 * Nota architetturale: il retry è sicuro per le operazioni attualmente
 * usate nel progetto perché quasi tutte usano updateMany con clausola
 * WHERE atomica sullo stato (idempotente per costruzione). Le letture
 * sono idempotenti per natura. Se in futuro si aggiungono operazioni
 * non idempotenti (es. incrementi non condizionati, create senza
 * unique constraint), valutare l'impatto del retry automatico su
 * tali operazioni.
 */
export const db = baseClient.$extends({
  query: {
    $allOperations: async ({ operation, args, query }) => {
      const isRetryable = WRITE_OPERATIONS.has(operation) || READ_OPERATIONS.has(operation)
      if (!isRetryable) {
        return query(args)
      }
      const maxRetries = 5
      const baseDelayMs = 100
      let lastError: Prisma.PrismaClientKnownRequestError | Error | unknown
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await query(args)
        } catch (e) {
          lastError = e
          const shouldRetry =
            e instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(e.code)
          if (shouldRetry && attempt < maxRetries - 1) {
            // Full jitter: jitter distribuito sull'intero range del delay,
            // non solo sui primi 50 ms. Riduce thundering herd in caso di
            // many concurrent retries.
            const delay = Math.random() * (baseDelayMs * Math.pow(2, attempt))
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
          throw e
        }
      }
      // Tentativi esauriti: logga ed esci con l'ultimo errore.
      logger.error({ err: lastError, operation }, 'Prisma retry esaurito senza successo')
      throw lastError
    },
  },
})
