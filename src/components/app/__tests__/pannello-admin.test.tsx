/**
 * Test di rendering e interazione per PannelloAdmin.
 *
 * Si coprono: rendering iniziale, banner demo, switch tab, e per ogni tab
 * (regioni, province, comuni, utenti): caricamento dati, stati vuoti, creazione,
 * modifica, eliminazione, validazione, modalità demo, errori di rete, JSON non
 * valido, e rami condizionali specifici (needsCheck per comuni, ruolo/ambito
 * per utenti, select dinamici, uppercasing dei campi, ecc.).
 *
 * Autore: Fabio Tempera (2026)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { formatData } from "@/lib/format";
import userEvent from "@testing-library/user-event";
import type { SessionUser } from "@/lib/types";
import { PannelloAdmin } from "@/components/app/pannello-admin";

// -----------------------------------------------------------------------------
// Polyfill per jsdom: Radix Select/Dialog/Tabs usano hasPointerCapture,
// releasePointerCapture e scrollIntoView che non sono implementati in jsdom.
// Si aggiungono come no-op per evitare TypeError durante i test.
// -----------------------------------------------------------------------------
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// -----------------------------------------------------------------------------
// Mock delle dipendenze esterne
// -----------------------------------------------------------------------------

// Toast mockato: ogni test può ispezionare le chiamate tramite toastSpy.mock.calls.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Demo mode mockato: di default isDemoSession ritorna false e guardDemoReadOnly
// non lancia. I test che devono verificare il ramo demo configurano i mock.
const isDemoMock = vi.fn<(u: unknown) => boolean>(() => false);
const guardDemoMock = vi.fn<(u: unknown) => void>();
vi.mock("@/lib/demo-mode", () => ({
  isDemoSession: (u: unknown) => isDemoMock(u),
  guardDemoReadOnly: (u: unknown) => guardDemoMock(u),
  DEMO_READONLY_MESSAGE: "demo readonly",
}));

// fetch globale: ogni test configura routeFetch o mockResolvedValueOnce.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// -----------------------------------------------------------------------------
// Helper per costruire oggetti di test
// -----------------------------------------------------------------------------

function creaUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "admin@example.it",
    nomeCognome: "Admin Test",
    ruolo: "admin",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "AT",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    ...overrides,
  };
}

// Risposta fetch 200 OK con payload JSON.
function okResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => "",
  } as unknown as Response;
}

// Risposta fetch con errore HTTP (es. 400, 403, 500).
function errorResponse(status: number, error: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error }),
    text: async () => "",
  } as unknown as Response;
}

// Risposta fetch con errore HTTP ma corpo senza il campo `error`.
// Per testare il ramo `data.error ?? "Errore sconosciuto"` quando il server
// non restituisce un messaggio di errore strutturato.
function errorResponseNoMessage(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

// Risposta fetch con json() che lancia (per testare il catch in carica).
function invalidJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("invalid");
    },
    text: async () => "",
  } as unknown as Response;
}

// Configura mockFetch con routing basato su URL-base (senza query string).
// routes: mappa URL-base -> payload. Per URL non mappati ritorna {} vuoto.
function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    if (routes[urlBase]) return okResponse(routes[urlBase]);
    return okResponse({});
  });
}

// Configura mockFetch con routing URL per le GET e una risposta di errore
// per una specifica chiamata mutativa (POST/PUT/PATCH/DELETE). Necessario
// perché i tab province/comuni/utenti fanno più GET in parallelo prima
// della mutazione, e mockResolvedValueOnce non può distinguere per metodo.
function routeFetchWithMutationError(
  getRoutes: Record<string, unknown>,
  mutation: { method: string; url: string; status: number; error: string },
) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    const method = init?.method ?? "GET";
    if (method === mutation.method && urlBase === mutation.url) {
      return errorResponse(mutation.status, mutation.error);
    }
    if (getRoutes[urlBase]) return okResponse(getRoutes[urlBase]);
    return okResponse({});
  });
}

// Come routeFetchWithMutationError ma la risposta di errore non contiene
// il campo `error` nel corpo. Per testare il ramo `?? "Errore sconosciuto"`.
function routeFetchWithMutationErrorNoMessage(
  getRoutes: Record<string, unknown>,
  mutation: { method: string; url: string; status: number },
) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    const method = init?.method ?? "GET";
    if (method === mutation.method && urlBase === mutation.url) {
      return errorResponseNoMessage(mutation.status);
    }
    if (getRoutes[urlBase]) return okResponse(getRoutes[urlBase]);
    return okResponse({});
  });
}

// Risposta di errore HTTP il cui corpo non è JSON: json() lancia e il client
// ricade su `{}`, quindi mostra il messaggio di default.
function nonJsonErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("corpo non JSON");
    },
    text: async () => "errore",
  } as unknown as Response;
}

// Come routeFetchWithMutationErrorNoMessage, ma la risposta di errore non è JSON.
function routeFetchWithMutationErrorNonJson(
  getRoutes: Record<string, unknown>,
  mutation: { method: string; url: string; status: number },
) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    const method = init?.method ?? "GET";
    if (method === mutation.method && urlBase === mutation.url) {
      return nonJsonErrorResponse(mutation.status);
    }
    if (getRoutes[urlBase]) return okResponse(getRoutes[urlBase]);
    return okResponse({});
  });
}

// Routing in cui gli URL indicati restituiscono un corpo non JSON (caricamento).
function routeFetchInvalidJsonFor(urlNonValidi: string[], routes: Record<string, unknown>) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    if (urlNonValidi.includes(urlBase)) return invalidJsonResponse();
    if (routes[urlBase]) return okResponse(routes[urlBase]);
    return okResponse({});
  });
}

// Trova l'input (o textarea) che segue una label nello stesso div genitore.
// La ricerca è limitata al dialog aperto per evitare collisioni con le
// intestazioni delle tabelle (es. "Regione", "CAP", "Ruolo", "Email").
function inputAfterLabel(labelText: string | RegExp): HTMLElement {
  const dialog = screen.getByRole("dialog");
  const label = within(dialog).getByText(labelText);
  const container = label.parentElement;
  if (!container) throw new Error(`Container non trovato per label: ${labelText}`);
  const input = container.querySelector("input, textarea") as HTMLElement | null;
  if (!input) throw new Error(`Input non trovato per label: ${labelText}`);
  return input;
}

// Trova la combobox (Select trigger) che segue una label nello stesso div.
// Anche qui la ricerca è limitata al dialog aperto.
function comboboxAfterLabel(labelText: string | RegExp): HTMLElement {
  const dialog = screen.getByRole("dialog");
  const label = within(dialog).getByText(labelText);
  const container = label.parentElement;
  if (!container) throw new Error(`Container non trovato per label: ${labelText}`);
  const combobox = container.querySelector('[role="combobox"]') as HTMLElement | null;
  if (!combobox) throw new Error(`Combobox non trovata per label: ${labelText}`);
  return combobox;
}

// Trova i pulsanti modifica/elimina nella riga che contiene il testo dato.
function pulsantiRiga(testo: string | RegExp): { edit: HTMLElement; del: HTMLElement } {
  const cell = screen.getByText(testo).closest("tr");
  if (!cell) throw new Error(`Riga non trovata per testo: ${testo}`);
  const btns = within(cell).getAllByRole("button");
  return { edit: btns[0], del: btns[1] };
}

// Data ISO di oggi nel formato YYYY-MM-DD (per noteAggiornamento valida).
function dataOdierna(): string {
  return new Date().toISOString().split("T")[0];
}

/** Lascia completare le promise pendenti prima di un'asserzione negativa o di stato vuoto. */
async function attendiEffetti() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// Testi univoci per verificare che un tab sia attivo (non collidono con i
// trigger delle tab che contengono gli stessi nomi).
const PROVINCE_DESC = "Una provincia appartiene a una regione";
const COMUNI_DESC = /Tabella più importante dopo le regioni/;
const UTENTI_DESC = "Volontari, referenti territoriali e amministratori";

// -----------------------------------------------------------------------------
// Reset comuni prima di ogni test
// -----------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
  toastSpy.mockReset();
  isDemoMock.mockReset();
  isDemoMock.mockReturnValue(false);
  guardDemoMock.mockReset();
  guardDemoMock.mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// PannelloAdmin - componente radice
// -----------------------------------------------------------------------------

describe("PannelloAdmin - rendering iniziale e tab", () => {
  it("mostra il titolo e la descrizione del pannello", async () => {
    routeFetch({});
    render(<PannelloAdmin user={creaUser()} />);
    await act(async () => {});
    expect(screen.getByText("Pannello di amministrazione")).toBeInTheDocument();
    expect(screen.getByText(/Gestione delle tabelle di configurazione/)).toBeInTheDocument();
  });

  it("mostra i quattro trigger delle tab", async () => {
    routeFetch({});
    render(<PannelloAdmin user={creaUser()} />);
    await act(async () => {});
    expect(screen.getByRole("tab", { name: /Regioni/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Province/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Comuni/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Utenti/i })).toBeInTheDocument();
  });

  it("la tab regioni è attiva di default e carica /api/config/regioni", async () => {
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni");
    });
    expect(screen.getByText("Regioni e leggi")).toBeInTheDocument();
  });

  it("in modalità demo non effettua fetch al montaggio", async () => {
    isDemoMock.mockReturnValue(true);
    render(<PannelloAdmin user={creaUser()} />);
    await attendiEffetti();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passa alla tab province e carica province + regioni in parallelo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni"));
    await user.click(screen.getByRole("tab", { name: /Province/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/province");
    });
    expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument();
  });

  it("passa alla tab comuni e carica comuni + province in parallelo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Comuni/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
    });
    expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument();
  });

  it("passa alla tab utenti e carica users + province + regioni in parallelo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/users");
    });
    expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Tab Regioni
// -----------------------------------------------------------------------------

describe("PannelloAdmin - Tab Regioni", () => {
  it("effettua GET /api/config/regioni al montaggio", async () => {
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni");
    });
  });

  it("mostra stato vuoto quando non ci sono regioni", async () => {
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => {
      expect(screen.getByText("Nessuna regione configurata")).toBeInTheDocument();
    });
  });

  it("renderizza le regioni con i relativi count", async () => {
    routeFetch({
      "/api/config/regioni": {
        regioni: [
          {
            id: 1,
            regione: "LOMBARDIA",
            riferimentoLegge: "LR 31/15",
            pecArpaRegionale: "arpa@pec.it",
            _count: { province: 12, segnalazioni: 45 },
          },
        ],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => {
      expect(screen.getByText("LOMBARDIA")).toBeInTheDocument();
    });
    expect(screen.getByText("LR 31/15")).toBeInTheDocument();
    expect(screen.getByText("arpa@pec.it")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("gestisce JSON non valido nella risposta (catch ritorna {})", async () => {
    mockFetch.mockResolvedValueOnce(invalidJsonResponse());
    render(<PannelloAdmin user={creaUser()} />);
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni");
    expect(screen.getByText("Nessuna regione configurata")).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("apre il modal di creazione con il titolo 'Nuova regione'", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    expect(screen.getByText("Nuova regione")).toBeInTheDocument();
  });

  it("apre il modal di modifica con il titolo 'Modifica regione' e precarica i dati", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": {
        regioni: [
          {
            id: 1,
            regione: "LOMBARDIA",
            riferimentoLegge: "LR 31/15",
            pecArpaRegionale: "arpa@pec.it",
            titoloLegge: "Titolo originale",
          },
        ],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("LOMBARDIA")).toBeInTheDocument());
    await user.click(pulsantiRiga("LOMBARDIA").edit);
    expect(screen.getByText("Modifica regione")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("LOMBARDIA")).toHaveValue("LOMBARDIA");
    expect(screen.getByPlaceholderText("arpa.x@pec.regione.it")).toHaveValue("arpa@pec.it");
  });

  it("il pulsante Annulla chiude il modal di creazione", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    expect(screen.getByText("Nuova regione")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annulla/i }));
    await waitFor(() => {
      expect(screen.queryByText("Nuova regione")).not.toBeInTheDocument();
    });
  });

  it("valida che regione e riferimentoLegge siano obbligatori", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci il nome della regione.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci il riferimento di legge.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("LOMBARDIA")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByPlaceholderText("LOMBARDIA")).toHaveAttribute("aria-describedby", "errore-campo-admin-1");
  });

  it("crea una nuova regione con POST e mostra toast di successo", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "lombardia");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 31/15");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Regione creata" }));
    });
    const postCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/regioni" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    // La regione viene convertita in maiuscolo
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.regione).toBe("LOMBARDIA");
  });

  it("modifica una regione esistente con PUT e mostra toast di successo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": {
        regioni: [
          {
            id: 5,
            regione: "LOMBARDIA",
            riferimentoLegge: "LR 31/15",
            pecArpaRegionale: "arpa@pec.it",
          },
        ],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("LOMBARDIA")).toBeInTheDocument());
    await user.click(pulsantiRiga("LOMBARDIA").edit);
    const rifInput = screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015");
    await user.clear(rifInput);
    await user.type(rifInput, "LR 17/00");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Regione aggiornata" }));
    });
    const putCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/regioni/5" && (c[1] as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
  });

  it("mostra toast di errore se la creazione fallisce (HTTP 400)", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      { "/api/config/regioni": { regioni: [] } },
      { method: "POST", url: "/api/config/regioni", status: 400, error: "Regione già esistente" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "LOMBARDIA");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 31/15");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Regione già esistente",
          variant: "destructive",
        }),
      );
    });
  });

  it("elimina una regione dopo conferma con DELETE e mostra toast di successo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": {
        regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Regione eliminata" }));
    });
    const deleteCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/regioni/3" && (c[1] as RequestInit)?.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
  });

  it("non elimina se l'utente annulla la conferma", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": {
        regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("Escape chiude la conferma di eliminazione senza eliminare", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": {
        regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra toast di errore se l'eliminazione fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/regioni": {
          regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR", pecArpaRegionale: "" }],
        },
      },
      { method: "DELETE", url: "/api/config/regioni/3", status: 400, error: "Regioni con province collegate" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Regioni con province collegate",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca il salvataggio con toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    render(<PannelloAdmin user={creaUser()} />);
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "LAZIO");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 1/26");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    const writeCall = mockFetch.mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === "POST" || (c[1] as RequestInit)?.method === "PUT",
    );
    expect(writeCall).toBeUndefined();
  });

  it("in modalità demo non effettua fetch e mostra stato vuoto", async () => {
    isDemoMock.mockReturnValue(true);
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    render(<PannelloAdmin user={creaUser()} />);
    expect(screen.getByText("Nessuna regione configurata")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("gestisce guardDemoReadOnly che lancia un non-Error con messaggio generico", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "VENETO");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 1/26");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("converte la regione in maiuscolo durante la digitazione", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    const input = screen.getByPlaceholderText("LOMBARDIA");
    await user.type(input, "lazio");
    expect(input).toHaveValue("LAZIO");
  });

  it("permette di compilare tutti i campi testuali del form regione", async () => {
    const user = userEvent.setup();
    routeFetch({ "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    // Ogni onChange dei campi del form deve aggiornare lo stato. Si digitano
    // tutti i campi testuali secondari per coprire i relativi handler.
    await user.type(inputAfterLabel("PEC ARPA regionale"), "arpa.x@pec.regione.it");
    await user.type(inputAfterLabel("Titolo esteso della legge"), "Titolo LR 31/15");
    await user.type(inputAfterLabel("Articolo progetto illuminotecnico"), "art. 1");
    await user.type(inputAfterLabel("Articolo deroghe modeste entità"), "art. 2");
    await user.type(inputAfterLabel("Articolo dati fotometrici"), "art. 3");
    await user.type(inputAfterLabel("Articolo approvazione"), "art. 4");
    await user.type(inputAfterLabel("Articolo installazione"), "art. 5");
    await user.type(inputAfterLabel("Articolo controllo Comuni"), "art. 6");
    await user.type(inputAfterLabel("Articolo sanzioni"), "art. 7");
    expect(inputAfterLabel("PEC ARPA regionale")).toHaveValue("arpa.x@pec.regione.it");
    expect(inputAfterLabel("Titolo esteso della legge")).toHaveValue("Titolo LR 31/15");
    expect(inputAfterLabel("Articolo sanzioni")).toHaveValue("art. 7");
  }, 30000);

  it("in modalità demo blocca l'eliminazione regione con toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/regioni": {
        regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("in modalità demo blocca l'eliminazione regione con guardDemoReadOnly non-Error", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/regioni": {
        regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra il messaggio generico se l'eliminazione regione fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/regioni": {
          regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR", pecArpaRegionale: "" }],
        },
      },
      { method: "DELETE", url: "/api/config/regioni/3", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se l'eliminazione regione fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/regioni": {
          regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR", pecArpaRegionale: "" }],
        },
      },
      { method: "DELETE", url: "/api/config/regioni/3", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione regione fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      { "/api/config/regioni": { regioni: [] } },
      { method: "POST", url: "/api/config/regioni", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "LOMBARDIA");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 31/15");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione regione fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      { "/api/config/regioni": { regioni: [] } },
      { method: "POST", url: "/api/config/regioni", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "LOMBARDIA");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 31/15");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Tab Province
// -----------------------------------------------------------------------------

describe("PannelloAdmin - Tab Province", () => {
  function vaiAProvince(user: ReturnType<typeof userEvent.setup>) {
    return user.click(screen.getByRole("tab", { name: /Province/i }));
  }

  it("carica province e regioni in parallelo al passaggio alla tab", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/province");
      expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni");
    });
  });

  it("mostra stato vuoto quando non ci sono province", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => {
      expect(screen.getByText("Nessuna provincia configurata")).toBeInTheDocument();
    });
  });

  it("mostra stato vuoto se il caricamento province restituisce JSON non valido", async () => {
    const user = userEvent.setup();
    routeFetchInvalidJsonFor(["/api/config/province", "/api/config/regioni"], {});
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/province");
    expect(screen.getByText("Nessuna provincia configurata")).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("renderizza le province con nome regione e count comuni", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 1,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "arpa.mi@pec.it",
            regione: { regione: "LOMBARDIA" },
            _count: { comuni: 50, segnalazioni: 10 },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    expect(screen.getByText("MI")).toBeInTheDocument();
    expect(screen.getByText("arpa.mi@pec.it")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("mostra 'n/d' per pecArpaProvinciale null", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 1,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: null,
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => {
      expect(screen.getByText("n/d")).toBeInTheDocument();
    });
  });

  it("apre il modal di creazione provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    expect(screen.getByText("Nuova provincia")).toBeInTheDocument();
  });

  it("apre il modal di modifica precaricando i dati della provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "arpa.mi@pec.it",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").edit);
    expect(screen.getByText("Modifica provincia")).toBeInTheDocument();
    expect(inputAfterLabel("Sigla (2 lettere)")).toHaveValue("MI");
    expect(inputAfterLabel("Nome")).toHaveValue("Milano");
  });

  it("valida che sigla, nome e regioneId siano obbligatori", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci la sigla di due lettere.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci il nome della provincia.")).toBeInTheDocument();
    expect(screen.getByText("Scegli la regione di appartenenza.")).toBeInTheDocument();
  });

  it("crea una provincia con POST selezionando la regione dal Select", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "mi");
    expect(inputAfterLabel("Sigla (2 lettere)")).toHaveValue("MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Provincia creata" }));
    });
  });

  it("modifica una provincia con PUT", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").edit);
    const nomeInput = inputAfterLabel("Nome");
    await user.clear(nomeInput);
    await user.type(nomeInput, "Milano DOP");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Provincia aggiornata" }));
    });
    const putCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/province/2" && (c[1] as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
  });

  it("elimina una provincia dopo conferma", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Provincia eliminata" }));
    });
  });

  it("non elimina la provincia se il dialog di conferma viene annullato", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra toast di errore se la creazione provincia fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
      { method: "POST", url: "/api/config/province", status: 400, error: "Sigla duplicata" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Sigla duplicata",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca il salvataggio provincia", async () => {
    const user = userEvent.setup();
    // isDemoMock resta false cosicché i dati vengano caricati (il Select
    // regione ha bisogno di opzioni per superare la validazione). Si testa
    // invece il blocco tramite guardDemoMock che lancia.
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Azione non disponibile" }));
    });
    const postCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("il pulsante Annulla chiude il modal provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    expect(screen.getByText("Nuova provincia")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annulla/i }));
    await waitFor(() => {
      expect(screen.queryByText("Nuova provincia")).not.toBeInTheDocument();
    });
  });

  it("in modalità demo non effettua fetch quando si passa al tab province", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    render(<PannelloAdmin user={creaUser()} />);
    await user.click(screen.getByRole("tab", { name: /Province/i }));
    await waitFor(() => {
      expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument();
    });
    // carica() di ProvinceTab ritorna subito senza chiamare fetch
    const provinceCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/api/config/province"),
    );
    expect(provinceCall).toBeUndefined();
  });

  it("mostra lo stato vuoto quando il payload di province e regioni è privo dei campi attesi", async () => {
    const user = userEvent.setup();
    // Corpi vuoti: dataProvince.province e dataRegioni.regioni sono undefined
    routeFetch({
      "/api/config/province": {},
      "/api/config/regioni": {},
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => {
      expect(screen.getByText("Nessuna provincia configurata")).toBeInTheDocument();
    });
  });

  it("apre il modal di modifica di una provincia senza PEC ARPA", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: null,
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").edit);
    expect(screen.getByText("Modifica provincia")).toBeInTheDocument();
    expect(inputAfterLabel("PEC ARPA provinciale (opzionale)")).toHaveValue("");
  });

  it("gestisce guardDemoReadOnly che lancia un non-Error in salva provincia", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione provincia fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
      { method: "POST", url: "/api/config/province", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione provincia fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
      { method: "POST", url: "/api/config/province", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "MI");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca l'eliminazione provincia con toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("in modalità demo blocca l'eliminazione provincia con guardDemoReadOnly non-Error", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/province": {
        province: [
          {
            id: 2,
            sigla: "MI",
            nome: "Milano",
            regioneId: 1,
            pecArpaProvinciale: "",
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra il messaggio generico se l'eliminazione provincia fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/province": {
          province: [
            {
              id: 2,
              sigla: "MI",
              nome: "Milano",
              regioneId: 1,
              pecArpaProvinciale: "",
              regione: { regione: "LOMBARDIA" },
            },
          ],
        },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
      { method: "DELETE", url: "/api/config/province/2", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se l'eliminazione provincia fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/province": {
          province: [
            {
              id: 2,
              sigla: "MI",
              nome: "Milano",
              regioneId: 1,
              pecArpaProvinciale: "",
              regione: { regione: "LOMBARDIA" },
            },
          ],
        },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
      { method: "DELETE", url: "/api/config/province/2", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("permette di compilare la PEC ARPA provinciale (opzionale)", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAProvince(user);
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    const input = inputAfterLabel("PEC ARPA provinciale (opzionale)");
    await user.type(input, "arpa.mi@pec.it");
    expect(input).toHaveValue("arpa.mi@pec.it");
  });
});

// -----------------------------------------------------------------------------
// Tab Comuni
// -----------------------------------------------------------------------------

describe("PannelloAdmin - Tab Comuni", () => {
  function vaiAComuni(user: ReturnType<typeof userEvent.setup>) {
    return user.click(screen.getByRole("tab", { name: /Comuni/i }));
  }

  it("carica comuni e province in parallelo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
      expect(mockFetch).toHaveBeenCalledWith("/api/config/province");
    });
  });

  it("mostra stato vuoto quando non ci sono comuni", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Nessun comune configurato")).toBeInTheDocument();
    });
  });

  it("mostra stato vuoto se il caricamento comuni restituisce JSON non valido", async () => {
    const user = userEvent.setup();
    routeFetchInvalidJsonFor(["/api/config/comuni", "/api/config/province"], {});
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
    expect(screen.getByText("Nessun comune configurato")).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("renderizza i comuni con provincia, CAP, PEC e sindaco", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco Roma",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Roma")).toBeInTheDocument();
    });
    expect(screen.getByText("00100")).toBeInTheDocument();
    expect(screen.getByText("roma@pec.it")).toBeInTheDocument();
    expect(screen.getByText("Sindaco Roma")).toBeInTheDocument();
  });

  it("effettua ricerca con query string quando si digita nella search", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByPlaceholderText("Cerca comune...")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("Cerca comune..."), "Rom");
    await waitFor(() => {
      const cercaCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("search=Rom"),
      );
      expect(cercaCall).toBeTruthy();
    });
  });

  it("mostra 'Da verificare' quando il sindaco è mancante", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "ComuneSenzaSindaco",
            cap: "00100",
            pecComune: "pec@comune.it",
            nomeSindaco: null,
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Da verificare")).toBeInTheDocument();
    });
    expect(screen.getByText("n/d")).toBeInTheDocument();
  });

  it("mostra 'Da verificare' quando noteAggiornamento è null", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "ComuneSenzaData",
            cap: "00100",
            pecComune: "pec@comune.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: null,
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Da verificare")).toBeInTheDocument();
    });
  });

  it("mostra 'Da verificare' quando noteAggiornamento non è una data valida", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "ComuneDataInvalida",
            cap: "00100",
            pecComune: "pec@comune.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: "non-una-data",
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Da verificare")).toBeInTheDocument();
    });
  });

  it("mostra 'Da verificare' quando la data è più vecchia di 6 mesi", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "ComuneDataVecchia",
            cap: "00100",
            pecComune: "pec@comune.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: "2020-01-01",
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Da verificare")).toBeInTheDocument();
    });
  });

  it("mostra la data di verifica quando tutto è aggiornato", async () => {
    const user = userEvent.setup();
    const oggi = dataOdierna();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "ComuneAggiornato",
            cap: "00100",
            pecComune: "pec@comune.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: oggi,
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("ComuneAggiornato")).toBeInTheDocument();
    });
    expect(screen.queryByText("Da verificare")).not.toBeInTheDocument();
    expect(screen.getByText(formatData(oggi))).toBeInTheDocument();
  });

  it("apre il modal di creazione comune", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    expect(screen.getByText("Nuovo comune")).toBeInTheDocument();
  });

  it("apre il modal di modifica precaricando i dati del comune", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").edit);
    expect(screen.getByText("Modifica comune")).toBeInTheDocument();
    expect(inputAfterLabel("Nome")).toHaveValue("Roma");
    expect(inputAfterLabel("CAP")).toHaveValue("00100");
    expect(inputAfterLabel("PEC del Comune")).toHaveValue("roma@pec.it");
    expect(inputAfterLabel("Nome del sindaco")).toHaveValue("Sindaco");
  });

  it("valida che nome, provinciaId, cap e pecComune siano obbligatori", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci il nome del comune.")).toBeInTheDocument();
    expect(screen.getByText("Scegli la provincia.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci il CAP.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci la PEC del Comune.")).toBeInTheDocument();
  });

  it("crea un comune con POST selezionando la provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Fiumicino");
    await user.type(inputAfterLabel("CAP"), "00054");
    await user.type(inputAfterLabel("PEC del Comune"), "fiumicino@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Comune creato" }));
    });
  });

  it("modifica un comune con PUT", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 7,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco Vecchio",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").edit);
    const sindacoInput = inputAfterLabel("Nome del sindaco");
    await user.clear(sindacoInput);
    await user.type(sindacoInput, "Sindaco Nuovo");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Comune aggiornato" }));
    });
    const putCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/comuni/7" && (c[1] as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
  });

  it("elimina un comune dopo conferma", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 7,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Comune eliminato" }));
    });
  });

  it("mostra toast di errore se l'eliminazione comune fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/comuni": {
          comuni: [
            {
              id: 7,
              nome: "Roma",
              cap: "00100",
              pecComune: "roma@pec.it",
              nomeSindaco: "Sindaco",
              noteAggiornamento: dataOdierna(),
              provinciaId: 1,
              provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "DELETE", url: "/api/config/comuni/7", status: 400, error: "Comuni con segnalazioni" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Comuni con segnalazioni",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca il salvataggio comune", async () => {
    const user = userEvent.setup();
    // isDemoMock resta false cosicché i dati vengano caricati (il Select
    // provincia ha bisogno di opzioni per superare la validazione). Si testa
    // invece il blocco tramite guardDemoMock che lancia.
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Test");
    await user.type(inputAfterLabel("CAP"), "00100");
    await user.type(inputAfterLabel("PEC del Comune"), "test@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Azione non disponibile" }));
    });
    const postCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("il pulsante Annulla chiude il modal comune", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    expect(screen.getByText("Nuovo comune")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annulla/i }));
    await waitFor(() => {
      expect(screen.queryByText("Nuovo comune")).not.toBeInTheDocument();
    });
  });

  it("in modalità demo non effettua fetch quando si passa al tab comuni", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    render(<PannelloAdmin user={creaUser()} />);
    await user.click(screen.getByRole("tab", { name: /Comuni/i }));
    await waitFor(() => {
      expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument();
    });
    const comuniCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/api/config/comuni"),
    );
    expect(comuniCall).toBeUndefined();
  });

  it("mostra lo stato vuoto quando il payload di comuni e province è privo dei campi attesi", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {},
      "/api/config/province": {},
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => {
      expect(screen.getByText("Nessun comune configurato")).toBeInTheDocument();
    });
  });

  it("apre il modal di modifica di un comune senza sindaco né note", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 1,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: null,
            noteAggiornamento: null,
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").edit);
    expect(screen.getByText("Modifica comune")).toBeInTheDocument();
    expect(inputAfterLabel("Nome del sindaco")).toHaveValue("");
    expect(inputAfterLabel("Data ultima verifica")).toHaveValue("");
  });

  it("gestisce guardDemoReadOnly che lancia un non-Error in salva comune", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Test");
    await user.type(inputAfterLabel("CAP"), "00100");
    await user.type(inputAfterLabel("PEC del Comune"), "test@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione comune fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/comuni": { comuni: [] },
        "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
      },
      { method: "POST", url: "/api/config/comuni", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Test");
    await user.type(inputAfterLabel("CAP"), "00100");
    await user.type(inputAfterLabel("PEC del Comune"), "test@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione comune fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/comuni": { comuni: [] },
        "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
      },
      { method: "POST", url: "/api/config/comuni", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Test");
    await user.type(inputAfterLabel("CAP"), "00100");
    await user.type(inputAfterLabel("PEC del Comune"), "test@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("non elimina il comune se il dialog di conferma viene annullato", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 7,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("in modalità demo blocca l'eliminazione comune con toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 7,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("in modalità demo blocca l'eliminazione comune con guardDemoReadOnly non-Error", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/comuni": {
        comuni: [
          {
            id: 7,
            nome: "Roma",
            cap: "00100",
            pecComune: "roma@pec.it",
            nomeSindaco: "Sindaco",
            noteAggiornamento: dataOdierna(),
            provinciaId: 1,
            provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
          },
        ],
      },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra il messaggio generico se l'eliminazione comune fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/comuni": {
          comuni: [
            {
              id: 7,
              nome: "Roma",
              cap: "00100",
              pecComune: "roma@pec.it",
              nomeSindaco: "Sindaco",
              noteAggiornamento: dataOdierna(),
              provinciaId: 1,
              provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
            },
          ],
        },
        "/api/config/province": { province: [] },
      },
      { method: "DELETE", url: "/api/config/comuni/7", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se l'eliminazione comune fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/comuni": {
          comuni: [
            {
              id: 7,
              nome: "Roma",
              cap: "00100",
              pecComune: "roma@pec.it",
              nomeSindaco: "Sindaco",
              noteAggiornamento: dataOdierna(),
              provinciaId: 1,
              provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
            },
          ],
        },
        "/api/config/province": { province: [] },
      },
      { method: "DELETE", url: "/api/config/comuni/7", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("permette di compilare la data di verifica del comune", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/comuni": { comuni: [] },
      "/api/config/province": { province: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAComuni(user);
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    const input = inputAfterLabel("Data ultima verifica");
    await user.type(input, "2026-01-15");
    expect(input).toHaveValue("2026-01-15");
  });
});

// -----------------------------------------------------------------------------
// Tab Utenti
// -----------------------------------------------------------------------------

describe("PannelloAdmin - Tab Utenti", () => {
  function vaiAUtenti(user: ReturnType<typeof userEvent.setup>) {
    return user.click(screen.getByRole("tab", { name: /Utenti/i }));
  }

  it("carica users, province e regioni in parallelo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/users");
      expect(mockFetch).toHaveBeenCalledWith("/api/config/province");
      expect(mockFetch).toHaveBeenCalledWith("/api/config/regioni");
    });
  });

  it("mostra stato vuoto quando non ci sono utenti", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Nessun utente configurato")).toBeInTheDocument();
    });
  });

  it("renderizza un utente volontario con badge ruolo e ambito 'n/d'", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u1",
            email: "vol@example.it",
            nomeCognome: "Volontario Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "VT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Volontario Test")).toBeInTheDocument();
    });
    expect(screen.getByText("Volontario")).toBeInTheDocument();
    expect(screen.getByText("n/d")).toBeInTheDocument();
    expect(screen.getByText("Attivo")).toBeInTheDocument();
  });

  it("renderizza un referente provinciale con ambito 'Prov. ...'", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u2",
            email: "ref@example.it",
            nomeCognome: "Referente Prov",
            ruolo: "referente_provinciale",
            provinciaId: 1,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RP",
            attivo: true,
            provincia: { sigla: "MI", nome: "Milano" },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "MI", nome: "Milano" }] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Referente Prov")).toBeInTheDocument();
    });
    expect(screen.getByText("Referente provinciale")).toBeInTheDocument();
    expect(screen.getByText("Prov. Milano")).toBeInTheDocument();
  });

  it("renderizza un referente regionale con ambito regione", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u3",
            email: "refr@example.it",
            nomeCognome: "Referente Reg",
            ruolo: "referente_regionale",
            provinciaId: null,
            regioneId: 1,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RR",
            attivo: true,
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Referente Reg")).toBeInTheDocument();
    });
    expect(screen.getByText("Referente regionale")).toBeInTheDocument();
    expect(screen.getByText("LOMBARDIA")).toBeInTheDocument();
  });

  it("renderizza un admin con ambito 'Nazionale'", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u4",
            email: "admin@example.it",
            nomeCognome: "Admin Boss",
            ruolo: "admin",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "AB",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Admin Boss")).toBeInTheDocument();
    });
    expect(screen.getByText("Amministratore")).toBeInTheDocument();
    expect(screen.getByText("Nazionale")).toBeInTheDocument();
  });

  it("mostra badge 'Disattivato' per utente non attivo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u5",
            email: "off@example.it",
            nomeCognome: "Utente Off",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "UO",
            attivo: false,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Utente Off")).toBeInTheDocument();
    });
    expect(screen.getByText("Disattivato")).toBeInTheDocument();
  });

  it("mostra 'n/d' per referente provinciale senza provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u6",
            email: "refnp@example.it",
            nomeCognome: "Ref Senza Prov",
            ruolo: "referente_provinciale",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RS",
            attivo: true,
            provincia: null,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Ref Senza Prov")).toBeInTheDocument();
    });
    expect(screen.getByText("n/d")).toBeInTheDocument();
  });

  it("mostra 'n/d' per referente regionale senza regione", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u7",
            email: "refnr@example.it",
            nomeCognome: "Ref Senza Reg",
            ruolo: "referente_regionale",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RR",
            attivo: true,
            regione: null,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => {
      expect(screen.getByText("Ref Senza Reg")).toBeInTheDocument();
    });
    expect(screen.getByText("n/d")).toBeInTheDocument();
  });

  it("apre il modal di creazione utente", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    expect(screen.getByText("Nuovo utente")).toBeInTheDocument();
  });

  it("apre il modal di modifica precaricando i dati utente", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u1",
            email: "vol@example.it",
            nomeCognome: "Volontario Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: "vol@pec.it",
            emailOrdinaria: "vol@email.it",
            indirizzo: "Via Test 1",
            inizialiProtocollo: "VT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Volontario Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Volontario Test").edit);
    expect(screen.getByText("Modifica utente")).toBeInTheDocument();
    expect(inputAfterLabel("Nome e cognome")).toHaveValue("Volontario Test");
    expect(inputAfterLabel("Email")).toHaveValue("vol@example.it");
    expect(inputAfterLabel("PEC")).toHaveValue("vol@pec.it");
  });

  it("valida che email e nomeCognome siano obbligatori", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci nome e cognome.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci l'email.")).toBeInTheDocument();
  });

  it("valida che la password sia obbligatoria per i nuovi utenti", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Test User");
    await user.type(inputAfterLabel("Email"), "test@example.it");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci una password per il nuovo utente.")).toBeInTheDocument();
  });

  it("crea un utente con POST e mostra toast di successo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Nuovo Utente");
    await user.type(inputAfterLabel("Email"), "nuovo@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente creato" }));
    });
    const postCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
  });

  it("crea un utente con PEC e email ordinaria compilate", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Utente PEC");
    await user.type(inputAfterLabel("Email"), "pec-utente@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.type(inputAfterLabel("PEC"), "utente@pec.example.it");
    await user.type(inputAfterLabel("Email ordinaria"), "ordinaria@example.it");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/config/users" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual(
        expect.objectContaining({ pec: "utente@pec.example.it", emailOrdinaria: "ordinaria@example.it" }),
      );
    });
  });

  it("crea un utente con regione di competenza selezionata", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": {
        regioni: [{ id: 1, regione: "LOMBARDIA", riferimentoLegge: "LR 1/26", pecArpaRegionale: "" }],
      },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Utente Regione");
    await user.type(inputAfterLabel("Email"), "regione-utente@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(comboboxAfterLabel("Ruolo"));
    await user.click(await screen.findByText("Referente regionale"));
    await user.click(comboboxAfterLabel("Regione di competenza"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/config/users" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual(
        expect.objectContaining({ regioneId: 1 }),
      );
    });
  });

  it("modifica un utente con PATCH senza newPassword", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-edit",
            email: "edit@example.it",
            nomeCognome: "Edit Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "ET",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Edit Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Edit Test").edit);
    const nome = inputAfterLabel("Nome e cognome");
    await user.clear(nome);
    await user.type(nome, "Edit Modificato");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
    });
    const patchCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-edit" && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    // Il payload non contiene newPassword perché la password è vuota
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    expect(body.newPassword).toBeUndefined();
    expect(body.nomeCognome).toBe("Edit Modificato");
  });

  it("modifica un utente con PATCH includendo newPassword quando compilata", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-pw",
            email: "pw@example.it",
            nomeCognome: "PW Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "PT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("PW Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("PW Test").edit);
    await user.type(inputAfterLabel("Password"), "NuovaPassword!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
    });
    const patchCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-pw" && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    expect(body.newPassword).toBe("NuovaPassword!1");
  });

  it("mostra toast di errore se la creazione utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/users": { users: [] },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "POST", url: "/api/config/users", status: 400, error: "Email già esistente" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Dup User");
    await user.type(inputAfterLabel("Email"), "dup@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Email già esistente",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra toast di errore se la modifica utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "PATCH", url: "/api/config/users/u-err", status: 403, error: "Non autorizzato" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").edit);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Non autorizzato",
          variant: "destructive",
        }),
      );
    });
  });

  it("elimina un utente dopo conferma", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-del",
            email: "del@example.it",
            nomeCognome: "Del Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "DT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Del Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Del Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente eliminato" }));
    });
    const deleteCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-del" && (c[1] as RequestInit)?.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
  });

  it("non elimina l'utente se il dialog di conferma viene annullato", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-nd",
            email: "nd@example.it",
            nomeCognome: "ND Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "NT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("ND Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("ND Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra toast di errore se l'eliminazione utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationError(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "DELETE", url: "/api/config/users/u-err", status: 400, error: "Non puoi eliminare te stesso" },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Non puoi eliminare te stesso",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca il salvataggio utente", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    render(<PannelloAdmin user={creaUser()} />);
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Demo User");
    await user.type(inputAfterLabel("Email"), "demo@example.it");
    await user.type(inputAfterLabel("Password"), "Password!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Azione non disponibile" }));
    const postCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("il pulsante Annulla chiude il modal utente", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    expect(screen.getByText("Nuovo utente")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annulla/i }));
    await waitFor(() => {
      expect(screen.queryByText("Nuovo utente")).not.toBeInTheDocument();
    });
  });

  it("cambiando ruolo a 'referente_provinciale' mostra il Select provincia", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [{ id: 1, sigla: "MI", nome: "Milano" }] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    // All'apertura il ruolo default e volontario: provincia non visibile
    expect(screen.queryByText("Provincia di competenza")).not.toBeInTheDocument();
    // Cambia ruolo a referente_provinciale
    await user.click(comboboxAfterLabel("Ruolo"));
    await user.click(await screen.findByText("Referente provinciale"));
    // Ora il Select provincia è visibile
    expect(screen.getByText("Provincia di competenza")).toBeInTheDocument();
  });

  it("cambiando ruolo a 'referente_regionale' mostra il Select regione", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    expect(screen.queryByText("Regione di competenza")).not.toBeInTheDocument();
    await user.click(comboboxAfterLabel("Ruolo"));
    await user.click(await screen.findByText("Referente regionale"));
    expect(screen.getByText("Regione di competenza")).toBeInTheDocument();
  });

  it("converte le iniziali protocollo in maiuscolo durante la digitazione", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    const input = inputAfterLabel("Iniziali protocollo (2 lettere)");
    await user.type(input, "ab");
    expect(input).toHaveValue("AB");
  });

  it("crea un referente provinciale con provincia selezionata", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [{ id: 1, sigla: "MI", nome: "Milano" }] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Ref Prov");
    await user.type(inputAfterLabel("Email"), "refp@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(comboboxAfterLabel("Ruolo"));
    await user.click(await screen.findByText("Referente provinciale"));
    await user.click(comboboxAfterLabel("Provincia di competenza"));
    await user.click(await screen.findByText(/Milano/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente creato" }));
    });
    const postCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.ruolo).toBe("referente_provinciale");
    expect(body.provinciaId).toBe(1);
  });

  it("gestisce JSON non valido nel caricamento utenti (catch ritorna {})", async () => {
    const user = userEvent.setup();
    // Le 3 fetch parallele ritornano tutte JSON invalido
    mockFetch.mockResolvedValue(invalidJsonResponse());
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/config/users");
    expect(screen.getByText("Nessun utente configurato")).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("modifica un referente provinciale con provinciaId impostato (PATCH con Number())", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-rp",
            email: "rp@example.it",
            nomeCognome: "Ref Prov Edit",
            ruolo: "referente_provinciale",
            provinciaId: 1,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RP",
            attivo: true,
            provincia: { sigla: "MI", nome: "Milano" },
          },
        ],
      },
      "/api/config/province": { province: [{ id: 1, sigla: "MI", nome: "Milano" }] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Ref Prov Edit")).toBeInTheDocument());
    await user.click(pulsantiRiga("Ref Prov Edit").edit);
    expect(screen.getByText("Modifica utente")).toBeInTheDocument();
    // Il Select provincia deve mostrare il valore precaricato
    expect(comboboxAfterLabel("Provincia di competenza")).toHaveTextContent(/Milano/);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
    });
    const patchCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-rp" && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    // provinciaId convertito in Number (ramo true del ternario)
    expect(body.provinciaId).toBe(1);
    // regioneId resta null perché form.regioneId è vuoto
    expect(body.regioneId).toBeNull();
  });

  it("modifica un referente regionale con regioneId impostato (PATCH con Number())", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-rr",
            email: "rr@example.it",
            nomeCognome: "Ref Reg Edit",
            ruolo: "referente_regionale",
            provinciaId: null,
            regioneId: 1,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "RR",
            attivo: true,
            regione: { regione: "LOMBARDIA" },
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Ref Reg Edit")).toBeInTheDocument());
    await user.click(pulsantiRiga("Ref Reg Edit").edit);
    expect(screen.getByText("Modifica utente")).toBeInTheDocument();
    expect(comboboxAfterLabel("Regione di competenza")).toHaveTextContent(/LOMBARDIA/);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
    });
    const patchCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-rr" && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    // regioneId convertito in Number (ramo true del ternario)
    expect(body.regioneId).toBe(1);
    // provinciaId resta null perché form.provinciaId è vuoto
    expect(body.provinciaId).toBeNull();
  });

  it("modifica un utente senza iniziali di protocollo", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-nip",
            email: "nip@example.it",
            nomeCognome: "No Iniziali",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: null,
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("No Iniziali")).toBeInTheDocument());
    await user.click(pulsantiRiga("No Iniziali").edit);
    expect(screen.getByText("Modifica utente")).toBeInTheDocument();
    // inizialiProtocollo null diventa "" nel form (ramo ?? '')
    expect(inputAfterLabel("Iniziali protocollo (2 lettere)")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
    });
    const patchCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/config/users/u-nip" && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
    // inizialiProtocollo "" diventa null nel payload (ramo false di ||)
    expect(body.inizialiProtocollo).toBeNull();
  });

  it("gestisce guardDemoReadOnly che lancia un non-Error in salva utente", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Test User");
    await user.type(inputAfterLabel("Email"), "test@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la modifica utente (PATCH) fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "PATCH", url: "/api/config/users/u-err", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").edit);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la modifica utente (PATCH) fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "PATCH", url: "/api/config/users/u-err", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").edit);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione utente (POST) fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/users": { users: [] },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "POST", url: "/api/config/users", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Test User");
    await user.type(inputAfterLabel("Email"), "test@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se la creazione utente (POST) fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/users": { users: [] },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "POST", url: "/api/config/users", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Test User");
    await user.type(inputAfterLabel("Email"), "test@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("in modalità demo blocca l'eliminazione utente con toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-del",
            email: "del@example.it",
            nomeCognome: "Del Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "DT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Del Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Del Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("in modalità demo blocca l'eliminazione utente con guardDemoReadOnly non-Error", async () => {
    const user = userEvent.setup();
    guardDemoMock.mockImplementation(() => {
      // Lancia un valore che non è un'istanza di Error
      throw "stringa errore";
    });
    routeFetch({
      "/api/config/users": {
        users: [
          {
            id: "u-del",
            email: "del@example.it",
            nomeCognome: "Del Test",
            ruolo: "volontario",
            provinciaId: null,
            regioneId: null,
            pec: null,
            emailOrdinaria: null,
            indirizzo: null,
            inizialiProtocollo: "DT",
            attivo: true,
          },
        ],
      },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Del Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Del Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
    const deleteCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "DELETE");
    expect(deleteCall).toBeUndefined();
  });

  it("mostra il messaggio generico se l'eliminazione utente fallisce senza messaggio", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNoMessage(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "DELETE", url: "/api/config/users/u-err", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("mostra il messaggio generico se l'eliminazione utente fallisce con risposta non JSON", async () => {
    const user = userEvent.setup();
    routeFetchWithMutationErrorNonJson(
      {
        "/api/config/users": {
          users: [
            {
              id: "u-err",
              email: "err@example.it",
              nomeCognome: "Err Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
      { method: "DELETE", url: "/api/config/users/u-err", status: 500 },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText("Err Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Err Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Operazione non riuscita",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("permette di compilare PEC, email ordinaria e indirizzo dell'utente", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("PEC"), "vol@pec.it");
    await user.type(inputAfterLabel("Email ordinaria"), "vol@email.it");
    await user.type(inputAfterLabel("Indirizzo"), "Via Test 1");
    expect(inputAfterLabel("PEC")).toHaveValue("vol@pec.it");
    expect(inputAfterLabel("Email ordinaria")).toHaveValue("vol@email.it");
    expect(inputAfterLabel("Indirizzo")).toHaveValue("Via Test 1");
  });

  it("permette di selezionare la regione di competenza per referente regionale", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await vaiAUtenti(user);
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    // Cambia ruolo a referente_regionale per mostrare il Select regione
    await user.click(comboboxAfterLabel("Ruolo"));
    await user.click(await screen.findByText("Referente regionale"));
    // Seleziona la regione: onValueChange aggiorna form.regioneId
    await user.click(comboboxAfterLabel("Regione di competenza"));
    await user.click(await screen.findByText("LOMBARDIA"));
    expect(comboboxAfterLabel("Regione di competenza")).toHaveTextContent("LOMBARDIA");
  });
});

describe("PannelloAdmin - interruttore Utente attivo", () => {
  it("il toggle Utente attivo viene inviato con valore false nel POST", async () => {
    const user = userEvent.setup();
    routeFetch({
      "/api/config/users": { users: [] },
      "/api/config/province": { province: [] },
      "/api/config/regioni": { regioni: [] },
    });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.click(screen.getByRole("switch"));
    await user.type(inputAfterLabel("Nome e cognome"), "Utente Disattivo");
    await user.type(inputAfterLabel("Email"), "disattivo@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/config/users" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body)).attivo).toBe(false);
    });
  });
});

// Simula un errore di connessione (fetch rifiutata) solo per la chiamata indicata
// (URL e metodo); le altre chiamate ricevono le risposte previste dalle route.
function routeFetchRete(rifiuta: { url: string; method?: string }, routes: Record<string, unknown>) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const urlBase = url.split("?")[0];
    const method = init?.method ?? "GET";
    if (urlBase === rifiuta.url && method === (rifiuta.method ?? "GET")) {
      throw new TypeError("Failed to fetch");
    }
    if (routes[urlBase]) return okResponse(routes[urlBase]);
    return okResponse({});
  });
}

const TOAST_CONNESSIONE = expect.objectContaining({
  title: "Connessione non riuscita",
  description: "Verifica la connessione e riprova.",
  variant: "destructive",
});

async function attesaToastConnessione() {
  await waitFor(() => {
    expect(toastSpy).toHaveBeenCalledWith(TOAST_CONNESSIONE);
  });
}

describe("PannelloAdmin - errori di connessione", () => {
  it("mostra un avviso di connessione se il caricamento delle regioni fallisce", async () => {
    routeFetchRete({ url: "/api/config/regioni" }, {});
    render(<PannelloAdmin user={creaUser()} />);
    await attesaToastConnessione();
  });

  it("mostra un avviso di connessione se il caricamento delle province fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete({ url: "/api/config/province" }, { "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Province/i }));
    await attesaToastConnessione();
  });

  it("mostra un avviso di connessione se il caricamento dei comuni fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete({ url: "/api/config/comuni" }, { "/api/config/province": { province: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Comuni/i }));
    await attesaToastConnessione();
  });

  it("mostra un avviso di connessione se il caricamento degli utenti fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/users" },
      { "/api/config/province": { province: [] }, "/api/config/regioni": { regioni: [] } },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await attesaToastConnessione();
  });

  it("mostra un avviso di connessione se il salvataggio di una regione fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete({ url: "/api/config/regioni", method: "POST" }, { "/api/config/regioni": { regioni: [] } });
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "lombardia");
    await user.type(screen.getByPlaceholderText("Es. Legge Regionale della Lombardia n.31/2015"), "LR 31/15");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Regione creata" }));
  });

  it("mostra un avviso di connessione se il salvataggio di una provincia fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/province", method: "POST" },
      {
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Province/i }));
    await waitFor(() => expect(screen.getByText(PROVINCE_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuova/i }));
    await user.type(inputAfterLabel("Sigla (2 lettere)"), "mi");
    await user.type(inputAfterLabel("Nome"), "Milano");
    await user.click(comboboxAfterLabel("Regione"));
    await user.click(await screen.findByText("LOMBARDIA"));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Provincia creata" }));
  });

  it("mostra un avviso di connessione se il salvataggio di un comune fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/comuni", method: "POST" },
      {
        "/api/config/comuni": { comuni: [] },
        "/api/config/province": { province: [{ id: 1, sigla: "RM", nome: "Roma" }] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Comuni/i }));
    await waitFor(() => expect(screen.getByText(COMUNI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome"), "Fiumicino");
    await user.type(inputAfterLabel("CAP"), "00054");
    await user.type(inputAfterLabel("PEC del Comune"), "fiumicino@pec.it");
    await user.click(comboboxAfterLabel("Provincia"));
    await user.click(await screen.findByText(/Roma/));
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Comune creato" }));
  });

  it("mostra un avviso di connessione se la creazione di un utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/users", method: "POST" },
      {
        "/api/config/users": { users: [] },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await waitFor(() => expect(screen.getByText(UTENTI_DESC)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Nuovo/i }));
    await user.type(inputAfterLabel("Nome e cognome"), "Nuovo Utente");
    await user.type(inputAfterLabel("Email"), "nuovo@example.it");
    await user.type(inputAfterLabel("Password"), "PasswordSicura!1");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Utente creato" }));
  });

  it("mostra un avviso di connessione se la modifica di un utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/users/u-edit", method: "PATCH" },
      {
        "/api/config/users": {
          users: [
            {
              id: "u-edit",
              email: "edit@example.it",
              nomeCognome: "Edit Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await waitFor(() => expect(screen.getByText("Edit Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Edit Test").edit);
    const nome = inputAfterLabel("Nome e cognome");
    await user.clear(nome);
    await user.type(nome, "Edit Modificato");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Utente aggiornato" }));
  });

  it("mostra un avviso di connessione se l'eliminazione di una regione fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/regioni/3", method: "DELETE" },
      {
        "/api/config/regioni": {
          regioni: [{ id: 3, regione: "PIEMONTE", riferimentoLegge: "LR 10/20", pecArpaRegionale: "" }],
        },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(screen.getByText("PIEMONTE")).toBeInTheDocument());
    await user.click(pulsantiRiga("PIEMONTE").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Regione eliminata" }));
  });

  it("mostra un avviso di connessione se l'eliminazione di una provincia fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/province/2", method: "DELETE" },
      {
        "/api/config/province": {
          province: [
            {
              id: 2,
              sigla: "MI",
              nome: "Milano",
              regioneId: 1,
              pecArpaProvinciale: "",
              regione: { regione: "LOMBARDIA" },
            },
          ],
        },
        "/api/config/regioni": { regioni: [{ id: 1, regione: "LOMBARDIA" }] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Province/i }));
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(pulsantiRiga("Milano").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Provincia eliminata" }));
  });

  it("mostra un avviso di connessione se l'eliminazione di un comune fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/comuni/7", method: "DELETE" },
      {
        "/api/config/comuni": {
          comuni: [
            {
              id: 7,
              nome: "Roma",
              cap: "00100",
              pecComune: "roma@pec.it",
              nomeSindaco: "Sindaco",
              noteAggiornamento: dataOdierna(),
              provinciaId: 1,
              provincia: { sigla: "RM", nome: "Roma", regione: { regione: "LAZIO" } },
            },
          ],
        },
        "/api/config/province": { province: [] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Comuni/i }));
    await waitFor(() => expect(screen.getByText("Roma")).toBeInTheDocument());
    await user.click(pulsantiRiga("Roma").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Comune eliminato" }));
  });

  it("mostra un avviso di connessione se l'eliminazione di un utente fallisce", async () => {
    const user = userEvent.setup();
    routeFetchRete(
      { url: "/api/config/users/u-edit", method: "DELETE" },
      {
        "/api/config/users": {
          users: [
            {
              id: "u-edit",
              email: "edit@example.it",
              nomeCognome: "Edit Test",
              ruolo: "volontario",
              provinciaId: null,
              regioneId: null,
              pec: null,
              emailOrdinaria: null,
              indirizzo: null,
              inizialiProtocollo: "ET",
              attivo: true,
            },
          ],
        },
        "/api/config/province": { province: [] },
        "/api/config/regioni": { regioni: [] },
      },
    );
    render(<PannelloAdmin user={creaUser()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: /Utenti/i }));
    await waitFor(() => expect(screen.getByText("Edit Test")).toBeInTheDocument());
    await user.click(pulsantiRiga("Edit Test").del);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina" }));
    await attesaToastConnessione();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Utente eliminato" }));
  });
});
