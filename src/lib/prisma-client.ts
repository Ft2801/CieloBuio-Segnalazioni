import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Crea un client Prisma collegato a PostgreSQL tramite l'adapter nativo.
 *
 * Prisma 7 non legge più la URL di connessione dallo schema: il client va
 * costruito con un adapter. Lo stesso helper è usato dall'applicazione
 * (src/lib/db.ts) e dagli script di manutenzione (scripts/*.ts), così la
 * configurazione di connessione è definita in un solo punto.
 */
export function createPrismaClient(options: ConstructorParameters<typeof PrismaClient>[0] = {}): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL non configurata: impostare la variabile d'ambiente prima di avviare il client.");
  }
  return new PrismaClient({
    ...options,
    adapter: new PrismaPg({ connectionString }),
  });
}
