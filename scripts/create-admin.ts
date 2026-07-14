/**
 * Crea un utente amministratore chiedendo le credenziali a runtime.
 *
 * Perché esiste come script separato dal seed:
 * - Il repository è pubblico su GitHub. Nessun account con permessi di
 *   scrittura reali deve avere email o password scritte in un file
 *   versionato, nemmeno come "esempio da cambiare poi": in pratica quelle
 *   password vengono quasi sempre lasciate invariate.
 * - Questo script non scrive né legge credenziali da nessun file: le
 *   chiede interattivamente al terminale, le valida con le stesse regole
 *   dell'applicazione (vedi src/lib/validation.ts) e le salva già
 *   hashate con bcrypt nel database.
 *
 * Uso:
 *   npm run db:create-admin
 *   (oppure: npx tsx scripts/create-admin.ts)
 *
 * Può essere usato anche per creare un referente territoriale o un
 * volontario: lo script chiede il ruolo e i campi aggiuntivi necessari.
 *
 * Autore: Fabio Tempera (2026)
 */

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { emailSchema, strongPasswordSchema } from "../src/lib/validation";

const prisma = new PrismaClient();

// Cost factor bcrypt: allineato a quello usato in src/lib/auth.ts.
// Usiamo la stessa costante per garantire coerenza tra hash generati
// da questo script e verifiche nel login. Se cambi il cost, cambialo
// anche in src/lib/auth.ts.
const BCRYPT_COST = 12;

async function ask(rl: readline.Interface, domanda: string): Promise<string> {
  const risposta = await rl.question(domanda);
  return risposta.trim();
}

/**
 * Chiede la password senza mostrarla in chiaro nel terminale.
 * Funziona su terminali TTY standard (macOS/Linux/WSL); se lo stdin non è
 * un TTY (es. pipe automatizzata) ricade su una richiesta normale.
 */
async function askPassword(domanda: string): Promise<string> {
  const isTTY = stdin.isTTY;

  if (!isTTY) {
    // Fallback non interattivo (es. pipe/CI): preferiamo la env var
    // ADMIN_PASSWORD se presente (evita leak della password nei log di
    // CI dove stdout viene catturato). Se la env var non è impostata,
    // chiediamo via readline (la password sarà visibile nel terminale,
    // ma questo è il comportamento storico per backward compat).
    if (process.env.ADMIN_PASSWORD && domanda.toLowerCase().includes("password")) {
      return process.env.ADMIN_PASSWORD;
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(domanda);
    rl.close();
    return answer.trim();
  }

  return new Promise((resolve) => {
    stdout.write(domanda);
    let password = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      const code = char.charCodeAt(0);
      if (char === "\n" || char === "\r" || code === 4) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(password.trim());
        return;
      }
      if (code === 3) {
        // Ctrl+C: ripristina il terminale in modalità cooked prima di
        // uscire, altrimenti il terminale resta in raw mode e l'utente
        // deve digitare `stty sane` per ripristinarlo.
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.exit(1);
      }
      if (code === 127 || code === 8) {
        // Backspace
        password = password.slice(0, -1);
        return;
      }
      password += char;
    };

    stdin.on("data", onData);
  });
}

async function main() {
  console.log("=== Creazione utente CieloBuio ===");
  console.log("Le credenziali inserite qui NON vengono salvate in alcun file:");
  console.log("vengono scritte, già cifrate, direttamente nel database.\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const emailInput = await ask(rl, "Email (es. nome.cognome@esempio.it): ");
  const emailParse = emailSchema.safeParse(emailInput);
  if (!emailParse.success) {
    console.error("Email non valida:", emailParse.error.issues[0]?.message);
    process.exit(1);
  }

  const esistente = await prisma.user.findUnique({ where: { email: emailParse.data } });
  if (esistente) {
    console.error(`Esiste già un utente con questa email (ruolo attuale: ${esistente.ruolo}).`);
    process.exit(1);
  }

  const nomeCognome = await ask(rl, "Nome e cognome: ");
  if (!nomeCognome) {
    console.error("Il nome è obbligatorio.");
    process.exit(1);
  }

  const ruoloInput = await ask(
    rl,
    "Ruolo [admin / referente_provinciale / referente_regionale / volontario] (default: admin): "
  );
  const ruolo = ruoloInput || "admin";
  const ruoliValidi = ["admin", "referente_provinciale", "referente_regionale", "volontario"];
  if (!ruoliValidi.includes(ruolo)) {
    console.error(`Ruolo non valido. Valori ammessi: ${ruoliValidi.join(", ")}`);
    process.exit(1);
  }

  let provinciaId: number | null = null;
  let regioneId: number | null = null;
  if (ruolo === "referente_provinciale") {
    const sigla = await ask(rl, "Sigla provincia di competenza (es. BG): ");
    const provincia = await prisma.provincia.findUnique({ where: { sigla: sigla.toUpperCase() } });
    if (!provincia) {
      console.error(`Provincia "${sigla}" non trovata. Creala prima dal pannello di amministrazione.`);
      process.exit(1);
    }
    provinciaId = provincia.id;
  } else if (ruolo === "referente_regionale") {
    // Per i referenti regionali raccogliamo la regione di competenza:
    // senza questa assegnazione, il referente non avrebbe territorio e
    // la logica fail-closed di auth.ts gli impedirebbe di vedere qualsiasi
    // segnalazione.
    const regioneNome = await ask(rl, "Nome regione di competenza (es. LOMBARDIA): ");
    const regione = await prisma.regioneLegge.findUnique({ where: { regione: regioneNome.toUpperCase() } });
    if (!regione) {
      console.error(`Regione "${regioneNome}" non trovata. Creala prima dal pannello di amministrazione.`);
      process.exit(1);
    }
    regioneId = regione.id;
  }

  // Le iniziali protocollo servono solo a chi crea segnalazioni (volontari),
  // ma le raccogliamo per tutti per coerenza col modello dati. Validiamo
  // che siano esattamente 2 lettere se inserite.
  let inizialiProtocollo = "";
  while (true) {
    const input = (await ask(rl, "Iniziali per il numero di protocollo (2 lettere, es. AB - invio per saltare): "))
      .toUpperCase()
      .slice(0, 2);
    if (!input) {
      // Vuoto: ok, salta
      break;
    }
    if (input.length === 2 && /^[A-Z]{2}$/.test(input)) {
      inizialiProtocollo = input;
      break;
    }
    console.log("Le iniziali devono essere esattamente 2 lettere. Riprova o premi invio per saltare.");
  }

  rl.close();

  let password = "";
  while (true) {
    password = await askPassword(
      "Password (min. 12 caratteri, maiuscola, minuscola, numero, carattere speciale): "
    );
    const parse = strongPasswordSchema.safeParse(password);
    if (parse.success) break;
    console.log("Password non valida:", parse.error.issues[0]?.message ?? "requisiti non soddisfatti");
  }

  const conferma = await askPassword("Conferma password: ");
  if (conferma !== password) {
    console.error("\nLe due password non coincidono. Riesegui lo script.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const user = await prisma.user.create({
    data: {
      email: emailParse.data,
      nomeCognome,
      passwordHash,
      ruolo,
      provinciaId,
      regioneId,
      inizialiProtocollo: inizialiProtocollo || null,
    },
  });

  console.log(`\nUtente creato: ${user.email} (ruolo: ${user.ruolo}, id: ${user.id})`);
  console.log("Puoi ora accedere con queste credenziali dalla schermata di login.");
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error("Errore:", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();
}

run();
