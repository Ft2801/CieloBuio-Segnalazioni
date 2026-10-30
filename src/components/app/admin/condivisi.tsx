/**
 * Parti condivise dalle schede di amministrazione: chiamate API, dialogo di conferma e tipi.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/** Messaggio unico per gli errori senza dettaglio dal server. */
export const ERRORE_GENERICO = "Operazione non riuscita. Riprova tra qualche istante.";
// Errore di connessione (rete assente o interrotta) durante una chiamata API.
export const ERRORE_CONNESSIONE = {
  title: "Connessione non riuscita",
  description: "Verifica la connessione e riprova.",
  variant: "destructive",
} as const;
type ToastFn = ReturnType<typeof useToast>["toast"];

// Esegue una chiamata API. In caso di errore di rete mostra un avviso e restituisce null.
export async function chiamaApi(toast: ToastFn, url: string, init?: RequestInit): Promise<Response | null> {
  try {
    // Le GET restano fetch(url) senza secondo argomento.
    return await (init ? fetch(url, init) : fetch(url));
  } catch {
    toast(ERRORE_CONNESSIONE);
    return null;
  }
}

/** Soglia oltre la quale la verifica di un comune è considerata scaduta (circa 6 mesi). */
export const SEI_MESI_MS = 6 * 30 * 24 * 60 * 60 * 1000;

/**
 * Dialog di conferma per le eliminazioni (sostituisce confirm() del browser,
 * che non è personalizzabile né accessibile). Restituisce il nodo da montare
 * e la funzione per richiedere la conferma.
 */
export function useConferma() {
  const [richiesta, setRichiesta] = useState<{ testo: string; azione: () => void } | null>(null);
  const dialog = (
    <Dialog open={richiesta !== null} onOpenChange={(aperto) => !aperto && setRichiesta(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confermi l&apos;eliminazione?</DialogTitle>
          <DialogDescription>{richiesta?.testo}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRichiesta(null)}>
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const azione = richiesta?.azione;
              setRichiesta(null);
              azione?.();
            }}
          >
            Elimina
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return {
    dialog,
    chiedi: (testo: string, azione: () => void) => setRichiesta({ testo, azione }),
  };
}

export type Regione = {
  id: number;
  regione: string;
  riferimentoLegge: string;
  titoloLegge: string;
  testoProgettoIlluminotecnico: string;
  testoDeroghe: string;
  testoDatiFotometrici: string;
  testoApprovazione: string;
  testoInstallazione: string;
  testoControllo: string;
  testoSanzioni: string;
  pecArpaRegionale: string;
  _count?: { province: number; segnalazioni: number };
};

export type Provincia = {
  id: number;
  sigla: string;
  nome: string;
  regioneId: number;
  pecArpaProvinciale: string | null;
  regione: { regione: string };
  _count?: { comuni: number; segnalazioni: number };
};

export type Comune = {
  id: number;
  nome: string;
  cap: string;
  pecComune: string;
  nomeSindaco: string | null;
  noteAggiornamento: string | null;
  provinciaId: number;
  provincia: { sigla: string; nome: string; regione: { regione: string } };
};

export type Utente = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: string;
  provinciaId: number | null;
  regioneId: number | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  inizialiProtocollo: string | null;
  attivo: boolean;
  provincia?: { sigla: string; nome: string } | null;
  regione?: { regione: string } | null;
};

/** Errori di validazione di un modulo, indicizzati per id del controllo. */
export type ErroriCampi = Record<string, string>;

/**
 * Errori di un modulo di amministrazione. Restano visibili finché il modulo non cambia:
 * ogni modifica crea un nuovo oggetto e l'errore precedente non viene più mostrato.
 */
export function useErroriModulo<T extends object>(modulo: T) {
  const [segnalati, setSegnalati] = useState<{ modulo: T; campi: ErroriCampi } | null>(null);
  const errori: ErroriCampi = segnalati && segnalati.modulo === modulo ? segnalati.campi : {};

  /** Mostra gli errori e porta il focus al primo campo. Restituisce false se non ci sono errori. */
  function segnala(campi: ErroriCampi): boolean {
    const primo = Object.keys(campi)[0];
    if (primo === undefined) return false;
    setSegnalati({ modulo, campi });
    document.getElementById(primo)?.focus();
    return true;
  }
  return { errori, segnala };
}

/** Messaggio di errore collegato al controllo tramite l'id (aria-describedby). */
export function ErroreCampo({ id, errori }: { id: string; errori: ErroriCampi }) {
  const messaggio = errori[id];
  if (!messaggio) return null;
  return (
    <p id={`errore-${id}`} className="mt-1 text-sm text-rose-700 dark:text-rose-300">
      {messaggio}
    </p>
  );
}

/** Attributi ARIA di un controllo con errore; vuoti se il campo è valido. */
export function attributiErrore(
  id: string,
  errori: ErroriCampi,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return errori[id] ? { "aria-invalid": true, "aria-describedby": `errore-${id}` } : {};
}
