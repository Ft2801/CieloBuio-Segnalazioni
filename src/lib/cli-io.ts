/**
 * Input da terminale per gli script di amministrazione.
 *
 * La password viene letta senza eco quando lo stdin è un terminale (TTY).
 * In assenza di TTY (pipe, CI) si usa la variabile ADMIN_PASSWORD, se presente,
 * oppure una normale riga di input.
 */

import * as readline from "node:readline";

export type FlussoTerminale = {
  isTTY?: boolean;
  setRawMode?: (attiva: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
  setEncoding: (codifica: BufferEncoding) => unknown;
  on: (evento: "data", ascolto: (blocco: string) => void) => unknown;
  removeListener: (evento: "data", ascolto: (blocco: string) => void) => unknown;
};

type Uscita = {
  write: (testo: string) => unknown;
};

/** Sollevata quando l'utente interrompe la lettura con Ctrl+C. */
export class InterruzioneUtente extends Error {
  constructor() {
    super("Operazione annullata dall'utente.");
    this.name = "InterruzioneUtente";
  }
}

/**
 * Legge una riga senza mostrarla. Ogni carattere del blocco ricevuto viene
 * elaborato in ordine, così anche un incollaggio con più caratteri (o con un
 * a capo finale) produce la password corretta.
 */
export function leggiPasswordNascosta(input: FlussoTerminale, output: Uscita, domanda: string): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(domanda);
    let password = "";

    const termina = () => {
      input.setRawMode?.(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const onData = (blocco: string) => {
      for (const carattere of blocco) {
        const codice = carattere.charCodeAt(0);
        if (carattere === "\n" || carattere === "\r" || codice === 4) {
          // Invio o Ctrl+D: conferma la password inserita.
          termina();
          output.write("\n");
          resolve(password);
          return;
        }
        if (codice === 3) {
          // Ctrl+C: il terminale viene ripristinato prima di uscire, altrimenti
          // resterebbe in modalità raw e l'utente dovrebbe usare `stty sane`.
          termina();
          reject(new InterruzioneUtente());
          return;
        }
        if (codice === 127 || codice === 8) {
          // Backspace: rimuove un intero code point, anche fuori dal BMP.
          password = [...password].slice(0, -1).join("");
          continue;
        }
        password += carattere;
      }
    };

    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

/**
 * Richiede una password scegliendo la modalità in base al terminale disponibile.
 */
export async function chiediPassword(opzioni: {
  domanda: string;
  input: FlussoTerminale;
  output: Uscita;
  env: Record<string, string | undefined>;
  leggiRiga: (domanda: string) => Promise<string>;
}): Promise<string> {
  if (opzioni.input.isTTY) {
    return leggiPasswordNascosta(opzioni.input, opzioni.output, opzioni.domanda);
  }
  // Fallback non interattivo: ADMIN_PASSWORD evita che la password compaia
  // nei log di CI, dove lo standard output viene conservato.
  const daAmbiente = opzioni.env.ADMIN_PASSWORD;
  if (daAmbiente && opzioni.domanda.toLowerCase().includes("password")) {
    return daAmbiente;
  }
  return opzioni.leggiRiga(opzioni.domanda);
}

/** Messaggio dell'errore quando l'input termina prima che una domanda riceva risposta. */
export const MESSAGGIO_INPUT_TERMINATO = "Input terminato prima di completare l'operazione.";

/**
 * Lettore di righe per gli script di amministrazione.
 *
 * readline/promises (question) scarta le righe ricevute quando non c'è una
 * domanda in attesa: con input in pipe o con `docker exec -i`, dove tutte le
 * righe arrivano insieme, le risposte successive andrebbero perse e la domanda
 * fallirebbe con "readline was closed". Qui ogni riga viene accodata e restituita
 * in ordine alla domanda successiva. Una sola interfaccia readline è attiva alla
 * volta; chiudiInterfaccia() la chiude senza segnalare la fine dell'input (serve
 * prima della lettura nascosta di una password in TTY).
 */
export function creaLettoreRighe(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
  const righe: string[] = [];
  const attese: Array<(riga: string | null) => void> = [];
  let interfaccia: readline.Interface | null = null;
  let fineInput = false;

  const apri = (): readline.Interface => {
    if (interfaccia) return interfaccia;
    const nuova = readline.createInterface({ input, output });
    nuova.on("line", (riga: string) => {
      const attesa = attese.shift();
      if (attesa) attesa(riga);
      else righe.push(riga);
    });
    nuova.on("close", () => {
      // Chiusura voluta da chiudiInterfaccia(): l'input non è terminato.
      if (interfaccia !== nuova) return;
      interfaccia = null;
      fineInput = true;
      for (const attesa of attese.splice(0)) attesa(null);
    });
    interfaccia = nuova;
    return nuova;
  };

  const chiudiInterfaccia = (): void => {
    const attuale = interfaccia;
    interfaccia = null;
    attuale?.close();
  };

  const leggiRiga = (domanda: string): Promise<string> => {
    if (righe.length > 0) {
      output.write(`${domanda}\n`);
      // La coda non è vuota: lo shift restituisce sempre una riga.
      return Promise.resolve(righe.shift() as string);
    }
    if (fineInput) return Promise.reject(new Error(MESSAGGIO_INPUT_TERMINATO));
    return new Promise<string>((risolvi, rifiuta) => {
      attese.push((riga) => (riga === null ? rifiuta(new Error(MESSAGGIO_INPUT_TERMINATO)) : risolvi(riga)));
      const attiva = apri();
      attiva.setPrompt(domanda);
      attiva.prompt();
    });
  };

  return { leggiRiga, chiudiInterfaccia };
}
