/**
 * Tema chiaro/scuro dell'interfaccia.
 * La scelta esplicita dell'utente è salvata in localStorage. Senza scelta il
 * tema segue la preferenza del sistema operativo (prefers-color-scheme).
 * SCRIPT_TEMA_INIZIALE applica il tema prima del primo rendering: replica la
 * logica di leggiTemaSalvato ed è generato dalle stesse costanti.
 */

export const CHIAVE_TEMA = "cielobuio-tema";
const CLASSE_TEMA_SCURO = "dark";
const MEDIA_SCHEMA_SCURO = "(prefers-color-scheme: dark)";
const EVENTO_TEMA = "cielobuio-tema-cambiato";

type Tema = "chiaro" | "scuro";

/**
 * Script inline inserito nel <head> con il nonce CSP della richiesta. Esegue
 * in modo sincrono, prima del primo rendering, così la pagina non appare
 * nel tema sbagliato. Il sorgente è costante: non contiene dati dell'utente.
 */
export const SCRIPT_TEMA_INIZIALE =
  "(function(){" +
  "try{" +
  "var s=null;" +
  `try{s=window.localStorage.getItem(${JSON.stringify(CHIAVE_TEMA)});}catch(e){s=null;}` +
  `var scuro=s===${JSON.stringify("scuro")}||(s!==${JSON.stringify("chiaro")}&&window.matchMedia(${JSON.stringify(MEDIA_SCHEMA_SCURO)}).matches);` +
  `document.documentElement.classList.toggle(${JSON.stringify(CLASSE_TEMA_SCURO)},scuro);` +
  "}catch(e){}" +
  "})();";

export function leggiTemaSalvato(): Tema | null {
  try {
    const valore = window.localStorage.getItem(CHIAVE_TEMA);
    return valore === "chiaro" || valore === "scuro" ? valore : null;
  } catch {
    // Archiviazione non disponibile (es. blocco dei cookie): nessuna scelta salvata.
    return null;
  }
}

export function salvaTema(tema: Tema): void {
  try {
    window.localStorage.setItem(CHIAVE_TEMA, tema);
  } catch {
    // Preferenza non persistita: il tema resta attivo per la sessione corrente.
  }
}

export function applicaTema(tema: Tema): void {
  document.documentElement.classList.toggle(CLASSE_TEMA_SCURO, tema === "scuro");
  window.dispatchEvent(new Event(EVENTO_TEMA));
}

export function temaCorrenteScuro(): boolean {
  return document.documentElement.classList.contains(CLASSE_TEMA_SCURO);
}

/**
 * Sottoscrizione per useSyncExternalStore: notifica i cambi di tema, sia
 * quelli dell'utente sia quelli del sistema operativo (solo se non c'è una
 * scelta salvata). Restituisce la funzione di annullamento.
 */
export function ascoltaTema(notifica: () => void): () => void {
  const media = window.matchMedia(MEDIA_SCHEMA_SCURO);
  const alCambioSistema = () => {
    if (leggiTemaSalvato() === null) {
      applicaTema(media.matches ? "scuro" : "chiaro");
    }
  };
  window.addEventListener(EVENTO_TEMA, notifica);
  media.addEventListener("change", alCambioSistema);
  return () => {
    window.removeEventListener(EVENTO_TEMA, notifica);
    media.removeEventListener("change", alCambioSistema);
  };
}
