/**
 * Validazione della forma della sessione demo letta da sessionStorage.
 * Un valore manomesso (campo mancante o di tipo errato) deve essere rifiutato,
 * mentre una sessione con tutti i campi corretti deve essere accettata.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getActiveDemoSession } from "@/lib/demo-mode";
import { ruoloSchema } from "@/lib/validation";

const SESSIONE_VALIDA = {
  id: "demo-1",
  email: "demo@cielobuio.it",
  nomeCognome: "Demo Admin",
  ruolo: "admin",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "DA",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
  isDemo: true,
};

function impostaStorage(valore: string | null) {
  Object.defineProperty(global, "sessionStorage", {
    value: {
      getItem: () => valore,
      setItem: () => {},
      removeItem: () => {},
    },
    writable: true,
    configurable: true,
  });
}

describe("getActiveDemoSession - validazione della forma", () => {
  const originaleStorage = global.sessionStorage;

  beforeEach(() => {
    impostaStorage(null);
  });

  afterEach(() => {
    Object.defineProperty(global, "sessionStorage", {
      value: originaleStorage,
      writable: true,
      configurable: true,
    });
  });

  it("accetta una sessione demo con tutti i campi validi", () => {
    impostaStorage(JSON.stringify(SESSIONE_VALIDA));
    expect(getActiveDemoSession()).toMatchObject({ id: "demo-1", ruolo: "admin", isDemo: true });
  });

  it("accetta valori non nulli per i campi opzionali di tipo stringa e numero", () => {
    impostaStorage(
      JSON.stringify({
        ...SESSIONE_VALIDA,
        ruolo: "referente_provinciale",
        provinciaId: 4,
        regioneId: 2,
        pec: "pec@associazione.it",
        emailOrdinaria: "info@associazione.it",
        indirizzo: "Via Roma 1",
        firma: "Firma",
      }),
    );
    expect(getActiveDemoSession()).not.toBeNull();
  });

  it("accetta ogni ruolo previsto da ruoloSchema, compreso referente_regionale", () => {
    for (const ruolo of ruoloSchema.options) {
      impostaStorage(JSON.stringify({ ...SESSIONE_VALIDA, ruolo }));
      expect(getActiveDemoSession()?.ruolo).toBe(ruolo);
    }
  });

  it("rifiuta JSON che non è un oggetto (null, numero, stringa)", () => {
    for (const valore of ["null", "42", '"testo"']) {
      impostaStorage(valore);
      expect(getActiveDemoSession()).toBeNull();
    }
  });

  // Ogni riga corrisponde a un campo con tipo o valore non ammesso.
  const campiNonValidi: Array<[string, unknown]> = [
    ["id numerico", 123],
    ["email non stringa", 1],
    ["nomeCognome mancante", undefined],
    ["ruolo sconosciuto", "superuser"],
    ["provinciaId stringa", "4"],
    ["regioneId stringa", "2"],
    ["inizialiProtocollo numerico", 5],
    ["pec numerica", 5],
    ["emailOrdinaria numerica", 5],
    ["indirizzo numerico", 5],
    ["firma numerica", 5],
  ];

  for (const [descrizione, valore] of campiNonValidi) {
    it(`rifiuta una sessione con ${descrizione}`, () => {
      const chiave = descrizione.split(" ")[0];
      const oggetto: Record<string, unknown> = { ...SESSIONE_VALIDA, [chiave]: valore };
      if (valore === undefined) delete oggetto[chiave];
      impostaStorage(JSON.stringify(oggetto));
      expect(getActiveDemoSession()).toBeNull();
    });
  }
});
