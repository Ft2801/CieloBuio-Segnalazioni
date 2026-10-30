import "dotenv/config";
import { defineConfig } from "prisma/config";

// Configurazione Prisma 7: schema, percorso delle migrazioni e URL di connessione
// usata dalla CLI (migrate deploy, db seed). Il client runtime riceve la URL tramite
// l'adapter PostgreSQL (src/lib/prisma-client.ts).
//
// `prisma generate` non si connette al database e viene eseguito da postinstall
// (npm ci, build Docker): il segnaposto evita che l'installazione fallisca quando
// DATABASE_URL non è ancora definita. Le CLI che si connettono usano sempre la URL reale.
const PLACEHOLDER_URL = "postgresql://non-configurato:non-configurato@localhost:5432/non-configurato";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? PLACEHOLDER_URL,
  },
});
