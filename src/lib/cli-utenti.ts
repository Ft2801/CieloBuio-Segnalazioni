/**
 * Procedura interattiva di creazione di un utente (usata da db:create-admin).
 * Riceve input, output e database come dipendenze, così è verificabile
 * senza terminale né database reali.
 */
import type { PrismaClient } from "@prisma/client";
import { emailSchema, strongPasswordSchema } from "./validation";
import { timingSafeEqualStrings } from "./confronto-sicuro";

const RUOLI_VALIDI = ["admin", "referente_provinciale", "referente_regionale", "volontario"] as const;

/** Costo bcrypt: deve restare allineato a quello usato in src/lib/auth.ts. */
const BCRYPT_COST = 12;

/** Numero massimo di inserimenti della password prima di annullare l'operazione. */
export const MAX_TENTATIVI_PASSWORD = 5;

export type IoCreazione = {
  chiedi: (domanda: string) => Promise<string>;
  chiediPassword: (domanda: string) => Promise<string>;
  scrivi: (messaggio: string) => void;
  errore: (messaggio: string) => void;
};

type DipendenzeCreazione = {
  prisma: Pick<PrismaClient, "user" | "provincia" | "regioneLegge">;
  hash: (password: string, costo: number) => Promise<string>;
};

function fallisci(io: IoCreazione, messaggio: string): number {
  io.errore(messaggio);
  return 1;
}

/**
 * Crea un utente. Restituisce il codice di uscita: 0 in caso di successo, 1 in
 * caso di dato non valido o operazione annullata.
 */
export async function creaUtente(io: IoCreazione, dip: DipendenzeCreazione): Promise<number> {
  io.scrivi("=== Creazione utente CieloBuio ===");
  io.scrivi("Le credenziali inserite qui NON vengono salvate in alcun file:");
  io.scrivi("la password viene scritta nel database solo come hash bcrypt.\n");

  const emailParse = emailSchema.safeParse(await io.chiedi("Email (es. nome.cognome@esempio.it): "));
  if (!emailParse.success) {
    return fallisci(io, `Email non valida: ${emailParse.error.issues[0]?.message}`);
  }
  const email = emailParse.data;

  const esistente = await dip.prisma.user.findUnique({ where: { email } });
  if (esistente) {
    return fallisci(io, `Esiste già un utente con questa email (ruolo attuale: ${esistente.ruolo}).`);
  }

  const nomeCognome = await io.chiedi("Nome e cognome: ");
  if (!nomeCognome) return fallisci(io, "Il nome è obbligatorio.");

  const ruoloInput = await io.chiedi(
    `Ruolo [${RUOLI_VALIDI.slice(0, 3).join(" / ")} / ${RUOLI_VALIDI[3]}] (default: admin): `,
  );
  const ruolo = ruoloInput || "admin";
  if (!(RUOLI_VALIDI as readonly string[]).includes(ruolo)) {
    return fallisci(io, `Ruolo non valido. Valori ammessi: ${RUOLI_VALIDI.join(", ")}`);
  }

  // Il referente provinciale è legato a una provincia, quello regionale a una
  // regione: senza questa assegnazione auth.ts (fail-closed) non gli mostra nulla.
  let provinciaId: number | null = null;
  let regioneId: number | null = null;
  if (ruolo === "referente_provinciale") {
    const sigla = await io.chiedi("Sigla provincia di competenza (es. BG): ");
    const provincia = await dip.prisma.provincia.findUnique({
      where: { sigla: sigla.toUpperCase() },
    });
    if (!provincia) {
      return fallisci(io, `Provincia "${sigla}" non trovata. Creala prima dal pannello di amministrazione.`);
    }
    provinciaId = provincia.id;
  } else if (ruolo === "referente_regionale") {
    const nomeRegione = await io.chiedi("Nome regione di competenza (es. LOMBARDIA): ");
    const regione = await dip.prisma.regioneLegge.findUnique({
      where: { regione: nomeRegione.toUpperCase() },
    });
    if (!regione) {
      return fallisci(io, `Regione "${nomeRegione}" non trovata. Creala prima dal pannello di amministrazione.`);
    }
    regioneId = regione.id;
  }

  // Le iniziali servono ai volontari per il numero di protocollo; le raccogliamo
  // per tutti per coerenza col modello dati. Se inserite, devono essere due lettere.
  let inizialiProtocollo = "";
  for (;;) {
    const input = (await io.chiedi("Iniziali per il numero di protocollo (2 lettere, es. AB - invio per saltare): "))
      .trim()
      .toUpperCase();
    if (!input) break;
    if (/^[A-Z]{2}$/.test(input)) {
      inizialiProtocollo = input;
      break;
    }
    io.scrivi("Le iniziali devono essere esattamente 2 lettere. Riprova o premi invio per saltare.");
  }

  let password: string | null = null;
  for (let tentativo = 1; tentativo <= MAX_TENTATIVI_PASSWORD; tentativo++) {
    const candidata = await io.chiediPassword(
      "Password (min. 12 caratteri, maiuscola, minuscola, numero, carattere speciale): ",
    );
    const parse = strongPasswordSchema.safeParse(candidata);
    if (parse.success) {
      password = candidata;
      break;
    }
    io.scrivi(`Password non valida: ${parse.error.issues[0]?.message}`);
  }
  if (!password) {
    return fallisci(io, `Password non valida dopo ${MAX_TENTATIVI_PASSWORD} tentativi. Operazione annullata.`);
  }

  const conferma = await io.chiediPassword("Conferma password: ");
  if (!timingSafeEqualStrings(conferma, password)) {
    return fallisci(io, "\nLe due password non coincidono. Riesegui lo script.");
  }

  const passwordHash = await dip.hash(password, BCRYPT_COST);
  const user = await dip.prisma.user.create({
    data: {
      email,
      nomeCognome,
      passwordHash,
      ruolo,
      provinciaId,
      regioneId,
      inizialiProtocollo: inizialiProtocollo || null,
    },
  });

  io.scrivi(`\nUtente creato: ${user.email} (ruolo: ${user.ruolo}, id: ${user.id})`);
  io.scrivi("Puoi ora accedere con queste credenziali dalla schermata di login.");
  return 0;
}
