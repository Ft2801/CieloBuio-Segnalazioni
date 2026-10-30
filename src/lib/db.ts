import { Prisma, type PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/lib/prisma-client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// In produzione si registrano solo errori e avvisi; in sviluppo anche le query.
// Evita la fuoriuscita di dati personali nei log di produzione.
const logConfig: ("query" | "error" | "warn" | "info")[] =
  process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query", "error", "warn"];

/**
 * Client base, creato al primo utilizzo. La creazione è pigra: così `next build`
 * può importare le route senza DATABASE_URL, e l'errore di configurazione
 * compare solo quando si esegue una query.
 */
function getBaseClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const client = createPrismaClient({ log: logConfig });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

// Operazioni di scrittura. Un errore di rete (P1001, P1008, P1011, P1017) può
// verificarsi DOPO che il server ha già eseguito la scrittura: ritentare
// create o createMany creerebbe duplicati. Per le scritture si ritenta solo
// quando la query non è stata eseguita:
//  - P2024: timeout del pool di connessioni (la query non è partita)
//  - P2034: conflitto di transazione o deadlock (la scrittura è stata annullata)
const WRITE_OPERATIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const RETRYABLE_WRITE_CODES = new Set(["P2024", "P2034"]);

// Letture: idempotenti, possono essere ritentate anche per errori di rete.
//  - P1001: database non raggiungibile (blip di rete)
//  - P1002: database in fase di avvio
//  - P1008: operazione scaduta
//  - P1011: errore di scrittura sul socket
//  - P1017: connessione chiusa dal server
const READ_OPERATIONS = new Set(["findUnique", "findMany", "findFirst", "count", "aggregate", "groupBy"]);
const RETRYABLE_READ_CODES = new Set(["P2024", "P2034", "P1001", "P1002", "P1008", "P1011", "P1017"]);

const MAX_TENTATIVI = 5;
const DELAY_BASE_MS = 100;

/**
 * Estensione del client con retry automatico su errori transitori.
 *
 * Il backoff è esponenziale con jitter full-range (100, 200, 400, 800 ms,
 * ciascuno moltiplicato per un valore casuale in [0, 1)). La chiamata
 * `$transaction` non viene ritentata: se una transazione interattiva
 * fallisce, Postgres la annulla e l'errore viene propagato al chiamante.
 * Un comando eseguito dentro la transazione che fallisce con un codice
 * ritentabile non può quindi riuscire al secondo tentativo, e il chiamante
 * riceve l'errore della transazione.
 */
function creaClientEsteso() {
  return getBaseClient().$extends({
    query: {
      $allOperations: async ({ operation, args, query }) => {
        const isWrite = WRITE_OPERATIONS.has(operation);
        const isRead = READ_OPERATIONS.has(operation);
        if (!isWrite && !isRead) {
          return query(args);
        }
        const codiciRitentabili = isWrite ? RETRYABLE_WRITE_CODES : RETRYABLE_READ_CODES;
        for (let tentativo = 0; ; tentativo++) {
          try {
            return await query(args);
          } catch (e) {
            const ritentabile = e instanceof Prisma.PrismaClientKnownRequestError && codiciRitentabili.has(e.code);
            if (!ritentabile) throw e;
            if (tentativo >= MAX_TENTATIVI - 1) {
              logger.error({ err: e, operation }, "Prisma retry esaurito senza successo");
              throw e;
            }
            const attesa = Math.random() * DELAY_BASE_MS * Math.pow(2, tentativo);
            await new Promise((r) => setTimeout(r, attesa));
          }
        }
      },
    },
  });
}

type ClienteApplicativo = ReturnType<typeof creaClientEsteso>;

let clienteEsteso: ClienteApplicativo | undefined;

function getClienteEsteso(): ClienteApplicativo {
  clienteEsteso ??= creaClientEsteso();
  return clienteEsteso;
}

/**
 * Client applicativo condiviso. È un proxy che inoltra ogni accesso al client
 * esteso, creato alla prima chiamata. I metodi vengono legati al client per
 * mantenere il corretto `this`.
 */
export const db: ClienteApplicativo = new Proxy({} as ClienteApplicativo, {
  get(_target, prop) {
    const client = getClienteEsteso();
    const valore: unknown = Reflect.get(client, prop, client);
    return typeof valore === "function" ? valore.bind(client) : valore;
  },
});
