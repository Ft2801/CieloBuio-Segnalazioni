/**
 * Crea un utente da terminale (npm run db:create-admin).
 * La logica è in src/lib/cli-utenti.ts; qui si collegano terminale e database.
 */
import "./load-env";
import * as bcrypt from "bcryptjs";
import { stdin, stdout } from "node:process";
import { createPrismaClient } from "../src/lib/prisma-client";
import { chiediPassword, creaLettoreRighe } from "../src/lib/cli-io";
import { creaUtente } from "../src/lib/cli-utenti";

export async function eseguiCli(): Promise<number> {
  const prisma = createPrismaClient();
  // Un unico lettore con coda: le righe in pipe non vanno perse tra una domanda e l'altra.
  const lettore = creaLettoreRighe(stdin, stdout);
  const leggiRiga = async (domanda: string) => (await lettore.leggiRiga(domanda)).trim();

  try {
    return await creaUtente(
      {
        chiedi: leggiRiga,
        chiediPassword: async (domanda) => {
          // Con il terminale in modalità raw la riga di readline non deve restare attiva.
          if (stdin.isTTY) lettore.chiudiInterfaccia();
          return chiediPassword({
            domanda,
            input: stdin,
            output: stdout,
            env: process.env,
            leggiRiga: (testo) => lettore.leggiRiga(testo),
          });
        },
        scrivi: (messaggio) => console.log(messaggio),
        errore: (messaggio) => console.error(messaggio),
      },
      { prisma, hash: (password, costo) => bcrypt.hash(password, costo) },
    );
  } catch (e) {
    console.error("Errore:", e instanceof Error ? e.message : e);
    return 1;
  } finally {
    lettore.chiudiInterfaccia();
    await prisma.$disconnect();
  }
}

eseguiCli().then((codice) => {
  process.exitCode = codice;
});
