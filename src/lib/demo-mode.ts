/**
 * Modalità demo, interamente client-side e di sola visualizzazione.
 *
 * Perché esiste:
 * - Il repository è pubblico. Non deve contenere pulsanti che pre-compilano
 *   credenziali reali di accesso: chiunque legga il bundle JS vedrebbe email
 *   e password vere.
 * - Servono comunque account dimostrativi per mostrare l'interfaccia dei
 *   tre ruoli (volontario, referente, admin) senza dover installare un
 *   database, e idealmente anche a server spento (per demo statiche,
 *   presentazioni, GitHub Pages, ecc.).
 *
 * Come funziona:
 * - Le credenziali qui sotto NON corrispondono a nessun utente reale nel
 *   database: sono valori fissi noti solo a chi legge questo file o la
 *   documentazione (SETUP.md). Vanno scritte a mano nel form di login,
 *   non sono suggerite da nessun pulsante nell'interfaccia.
 * - Il controllo avviene interamente nel browser, PRIMA di contattare il
 *   server (vedi use-session.ts): se le credenziali corrispondono a un
 *   account demo, non parte nessuna richiesta di rete. Funziona quindi
 *   anche se il backend/database è spento.
 * - L'utente demo restituito ha ruolo reale (volontario / referente / admin)
 *   così l'interfaccia mostra le sezioni corrette, ma OGNI chiamata alle
 *   API che modificano dati viene bloccata lato client con un messaggio
 *   esplicativo, prima ancora di provare a raggiungere il server: non è
 *   una sessione autenticata reale, quindi il server la rifiuterebbe
 *   comunque, ma bloccarla prima evita richieste di rete inutili e rende
 *   il comportamento identico anche offline.
 * - I dati mostrati (segnalazioni di esempio) sono statici, incorporati
 *   nel bundle: non provengono dal database.
 *
 * Sicurezza: queste credenziali non danno accesso a nulla di reale. Non
 * esiste alcun utente reale con queste email nel database di produzione
 * (il dominio "demo.cielobuio-segnalazioni.local" è fittizio, usato solo
 * per questo scopo): usarle per un login reale fallirebbe comunque, dato
 * che il server non le riconoscerebbe come credenziali valide.
 */

import type { RuoloUtente } from "@/lib/types";

/**
 * La modalità demo è attiva solo nella build statica per GitHub Pages
 * (next.config.pages.ts imposta NEXT_PUBLIC_CIELOBUIO_DEMO=1). Nel sistema
 * reale gli account demo non vengono riconosciuti: la schermata di login non
 * mostra dati fittizi a chi usa il sito di produzione.
 */
export const DEMO_ABILITATA: boolean = process.env.NEXT_PUBLIC_CIELOBUIO_DEMO === "1";

export type DemoRole = RuoloUtente;

type DemoAccount = {
  email: string;
  password: string;
  ruolo: DemoRole;
  nomeCognome: string;
};

// Credenziali fisse della modalità demo. Cambiarle qui e in SETUP.md se
// necessario: non sono lette da variabili d'ambiente perché non devono
// mai avere effetto sul database reale, in nessun ambiente.
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "volontario@demo.cielobuio-segnalazioni.local",
    password: "SoloLettura-Volontario!1",
    ruolo: "volontario",
    nomeCognome: "Giulia Ferri",
  },
  {
    email: "referente@demo.cielobuio-segnalazioni.local",
    password: "SoloLettura-Referente!1",
    ruolo: "referente_provinciale",
    nomeCognome: "Luca Bianchi",
  },
  {
    email: "admin@demo.cielobuio-segnalazioni.local",
    password: "SoloLettura-Admin!1",
    ruolo: "admin",
    nomeCognome: "Anna Conti",
  },
];

export type DemoSessionUser = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: DemoRole;
  provinciaId: number | null;
  regioneId: number | null;
  inizialiProtocollo: string | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  firma: string | null;
  /** Marcatore che identifica una sessione demo (mai presente su un utente reale). */
  isDemo: true;
};

const DEMO_STORAGE_KEY = "cb_demo_session";

/**
 * Verifica se email+password corrispondono a un account demo.
 * Confronto diretto in chiaro: non è una vera autenticazione, è solo un
 * lucchetto contro l'attivazione accidentale (bisogna scrivere a mano
 * l'indirizzo e la password esatti, non c'è modo di scoprirli cliccando).
 */
export function matchDemoAccount(email: string, password: string): DemoAccount | null {
  if (!DEMO_ABILITATA) return null;
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === normalized && a.password === password) ?? null;
}

function demoAccountToSessionUser(account: DemoAccount): DemoSessionUser {
  return {
    id: `demo-${account.ruolo}`,
    email: account.email,
    nomeCognome: account.nomeCognome,
    ruolo: account.ruolo,
    // provinciaId/regioneId null: coerente col modello dati reale. Un
    // referente demo senza territorio non vede segnalazioni reali (la
    // logica fail-closed di auth.ts lo garantisce), il che è esattamente
    // il comportamento voluto per la demo (sola visualizzazione di dati
    // statici).
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "DM",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    isDemo: true,
  };
}

/**
 * Attiva una sessione demo salvandola in sessionStorage (solo per la
 * scheda/sessione del browser corrente, mai persistita lato server).
 */
export function activateDemoSession(account: DemoAccount): DemoSessionUser {
  const sessionUser = demoAccountToSessionUser(account);
  try {
    sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(sessionUser));
  } catch {
    // sessionStorage non disponibile (rarissimo): la sessione demo resta
    // comunque valida per il resto del ciclo di vita della pagina tramite
    // lo stato React, solo non sopravvive a un refresh.
  }
  return sessionUser;
}

export function getActiveDemoSession(): DemoSessionUser | null {
  if (!DEMO_ABILITATA) return null;
  try {
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Validazione difensiva della shape: un valore manomesso in sessionStorage
    // (es. dev tools, estensione browser) potrebbe avere isDemo=true ma
    // campi mancanti o di tipo sbagliato, causando crash nei componenti
    // downstream che leggono ruolo/provinciaId/ecc. Verifichiamo tutti i
    // campi obbligatori prima di accettare la sessione.
    if (typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).isDemo === true) {
      const obj = parsed as Record<string, unknown>;
      const ruolo = obj.ruolo;
      if (
        typeof obj.id === "string" &&
        typeof obj.email === "string" &&
        typeof obj.nomeCognome === "string" &&
        (ruolo === "volontario" ||
          ruolo === "referente_provinciale" ||
          ruolo === "referente_regionale" ||
          ruolo === "admin") &&
        (obj.provinciaId === null || typeof obj.provinciaId === "number") &&
        (obj.regioneId === null || typeof obj.regioneId === "number") &&
        (obj.inizialiProtocollo === null || typeof obj.inizialiProtocollo === "string") &&
        (obj.pec === null || typeof obj.pec === "string") &&
        (obj.emailOrdinaria === null || typeof obj.emailOrdinaria === "string") &&
        (obj.indirizzo === null || typeof obj.indirizzo === "string") &&
        (obj.firma === null || typeof obj.firma === "string")
      ) {
        return {
          id: obj.id,
          email: obj.email,
          nomeCognome: obj.nomeCognome,
          ruolo: ruolo,
          provinciaId: obj.provinciaId as number | null,
          regioneId: obj.regioneId as number | null,
          inizialiProtocollo: obj.inizialiProtocollo as string | null,
          pec: obj.pec as string | null,
          emailOrdinaria: obj.emailOrdinaria as string | null,
          indirizzo: obj.indirizzo as string | null,
          firma: obj.firma as string | null,
          isDemo: true,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDemoSession(): void {
  try {
    sessionStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Nessuna azione possibile, non è bloccante.
  }
}

/**
 * Messaggio mostrato quando un utente demo prova un'azione che modifica
 * dati (crea, approva, invia PEC, elimina, ecc.). Bloccare qui, prima di
 * contattare il server, mantiene il comportamento identico sia online sia
 * a server spento.
 */
export const DEMO_READONLY_MESSAGE =
  "Operazione non disponibile per questo account: non è consentito creare, modificare o inviare dati.";

/**
 * Riconosce se un oggetto sessione (SessionUser reale o DemoSessionUser)
 * appartiene alla modalità demo. Accetta `unknown` di proposito così può
 * essere chiamato con qualunque forma di "user" senza dover importare il
 * tipo union in ogni componente.
 */
export function isDemoSession(user: unknown): boolean {
  return !!user && typeof user === "object" && "isDemo" in user && (user as { isDemo?: unknown }).isDemo === true;
}

/**
 * Guardia da chiamare all'inizio di ogni funzione che esegue un'azione
 * mutativa (creare, salvare, approvare, rifiutare, inviare PEC, caricare
 * o eliminare allegati, cambiare stato, gestire configurazione...).
 *
 * Se l'utente corrente è un account demo, lancia subito un errore con il
 * messaggio da mostrare nel toast, SENZA fare alcuna richiesta di rete.
 * Questo è il meccanismo che garantisce che gli account dimostrativi
 * restino di sola visualizzazione anche quando il server è spento o
 * irraggiungibile: il blocco avviene interamente nel browser.
 *
 * Uso tipico in un componente:
 *   guardDemoReadOnly(user); // lancia se demo, altrimenti non fa nulla
 *   const res = await fetch(...);
 */
export function guardDemoReadOnly(user: unknown): void {
  if (isDemoSession(user)) {
    throw new Error(DEMO_READONLY_MESSAGE);
  }
}
