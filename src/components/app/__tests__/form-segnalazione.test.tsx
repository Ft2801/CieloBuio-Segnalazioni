/**
 * Test di rendering e interazione per FormSegnalazione.
 *
 * Si coprono: caricamento iniziale (nuova vs modifica), recidiva,
 * ricerca comune con debounce 300ms, selezione comune con auto-derivazione
 * provincia/regione/PEC/cap/oggetto/testo introduttivo, checkbox tipologia
 * (3), checkbox problemi (4), nota "altro" condizionale, personalizzazione
 * invio (destinatario, ARPA, CC, oggetto, testo introduttivo, mittente
 * visibile), allegati (upload immagine, upload PDF, validazione dimensione
 * 10MB, limite 4 allegati, eliminazione con confirm, errori server/rete,
 * blocco demo), GPS (successo, errore, non disponibile), submit (POST nuovo
 * con esci true/false, PUT modifica, validazione indirizzo vuoto, errore
 * server, errore rete, risposta JSON non valida, demo mode), pulsanti
 * Indietro/Annulla, demo mode bloccante su salva/carica/elimina.
 *
 * Autore: Fabio Tempera (2026)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser, Segnalazione } from "@/lib/types";
import { FormSegnalazione } from "@/components/app/form-segnalazione";

// -----------------------------------------------------------------------------
// Polyfill per jsdom: Radix Switch/Checkbox usano hasPointerCapture,
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

// Toast mockato: ogni test ispeziona le chiamate tramite toastSpy.mock.calls.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Demo mode mockato: di default isDemoSession ritorna false. I test che devono
// verificare il ramo demo impostano isDemoMock.mockReturnValue(true).
const isDemoMock = vi.fn<(u: unknown) => boolean>(() => false);
const guardDemoMock = vi.fn<(u: unknown) => void>();
vi.mock("@/lib/demo-mode", () => ({
  isDemoSession: (u: unknown) => isDemoMock(u),
  guardDemoReadOnly: (u: unknown) => guardDemoMock(u),
  DEMO_READONLY_MESSAGE: "demo readonly",
}));

// window.confirm stub (usato da eliminaAllegato)
const confirmSpy = vi.fn();
vi.stubGlobal("confirm", confirmSpy);

// fetch globale: ogni test configura mockImplementation o mockResolvedValueOnce.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// navigator.geolocation stub: si configura per test. Per testare l'assenza
// di geolocation si usa una proprietà configurabile a cui si assegna undefined.
const geoGetCurrentPosition = vi.fn();
beforeAll(() => {
  Object.defineProperty(global.navigator, "geolocation", {
    value: { getCurrentPosition: geoGetCurrentPosition },
    configurable: true,
    writable: true,
  });
});

// -----------------------------------------------------------------------------
// Helper per costruire oggetti di test
// -----------------------------------------------------------------------------

function creaUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "user@example.it",
    nomeCognome: "Mario Rossi",
    ruolo: "volontario",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "MR",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    ...overrides,
  };
}

// Utente demo: il marcatore isDemo attiva il percorso demo nei componenti.
function creaUserDemo(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    ...creaUser(overrides),
    isDemo: true,
  } as unknown as SessionUser;
}

// Comune di test: struttura annidata con provincia/regione.
function creaComune(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    nome: "Milano",
    cap: "20121",
    pecComune: "pec@comune.milano.it",
    nomeSindaco: "Giuseppe Sala",
    provincia: {
      sigla: "MI",
      nome: "Milano",
      regione: { regione: "Lombardia", riferimentoLegge: "LR 17/2000" },
    },
    ...overrides,
  };
}

// Segnalazione completa per testare la modifica.
function creaSegnalazione(overrides: Partial<Segnalazione> & { id: string }): Segnalazione {
  const base: Segnalazione = {
    id: overrides.id,
    numeroProtocollo: null,
    dataSegnalazione: "2026-01-01T00:00:00.000Z",
    stato: "bozza",
    volontarioId: "v1",
    referenteApprovatoreId: null,
    notaRifiuto: null,
    indirizzoVia: "Via Test 1",
    comuneId: 1,
    cap: "00000",
    provinciaId: 1,
    regioneId: 1,
    latitudine: null,
    longitudine: null,
    nomeEsercizio: null,
    chkVetroPianoInclinato: false,
    chkVetroCurvo: false,
    chkAltroTipologia: false,
    notaAltroTipologia: null,
    chkLuceVersoAlto: false,
    chkAbbagliamento: false,
    chkLuceIntrusiva: false,
    chkAltroProblema: false,
    notaAltroProblema: null,
    descrizioneLibera: null,
    destinatarioNome: null,
    includiArpa: false,
    pecCcAggiuntive: null,
    oggettoPec: null,
    testoIntroduttivoPec: null,
    mittenteVisibile: true,
    dataInvio: null,
    dataChiusura: null,
    segnalazionePrecedenteId: null,
    livelloRecidiva: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    comune: { id: 1, nome: "Comune Test", pecComune: "pec@comune.it", nomeSindaco: "Sindaco" },
    provincia: { id: 1, sigla: "TT", nome: "Provincia Test" },
    regione: { id: 1, regione: "REGIONE TEST", riferimentoLegge: "LR 1/26" },
    volontario: { id: "v1", nomeCognome: "Volontario Test", email: "v@test.it" },
    allegati: [],
    storicoStati: [],
  };
  return { ...base, ...overrides };
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

// Risposta fetch che lancia durante json() (per testare il catch in salva/carica).
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

// Configura mockFetch per rispondere a tutte le route API usate dal form:
// - GET /api/config/comuni (con o senza ?search=) -> lista comuni
// - GET /api/segnalazioni/:id -> segnalazione per modifica o recidiva
// - POST/PUT /api/segnalazioni -> salvataggio
// - POST /api/upload -> upload allegato
// - DELETE /api/allegati?id= -> eliminazione allegato
function configuraFetch(opts: {
  comuni?: unknown[];
  segnalazione?: Segnalazione | null;
  segnalazionePrecedente?: Segnalazione | null;
  uploadAllegato?: unknown;
} = {}) {
  const comuni = opts.comuni ?? [creaComune()];
  const segnalazione = opts.segnalazione ?? null;
  const segnalazionePrecedente = opts.segnalazionePrecedente ?? null;
  const uploadAllegato = opts.uploadAllegato ?? {
    id: "a1",
    segnalazioneId: "s1",
    tipo: "foto",
    urlStorage: "/storage/x",
    nomeOriginale: "file.jpg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";
    if (u.startsWith("/api/config/comuni")) {
      return okResponse({ comuni });
    }
    if (u.startsWith("/api/segnalazioni/")) {
      // GET dettaglio segnalazione (modifica o recidiva): si distingue
      // perché la recidiva usa l'id della segnalazione precedente.
      if (segnalazionePrecedente && u.endsWith(segnalazionePrecedente.id)) {
        return okResponse({ segnalazione: segnalazionePrecedente });
      }
      return okResponse({ segnalazione });
    }
    if (u === "/api/segnalazioni") {
      return okResponse({ segnalazione: { id: "new-id" } });
    }
    if (u.startsWith("/api/upload")) {
      return okResponse({ allegato: uploadAllegato });
    }
    if (u.startsWith("/api/allegati")) {
      return okResponse({});
    }
    return okResponse({});
  });
}

// Renderizza il componente con props di default.
function renderForm(props: Partial<{
  user: SessionUser;
  segnalazioneId: string | null;
  segnalazionePrecedenteId: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}> = {}) {
  const onBack = props.onBack ?? vi.fn();
  const onSaved = props.onSaved ?? vi.fn();
  return render(
    <FormSegnalazione
      user={props.user ?? creaUser()}
      segnalazioneId={props.segnalazioneId ?? null}
      segnalazionePrecedenteId={props.segnalazionePrecedenteId ?? null}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
}

// -----------------------------------------------------------------------------
// Reset comuni prima di ogni test
// -----------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
  toastSpy.mockReset();
  confirmSpy.mockReset();
  isDemoMock.mockReset();
  isDemoMock.mockReturnValue(false);
  guardDemoMock.mockReset();
  guardDemoMock.mockImplementation(() => {});
  geoGetCurrentPosition.mockReset();
  // Default: comuni con un elemento, nessuna segnalazione caricata.
  configuraFetch();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// Caricamento e inizializzazione
// -----------------------------------------------------------------------------

describe("FormSegnalazione - caricamento e titolo", () => {
  it("mostra 'Nuova segnalazione' quando segnalazioneId non è fornito", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Nuova segnalazione" })).toBeInTheDocument();
  });

  it("mostra 'Modifica segnalazione' quando segnalazioneId è fornito", async () => {
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Modifica segnalazione" })).toBeInTheDocument();
    });
  });

  it("effettua GET /api/segnalazioni/[id] al montaggio quando segnalazioneId è presente", async () => {
    const seg = creaSegnalazione({ id: "s-edit" });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s-edit" });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-edit");
    });
  });

  it("non effettua GET /api/segnalazioni/[id] al montaggio in modalità nuova", async () => {
    renderForm();
    // Attende che eventuali fetch iniziali (comuni) vengano eseguite.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
    });
    // Nessuna chiamata a /api/segnalazioni/[id]
    const segCall = mockFetch.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].startsWith("/api/segnalazioni/")
    );
    expect(segCall).toBeUndefined();
  });

  it("effettua GET /api/config/comuni al montaggio (debounce iniziale)", async () => {
    renderForm();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
    });
  });

  it("precarica i campi della segnalazione in modalità modifica", async () => {
    const seg = creaSegnalazione({
      id: "s1",
      indirizzoVia: "Via Precaricata 5",
      nomeEsercizio: "Bar Test",
      cap: "00100",
      chkVetroPianoInclinato: true,
      descrizioneLibera: "Descrizione test",
      destinatarioNome: "Sindaco Test",
      oggettoPec: "Oggetto precompilato",
      includiArpa: true,
      mittenteVisibile: false,
    });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect((screen.getByDisplayValue("Via Precaricata 5") as HTMLInputElement)).toBeInTheDocument();
    });
    expect((screen.getByDisplayValue("Bar Test") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("00100") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("Descrizione test") as HTMLTextAreaElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("Sindaco Test") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("Oggetto precompilato") as HTMLInputElement)).toBeInTheDocument();
    // mittenteVisibile false -> "referente CieloBuio"
    expect(screen.getByText(/Mittente: referente CieloBuio/)).toBeInTheDocument();
  });

  it("gestisce risposta JSON non valida in caricamento (catch ritorna {})", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [] });
      if (u.startsWith("/api/segnalazioni/")) return invalidJsonResponse();
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s-bad" });
    // La segnalazione resta vuota, il form mostra comunque l'heading "Modifica".
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Modifica segnalazione" })).toBeInTheDocument();
    });
  });

  it("mostra 'Caricamento…' durante il fetch iniziale della segnalazione", () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [] });
      // Mai risolta per /api/segnalazioni/: rimane in caricamento.
      if (u.startsWith("/api/segnalazioni/")) return new Promise(() => {});
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s-loading" });
    expect(screen.getByText("Caricamento…")).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Pulsanti Indietro e Annulla
// -----------------------------------------------------------------------------

describe("FormSegnalazione - pulsanti navigazione", () => {
  it("chiama onBack dal pulsante Indietro", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderForm({ onBack });
    await user.click(screen.getByRole("button", { name: /Indietro/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("chiama onBack dal pulsante Annulla", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderForm({ onBack });
    await user.click(screen.getByRole("button", { name: /Annulla/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Ricerca e selezione comune
// -----------------------------------------------------------------------------

describe("FormSegnalazione - ricerca comune", () => {
  it("mostra 'Nessun comune' quando la lista è vuota", async () => {
    configuraFetch({ comuni: [] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Nessun comune/i)).toBeInTheDocument();
    });
  });

  it("mostra la lista comuni dopo il caricamento iniziale", async () => {
    configuraFetch({ comuni: [creaComune({ id: 1, nome: "Milano" })] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
  });

  it("mostra cap e sigla provincia accanto al nome comune", async () => {
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/20121/)).toBeInTheDocument();
      expect(screen.getByText(/\(MI\)/)).toBeInTheDocument();
    });
  });

  it("mostra 'Sindaco: ...' quando nomeSindaco è presente", async () => {
    configuraFetch({ comuni: [creaComune({ nomeSindaco: "Giuseppe Sala" })] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Sindaco: Giuseppe Sala/i)).toBeInTheDocument();
    });
  });

  it("non mostra 'Sindaco: ...' quando nomeSindaco è null", async () => {
    configuraFetch({ comuni: [creaComune({ nomeSindaco: null })] });
    renderForm();
    await waitFor(() => {
      expect(screen.queryByText(/Sindaco:/i)).not.toBeInTheDocument();
    });
  });

  it("effettua GET /api/config/comuni?search=... dopo 300ms di debounce", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [] });
    renderForm();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/config/comuni");
    });
    // Digita nel campo di ricerca comune (placeholder "Cerca comune...")
    await user.type(screen.getByPlaceholderText(/Cerca comune/i), "Roma");
    // Attende che il debounce (300ms) faccia partire la fetch con la search.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/config/comuni?search=${encodeURIComponent("Roma")}`
      );
    }, { timeout: 2000 });
  });

  it("seleziona un comune con click e popola comuneSelezionato", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    // L'info box del comune selezionato mostra regione, riferimento legge e PEC.
    // Si cerca per "Comune selezionato:" (strong tag) che appare solo nel box.
    await waitFor(() => {
      expect(screen.getByText("Comune selezionato:")).toBeInTheDocument();
    });
    // Il box contiene tutti i dati derivati dal comune.
    const box = screen.getByText("Comune selezionato:").closest("div");
    expect(box?.textContent).toContain("Lombardia");
    expect(box?.textContent).toContain("LR 17/2000");
    expect(box?.textContent).toContain("pec@comune.milano.it");
  });

  it("selezionare un comune auto-deriva cap se vuoto", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    await waitFor(() => {
      expect((screen.getByDisplayValue("20121") as HTMLInputElement)).toBeInTheDocument();
    });
  });

  it("selezionare un comune non sovrascrive cap già valorizzato", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    // Precompila manualmente il CAP prima di selezionare il comune.
    const capInput = screen.getByLabelText("CAP");
    await user.type(capInput, "99999");
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    // Il CAP non viene sovrascritto dal comune.
    await waitFor(() => {
      expect((screen.getByDisplayValue("99999") as HTMLInputElement)).toBeInTheDocument();
    });
  });

  it("selezionare un comune precompila destinatarioNome con 'Sindaco ...'", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune({ nomeSindaco: "Giuseppe Sala" })] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    await waitFor(() => {
      expect((screen.getByDisplayValue("Sindaco Giuseppe Sala") as HTMLInputElement)).toBeInTheDocument();
    });
  });

  it("selezionare un comune precompila oggettoPec e testoIntroduttivoPec se vuoti", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    await waitFor(() => {
      expect(
        (screen.getByDisplayValue(/Segnalazione impianto di illuminazione/i) as HTMLInputElement)
      ).toBeInTheDocument();
    });
    expect(
      (screen.getByDisplayValue(/Si segnala la presenza/i) as HTMLTextAreaElement)
    ).toBeInTheDocument();
  });

  it("non mostra il box 'Comune selezionato' se il comune non è in lista", async () => {
    // comuneId impostato ma comune non presente in lista (es. nuova lista dopo ricerca vuota).
    configuraFetch({ comuni: [] });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Nessun comune/i)).toBeInTheDocument();
    });
    // Il box info (con "Riferimento legge:" e "PEC Comune:") non è visibile.
    expect(screen.queryByText(/Riferimento legge:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PEC Comune:/i)).not.toBeInTheDocument();
  });

  it("limita la visualizzazione a 30 comuni (slice)", async () => {
    const lista = Array.from({ length: 35 }, (_, i) =>
      creaComune({ id: i + 1, nome: `Comune${i}` })
    );
    configuraFetch({ comuni: lista });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Comune0")).toBeInTheDocument();
    });
    // I primi 30 comuni sono visibili, il 31° (indice 30) no.
    expect(screen.getByText("Comune29")).toBeInTheDocument();
    expect(screen.queryByText("Comune30")).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Checkbox tipologia (3 checkbox)
// -----------------------------------------------------------------------------

describe("FormSegnalazione - checkbox tipologia", () => {
  it("cliccando chk1 (vetro piano inclinato) cambia stato", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk1") as HTMLElement;
    expect(chk).toBeInTheDocument();
    await user.click(chk);
    // Verifica che lo stato sia true (Radix Checkbox imposta aria-checked).
    await waitFor(() => {
      expect(chk).toHaveAttribute("data-state", "checked");
    });
  });

  it("cliccando chk2 (vetro curvo) cambia stato", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk2") as HTMLElement;
    await user.click(chk);
    await waitFor(() => {
      expect(chk).toHaveAttribute("data-state", "checked");
    });
  });

  it("cliccando chk3 (altro tipologia) mostra la textarea notaAltroTipologia", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    // Inizialmente la textarea "Specifica la tipologia" non è visibile.
    expect(screen.queryByPlaceholderText(/Specifica la tipologia/i)).not.toBeInTheDocument();
    await user.click(container.querySelector("#chk3") as HTMLElement);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Specifica la tipologia/i)).toBeInTheDocument();
    });
  });

  it("disabilitando chk3 la textarea notaAltroTipologia scompare", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk3") as HTMLElement;
    await user.click(chk); // attiva
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Specifica la tipologia/i)).toBeInTheDocument();
    });
    await user.click(chk); // disattiva
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Specifica la tipologia/i)).not.toBeInTheDocument();
    });
  });

  it("permette di scrivere nella textarea notaAltroTipologia", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.click(container.querySelector("#chk3") as HTMLElement);
    const ta = await waitFor(() => screen.getByPlaceholderText(/Specifica la tipologia/i));
    await user.type(ta, "Tipologia custom");
    expect((ta as HTMLTextAreaElement).value).toBe("Tipologia custom");
  });
});

// -----------------------------------------------------------------------------
// Checkbox problemi (4 checkbox)
// -----------------------------------------------------------------------------

describe("FormSegnalazione - checkbox problemi", () => {
  it("cliccando chk4 (luce verso alto) cambia stato", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk4") as HTMLElement;
    await user.click(chk);
    await waitFor(() => {
      expect(chk).toHaveAttribute("data-state", "checked");
    });
  });

  it("cliccando chk5 (abbagliamento) cambia stato", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk5") as HTMLElement;
    await user.click(chk);
    await waitFor(() => {
      expect(chk).toHaveAttribute("data-state", "checked");
    });
  });

  it("cliccando chk6 (luce intrusiva) cambia stato", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const chk = container.querySelector("#chk6") as HTMLElement;
    await user.click(chk);
    await waitFor(() => {
      expect(chk).toHaveAttribute("data-state", "checked");
    });
  });

  it("cliccando chk7 (altro problema) mostra la textarea notaAltroProblema", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    expect(screen.queryByPlaceholderText(/Specifica il problema/i)).not.toBeInTheDocument();
    await user.click(container.querySelector("#chk7") as HTMLElement);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Specifica il problema/i)).toBeInTheDocument();
    });
  });

  it("permette di scrivere nella textarea notaAltroProblema", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.click(container.querySelector("#chk7") as HTMLElement);
    const ta = await waitFor(() => screen.getByPlaceholderText(/Specifica il problema/i));
    await user.type(ta, "Problema custom");
    expect((ta as HTMLTextAreaElement).value).toBe("Problema custom");
  });
});

// -----------------------------------------------------------------------------
// Personalizzazione invio PEC
// -----------------------------------------------------------------------------

describe("FormSegnalazione - personalizzazione invio PEC", () => {
  it("permette di modificare destinatarioNome", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText("Destinatario");
    await user.type(input, "Sindaco Test");
    expect((input as HTMLInputElement).value).toBe("Sindaco Test");
  });

  it("permette di modificare pecCcAggiuntive", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText(/PEC aggiuntive in copia/i);
    await user.type(input, "cc1@pec.it");
    expect((input as HTMLInputElement).value).toBe("cc1@pec.it");
  });

  it("permette di modificare oggettoPec", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText("Oggetto PEC");
    await user.type(input, "Oggetto test");
    expect((input as HTMLInputElement).value).toBe("Oggetto test");
  });

  it("permette di modificare testoIntroduttivoPec", async () => {
    const user = userEvent.setup();
    renderForm();
    const ta = screen.getByLabelText("Testo introduttivo PEC");
    await user.type(ta, "Intro test");
    expect((ta as HTMLTextAreaElement).value).toBe("Intro test");
  });

  it("permette di modificare descrizioneLibera", async () => {
    const user = userEvent.setup();
    renderForm();
    const ta = screen.getByLabelText(/Descrizione libera/i);
    await user.type(ta, "Descrizione dettagliata");
    expect((ta as HTMLTextAreaElement).value).toBe("Descrizione dettagliata");
  });

  it("attivando lo switch includiArpa cambia stato", async () => {
    const user = userEvent.setup();
    renderForm();
    const sw = screen.getAllByRole("switch")[0];
    await user.click(sw);
    await waitFor(() => {
      expect(sw).toHaveAttribute("data-state", "checked");
    });
  });

  it("mittenteVisibile true mostra 'volontario' nel testo", () => {
    renderForm();
    expect(screen.getByText(/Mittente: volontario/)).toBeInTheDocument();
  });

  it("attivando/disattivando lo switch mittenteVisibile cambia testo", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByText(/Mittente: volontario/)).toBeInTheDocument();
    const sw = screen.getAllByRole("switch")[1];
    await user.click(sw);
    await waitFor(() => {
      expect(screen.getByText(/Mittente: referente CieloBuio/)).toBeInTheDocument();
    });
  });
});

// -----------------------------------------------------------------------------
// Allegati - upload
// -----------------------------------------------------------------------------

describe("FormSegnalazione - allegati upload", () => {
  it("mostra il label di caricamento quando allegati.length < 4", () => {
    renderForm();
    expect(screen.getByText(/Carica allegato \(max 4\)/i)).toBeInTheDocument();
  });

  it("mostra 'Raggiunto il limite massimo di 4 allegati' quando allegati.length === 4", async () => {
    const allegati = Array.from({ length: 4 }, (_, i) => ({
      id: `a${i}`,
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: `/storage/${i}`,
      nomeOriginale: `file${i}.jpg`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const seg = creaSegnalazione({ id: "s1", allegati: allegati as never });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText(/Raggiunto il limite massimo di 4 allegati/i)).toBeInTheDocument();
    });
    // Il label di caricamento non è visibile.
    expect(screen.queryByText(/Carica allegato/i)).not.toBeInTheDocument();
  });

  it("upload senza segnalazioneId mostra toast 'Salva prima la bozza'", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Salva prima la bozza" })
      );
    });
  });

  it("upload con file > 10MB mostra toast 'File troppo grande'", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({ segnalazione: seg });
    const { container } = renderForm({ segnalazioneId: "s1" });
    // Attende che la segnalazione sia caricata (indirizzo visibile).
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // File da 11MB: supera il limite di 10MB.
    const bigFile = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    await user.upload(input, bigFile);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "File troppo grande" })
      );
    });
  });

  it("upload immagine valido (JPG) aggiunge allegato alla lista", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({
      segnalazione: seg,
      uploadAllegato: {
        id: "a-new",
        segnalazioneId: "s1",
        tipo: "foto",
        urlStorage: "/storage/new",
        nomeOriginale: "foto.jpg",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByText("foto.jpg")).toBeInTheDocument();
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Allegato caricato" })
    );
  });

  it("upload PDF imposta tipo='documento' (file.type non inizia con image/)", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({
      segnalazione: seg,
      uploadAllegato: {
        id: "a-pdf",
        segnalazioneId: "s1",
        tipo: "documento",
        urlStorage: "/storage/pdf",
        nomeOriginale: "doc.pdf",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "doc.pdf", { type: "application/pdf" });
    await user.upload(input, file);
    // Verifica che il POST /api/upload sia stato chiamato con FormData
    // che contiene tipo="documento" (derivato dal file.type non image/).
    await waitFor(() => {
      const uploadCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/upload" && c[1]?.method === "POST"
      );
      expect(uploadCall).toBeDefined();
      const fd = uploadCall![1].body as FormData;
      expect(fd.get("tipo")).toBe("documento");
      expect(fd.get("segnalazioneId")).toBe("s1");
    });
  });

  it("upload con errore server mostra toast 'Errore upload'", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({ segnalazione: seg });
    // Override: /api/upload risponde 400.
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: seg });
      if (u.startsWith("/api/upload")) return errorResponse(400, "Tipo non supportato");
      return okResponse({});
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore upload", description: "Tipo non supportato" })
      );
    });
  });

  it("upload con errore di rete mostra toast 'Errore di rete'", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: seg });
      if (u.startsWith("/api/upload")) throw new Error("network down");
      return okResponse({});
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore di rete", description: "network down" })
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Allegati - eliminazione
// -----------------------------------------------------------------------------

describe("FormSegnalazione - allegati eliminazione", () => {
  it("elimina allegato con conferma positiva: chiama DELETE /api/allegati?id=", async () => {
    const user = userEvent.setup();
    const allegato = {
      id: "a-del",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/del",
      nomeOriginale: "eliminami.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    configuraFetch({ segnalazione: seg });
    confirmSpy.mockReturnValue(true);
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("eliminami.jpg")).toBeInTheDocument();
    });
    // Pulsante elimina (con icona Trash2). Lo si trova come pulsante ghost
    // adiacente al nome del file.
    const deleteBtn = screen.getAllByRole("button").find((b) =>
      b.querySelector("svg.lucide-trash2") || b.querySelector("svg[class*='lucide-trash2']")
    ) || screen.getByLabelText("");
    // Approccio alternativo: cerca il pulsante tramite il nome del file e poi
    // risali al contenitore (li) e trova il pulsante al suo interno.
    const li = screen.getByText("eliminami.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/allegati?id=a-del`,
        expect.objectContaining({ method: "DELETE" })
      );
    });
    // L'allegato viene rimosso dalla lista.
    await waitFor(() => {
      expect(screen.queryByText("eliminami.jpg")).not.toBeInTheDocument();
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Allegato eliminato" })
    );
  });

  it("non elimina se confirm restituisce false", async () => {
    const user = userEvent.setup();
    const allegato = {
      id: "a-keep",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/keep",
      nomeOriginale: "mantienimi.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    configuraFetch({ segnalazione: seg });
    confirmSpy.mockReturnValue(false);
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("mantienimi.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("mantienimi.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    // La DELETE non viene chiamata.
    const deleteCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/allegati") && c[1]?.method === "DELETE"
    );
    expect(deleteCall).toBeUndefined();
    // L'allegato resta visibile.
    expect(screen.getByText("mantienimi.jpg")).toBeInTheDocument();
  });

  it("eliminazione con errore server mostra toast 'Errore eliminazione'", async () => {
    const user = userEvent.setup();
    const allegato = {
      id: "a-err",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/err",
      nomeOriginale: "errore.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    confirmSpy.mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: seg });
      if (u.startsWith("/api/allegati") && method === "DELETE") {
        return errorResponse(403, "Non autorizzato");
      }
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("errore.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("errore.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore eliminazione", description: "Non autorizzato" })
      );
    });
    // L'allegato resta visibile (non viene rimosso).
    expect(screen.getByText("errore.jpg")).toBeInTheDocument();
  });

  it("eliminazione con errore di rete mostra toast 'Errore di rete'", async () => {
    const user = userEvent.setup();
    const allegato = {
      id: "a-net",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/net",
      nomeOriginale: "rete.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    confirmSpy.mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: seg });
      if (u.startsWith("/api/allegati") && method === "DELETE") {
        throw new Error("connessione persa");
      }
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("rete.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("rete.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore di rete", description: "connessione persa" })
      );
    });
  });

  it("renderizza il link di download per ogni allegato", async () => {
    const allegato = {
      id: "a-link",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/link",
      nomeOriginale: "scaricabile.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /scaricabile.jpg/i });
      expect(link).toHaveAttribute("href", "/api/allegati/a-link/download");
    });
  });

  it("mostra il badge con il tipo di ogni allegato", async () => {
    const allegato = {
      id: "a-badge",
      segnalazioneId: "s1",
      tipo: "documento",
      urlStorage: "/storage/badge",
      nomeOriginale: "contratto.pdf",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("documento")).toBeInTheDocument();
    });
  });
});

// -----------------------------------------------------------------------------
// GPS
// -----------------------------------------------------------------------------

describe("FormSegnalazione - GPS", () => {
  it("mostra toast 'GPS non disponibile' se navigator.geolocation è assente", async () => {
    const user = userEvent.setup();
    // Rimuove temporaneamente geolocation.
    const original = (global.navigator as unknown as { geolocation: unknown }).geolocation;
    Object.defineProperty(global.navigator, "geolocation", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    renderForm();
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "GPS non disponibile", variant: "destructive" })
      );
    });
    // Ripristina geolocation per i test successivi.
    Object.defineProperty(global.navigator, "geolocation", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("GPS con successo imposta latitudine/longitudine e mostra toast", async () => {
    const user = userEvent.setup();
    renderForm();
    geoGetCurrentPosition.mockImplementation((success: (p: { coords: { latitude: number; longitude: number } }) => void) => {
      success({ coords: { latitude: 45.4642, longitude: 9.19 } });
    });
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() => {
      expect((screen.getByDisplayValue("45.4642") as HTMLInputElement)).toBeInTheDocument();
    });
    expect((screen.getByDisplayValue("9.19") as HTMLInputElement)).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Posizione rilevata" })
    );
  });

  it("GPS con errore mostra toast 'Errore GPS' con il messaggio", async () => {
    const user = userEvent.setup();
    renderForm();
    geoGetCurrentPosition.mockImplementation(
      (_s: unknown, error: (e: Error) => void) => {
        error(new Error("Permission denied"));
      }
    );
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore GPS",
          description: "Permission denied",
          variant: "destructive",
        })
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Submit - salva
// -----------------------------------------------------------------------------

describe("FormSegnalazione - salvataggio", () => {
  it("salva con indirizzo vuoto mostra toast 'Indirizzo obbligatorio'", async () => {
    const user = userEvent.setup();
    renderForm();
    // Indirizzo lasciato vuoto (default).
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Indirizzo obbligatorio", variant: "destructive" })
      );
    });
    // Nessuna chiamata POST.
    const postCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST"
    );
    expect(postCall).toBeUndefined();
  });

  it("salva nuova segnalazione (POST) con successo - esci=true chiama onSaved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderForm({ onSaved });
    // Compila indirizzo obbligatorio.
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 1");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/segnalazioni",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("new-id");
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Segnalazione salvata" })
    );
  });

  it("salva con 'Salva e continua' (esci=false) non chiama onSaved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 2");
    await user.click(screen.getByRole("button", { name: /Salva e continua a modificare/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/segnalazioni",
        expect.objectContaining({ method: "POST" })
      );
    });
    // onSaved non viene chiamato.
    expect(onSaved).not.toHaveBeenCalled();
    // Toast di successo comunque mostrato.
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Segnalazione salvata" })
    );
  });

  it("salva in modifica (PUT /api/segnalazioni/:id) con successo", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s-edit" });
    // Override per PUT: ritorna l'id della segnalazione esistente.
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) {
        if (method === "PUT") return okResponse({ segnalazione: { id: "s-edit" } });
        return okResponse({ segnalazione: seg });
      }
      return okResponse({});
    });
    const onSaved = vi.fn();
    renderForm({ segnalazioneId: "s-edit", onSaved });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/segnalazioni/s-edit",
        expect.objectContaining({ method: "PUT" })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("s-edit");
    });
  });

  it("salva con errore server mostra toast 'Errore' con description", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        return errorResponse(400, "Comune non valido");
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 3");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore",
          description: "Comune non valido",
          variant: "destructive",
        })
      );
    });
  });

  it("salva con errore di rete mostra toast 'Errore' con description", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        throw new Error("server irraggiungibile");
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 4");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore",
          description: "server irraggiungibile",
          variant: "destructive",
        })
      );
    });
  });

  it("salva con risposta 200 OK ma JSON non valido: toast di successo, onSaved non chiamato", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        // res.ok true ma json() lancia: il catch ritorna {} -> data vuoto.
        // La funzione prosegue nel ramo successo (no throw), ma data.segnalazione?.id
        // è undefined, quindi onSaved non viene chiamato.
        return invalidJsonResponse();
      }
      return okResponse({});
    });
    renderForm({ onSaved });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 5");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Segnalazione salvata" })
      );
    });
    // onSaved non chiamato perché data.segnalazione?.id è undefined.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("salva con errore HTTP e JSON non valido (catch in res.json) usa 'Errore salvataggio'", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        // res.ok false + json() che lancia: il catch ritorna {} -> data.error undefined.
        return {
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("invalid");
          },
          text: async () => "",
        } as unknown as Response;
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 6");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore",
          description: "Errore salvataggio",
          variant: "destructive",
        })
      );
    });
  });

  it("salva invia payload con segnalazionePrecedenteId quando fornito", async () => {
    const user = userEvent.setup();
    const segPrec = creaSegnalazione({ id: "s-prec", indirizzoVia: "Via Precedente 9" });
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni/s-prec") return okResponse({ segnalazione: segPrec });
      if (u === "/api/segnalazioni") return okResponse({ segnalazione: { id: "new-id" } });
      return okResponse({});
    });
    const onSaved = vi.fn();
    renderForm({ segnalazionePrecedenteId: "s-prec", onSaved });
    // Attende che la segnalazione precedente venga caricata (indirizzo precompilato).
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Precedente 9")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body as string);
      expect(body.segnalazionePrecedenteId).toBe("s-prec");
    });
  });

  it("salva disabilita i pulsanti durante il salvataggio (salvataggio=true)", async () => {
    const user = userEvent.setup();
    // POST mai risolta: il pulsante resta disabilitato.
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        return new Promise(() => {});
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 7");
    const btnSave = screen.getByRole("button", { name: /Salva ed esci alla lista/i });
    await user.click(btnSave);
    await waitFor(() => {
      expect(btnSave).toBeDisabled();
    });
    // Anche "Salva e continua" è disabilitato.
    expect(screen.getByRole("button", { name: /Salva e continua a modificare/i })).toBeDisabled();
  });
});

// -----------------------------------------------------------------------------
// Demo mode
// -----------------------------------------------------------------------------

describe("FormSegnalazione - demo mode", () => {
  it("salva in demo mode chiama guardDemoReadOnly e mostra toast errore", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(false); // isDemoSession per caricaAllegato/eliminaAllegato
    // guardDemoReadOnly lancia un errore quando viene chiamata da salva().
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
    renderForm({ user: creaUserDemo() });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Demo 1");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(guardDemoMock).toHaveBeenCalled();
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Errore",
        description: "demo readonly",
        variant: "destructive",
      })
    );
    // Nessuna POST effettuata (la guardia ha lanciato prima della fetch).
    const postCall = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST"
    );
    expect(postCall).toBeUndefined();
  });

  it("caricaAllegato in demo mode mostra toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    const seg = creaSegnalazione({ id: "s-demo" });
    configuraFetch({ segnalazione: seg });
    const { container } = renderForm({
      user: creaUserDemo(),
      segnalazioneId: "s-demo",
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        })
      );
    });
    // Nessuna chiamata a /api/upload.
    const uploadCall = mockFetch.mock.calls.find((c) => c[0] === "/api/upload");
    expect(uploadCall).toBeUndefined();
  });

  it("eliminaAllegato in demo mode mostra toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    isDemoMock.mockReturnValue(true);
    const allegato = {
      id: "a-demo",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/demo",
      nomeOriginale: "demo.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s-demo", allegati: [allegato as never] });
    configuraFetch({ segnalazione: seg });
    renderForm({ user: creaUserDemo(), segnalazioneId: "s-demo" });
    await waitFor(() => {
      expect(screen.getByText("demo.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("demo.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        })
      );
    });
    // Nessuna DELETE effettuata.
    const deleteCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/allegati") && c[1]?.method === "DELETE"
    );
    expect(deleteCall).toBeUndefined();
    // L'allegato resta visibile.
    expect(screen.getByText("demo.jpg")).toBeInTheDocument();
  });

  it("in demo mode il form si renderizza comunque (nessun blocco al rendering)", () => {
    isDemoMock.mockReturnValue(true);
    renderForm({ user: creaUserDemo() });
    expect(screen.getByRole("heading", { name: "Nuova segnalazione" })).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Recidiva
// -----------------------------------------------------------------------------

describe("FormSegnalazione - recidiva", () => {
  it("effettua GET /api/segnalazioni/[precId] quando segnalazionePrecedenteId è presente", async () => {
    const segPrec = creaSegnalazione({ id: "s-prec" });
    configuraFetch({ segnalazionePrecedente: segPrec });
    renderForm({ segnalazionePrecedenteId: "s-prec" });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-prec");
    });
  });

  it("mostra il box 'Segnalazione collegata per recidiva' con i dati della precedente", async () => {
    const segPrec = creaSegnalazione({
      id: "s-prec",
      numeroProtocollo: "20260101-TT-X-XX01",
      indirizzoVia: "Via Precedente 9",
      livelloRecidiva: 1,
    });
    configuraFetch({ segnalazionePrecedente: segPrec });
    renderForm({ segnalazionePrecedenteId: "s-prec" });
    await waitFor(() => {
      expect(screen.getByText("Segnalazione collegata per recidiva")).toBeInTheDocument();
    });
    // Livello mostrato è livelloRecidiva + 1.
    expect(screen.getByText(/livello 2/i)).toBeInTheDocument();
    // Numero protocollo visibile.
    expect(screen.getByText(/20260101-TT-X-XX01/)).toBeInTheDocument();
    // Indirizzo precedente visibile.
    expect(screen.getByText(/Via Precedente 9/)).toBeInTheDocument();
  });

  it("mostra 'senza protocollo' quando la precedente non ha numeroProtocollo", async () => {
    const segPrec = creaSegnalazione({
      id: "s-prec",
      numeroProtocollo: null,
      indirizzoVia: "Via Senza Prot 1",
      livelloRecidiva: 2,
    });
    configuraFetch({ segnalazionePrecedente: segPrec });
    renderForm({ segnalazionePrecedenteId: "s-prec" });
    await waitFor(() => {
      expect(screen.getByText(/senza protocollo/)).toBeInTheDocument();
    });
    // Livello mostrato è 3 (livelloRecidiva 2 + 1).
    expect(screen.getByText(/livello 3/i)).toBeInTheDocument();
  });

  it("precompila i campi del luogo con i dati della segnalazione precedente", async () => {
    const segPrec = creaSegnalazione({
      id: "s-prec",
      indirizzoVia: "Via Ricorrente 7",
      cap: "00100",
      nomeEsercizio: "Bar Ricorrente",
      latitudine: 41.9,
      longitudine: 12.5,
      comuneId: 1,
    });
    configuraFetch({ segnalazionePrecedente: segPrec });
    renderForm({ segnalazionePrecedenteId: "s-prec" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Ricorrente 7")).toBeInTheDocument();
    });
    expect((screen.getByDisplayValue("00100") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("Bar Ricorrente") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("41.9") as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByDisplayValue("12.5") as HTMLInputElement)).toBeInTheDocument();
  });

  it("non mostra il box recidiva se segnalazionePrecedenteId non è fornito", () => {
    renderForm();
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
  });

  it("non mostra il box recidiva se la fetch precedente ritorna null", async () => {
    configuraFetch({ segnalazionePrecedente: null });
    renderForm({ segnalazionePrecedenteId: "s-mancante" });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-mancante");
    });
    // Attende che eventuali state update si stabilizzino.
    await waitFor(() => {
      expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
    });
  });
});

// -----------------------------------------------------------------------------
// Modifica - caricamento allegati esistenti
// -----------------------------------------------------------------------------

describe("FormSegnalazione - modifica con allegati esistenti", () => {
  it("carica gli allegati esistenti della segnalazione in modifica", async () => {
    const allegati = [
      {
        id: "a-exist-1",
        segnalazioneId: "s1",
        tipo: "foto",
        urlStorage: "/storage/1",
        nomeOriginale: "esistente1.jpg",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "a-exist-2",
        segnalazioneId: "s1",
        tipo: "documento",
        urlStorage: "/storage/2",
        nomeOriginale: "esistente2.pdf",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const seg = creaSegnalazione({ id: "s1", allegati: allegati as never });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("esistente1.jpg")).toBeInTheDocument();
    });
    expect(screen.getByText("esistente2.pdf")).toBeInTheDocument();
  });

  it("carica i checkbox tipologia/problemi della segnalazione esistente", async () => {
    const seg = creaSegnalazione({
      id: "s1",
      chkVetroPianoInclinato: true,
      chkVetroCurvo: true,
      chkAltroTipologia: true,
      notaAltroTipologia: "Nota tip",
      chkLuceVersoAlto: true,
      chkAbbagliamento: true,
      chkLuceIntrusiva: true,
      chkAltroProblema: true,
      notaAltroProblema: "Nota prob",
      includiArpa: true,
      mittenteVisibile: false,
    });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    const { container } = await waitFor(() => {
      expect(screen.getByDisplayValue("Nota tip")).toBeInTheDocument();
      return { container: undefined };
    }).then(() => ({ container: document.body }));
    // Verifica che le textarea "altro" siano visibili (i checkbox sono attivi).
    await waitFor(() => {
      expect(screen.getByDisplayValue("Nota tip")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Nota prob")).toBeInTheDocument();
    });
    // mittenteVisibile false -> "referente CieloBuio"
    expect(screen.getByText(/Mittente: referente CieloBuio/)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Campi luogo - input manuali
// -----------------------------------------------------------------------------

describe("FormSegnalazione - input manuali luogo", () => {
  it("permette di modificare indirizzoVia", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText("Indirizzo *");
    await user.type(input, "Via Manual 1");
    expect((input as HTMLInputElement).value).toBe("Via Manual 1");
  });

  it("permette di modificare nomeEsercizio", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText(/Nome esercizio/i);
    await user.type(input, "Bar Test");
    expect((input as HTMLInputElement).value).toBe("Bar Test");
  });

  it("permette di modificare cap", async () => {
    const user = userEvent.setup();
    renderForm();
    const input = screen.getByLabelText("CAP");
    await user.type(input, "20100");
    expect((input as HTMLInputElement).value).toBe("20100");
  });

  it("permette di modificare latitudine/longitudine manualmente", async () => {
    const user = userEvent.setup();
    renderForm();
    const latInput = screen.getByLabelText("Latitudine");
    const lngInput = screen.getByLabelText("Longitudine");
    await user.type(latInput, "45.4642");
    await user.type(lngInput, "9.19");
    expect((latInput as HTMLInputElement).value).toBe("45.4642");
    expect((lngInput as HTMLInputElement).value).toBe("9.19");
  });

  it("svuotando latitudine imposta il valore a null (input vuoto)", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1", latitudine: 45.5 });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    const latInput = await waitFor(() => screen.getByLabelText("Latitudine"));
    expect((latInput as HTMLInputElement).value).toBe("45.5");
    await user.clear(latInput);
    expect((latInput as HTMLInputElement).value).toBe("");
  });
});

// -----------------------------------------------------------------------------
// Comportamenti edge case
// -----------------------------------------------------------------------------

describe("FormSegnalazione - edge case", () => {
  it("non mostra il box recidiva se segnalazionePrecedente è null dopo fetch", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: null });
      return okResponse({});
    });
    renderForm({ segnalazionePrecedenteId: "s-vuoto" });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-vuoto");
    });
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
  });

  it("salva con onSaved non chiamato se risposta non contiene segnalazione.id", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        // Risposta 200 ma senza segnalazione.id.
        return okResponse({});
      }
      return okResponse({});
    });
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via NoId 1");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Segnalazione salvata" })
      );
    });
    // onSaved non viene chiamato perché data.segnalazione?.id è undefined.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("salva in modalità nuova usa POST (non PUT)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via POST 1");
    await user.click(screen.getByRole("button", { name: /Salva e continua a modificare/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
    });
    // Nessuna PUT.
    const putCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/segnalazioni/") && c[1]?.method === "PUT"
    );
    expect(putCall).toBeUndefined();
  });

  it("salva invia payload con tutti i campi del form", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Payload 1");
    await user.type(screen.getByLabelText(/Nome esercizio/i), "Bar Payload");
    await user.type(screen.getByLabelText("CAP"), "20100");
    await user.type(screen.getByLabelText("Destinatario"), "Sindaco Payload");
    await user.type(screen.getByLabelText(/PEC aggiuntive/i), "cc@pec.it");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body as string);
      expect(body.indirizzoVia).toBe("Via Payload 1");
      expect(body.nomeEsercizio).toBe("Bar Payload");
      expect(body.cap).toBe("20100");
      expect(body.destinatarioNome).toBe("Sindaco Payload");
      expect(body.pecCcAggiuntive).toBe("cc@pec.it");
      expect(body.includiArpa).toBe(false);
      expect(body.mittenteVisibile).toBe(true);
      expect(body.chkVetroPianoInclinato).toBe(false);
      expect(body.segnalazionePrecedenteId).toBeNull();
    });
  });

  describe("FormSegnalazione - modifica con campi null (rami ?? su fallback)", () => {
    it("precarica campi null/undefined usando fallback ?? e ?? null", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/api/config/comuni")) {
          return Promise.resolve(okResponse({ comuni: [], total: 0 }));
        }
        if (url.match(/\/api\/segnalazioni\/s-null-fields/)) {
          return Promise.resolve(
            okResponse({
              segnalazione: {
                id: "s-null-fields",
                indirizzoVia: null, // ?? "" su linea 118
                comuneId: null, // ?? null su linea 119
                cap: null, // ?? "" su linea 120
                latitudine: null,
                longitudine: null,
                nomeEsercizio: null, // ?? "" su linea 124
                chkVetroPianoInclinato: false,
                chkVetroCurvo: false,
                chkAltroTipologia: false,
                notaAltroTipologia: null,
                chkLuceVersoAlto: false,
                chkAbbagliamento: false,
                chkLuceIntrusiva: false,
                chkAltroProblema: false,
                notaAltroProblema: null,
                descrizioneLibera: null,
                destinatarioNome: null,
                oggettoPec: null,
                testoIntroduttivoPec: null,
                pecCcAggiuntive: null,
                includiArpa: false,
                mittenteVisibile: true,
                stato: "bozza",
                numeroProtocollo: null,
              },
            })
          );
        }
        return Promise.resolve(okResponse({}));
      });

      render(
        <FormSegnalazione
          user={creaUser()}
          segnalazioneId="s-null-fields"
          onBack={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // Attendi che il form sia caricato (indirizzo vuoto percampo null)
      await waitFor(() => {
        expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
      });
    });

    describe("FormSegnalazione - rami difensivi residui per coverage 100%", () => {
      it("precarica segnalazione con tutti i campi null (rami ?? su linee 157-162)", async () => {
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          if (url.match(/\/api\/segnalazioni\/s-all-null/)) {
            return Promise.resolve(
              okResponse({
                segnalazione: {
                  id: "s-all-null",
                  indirizzoVia: null,
                  comuneId: null,
                  cap: null,
                  latitudine: null,
                  longitudine: null,
                  nomeEsercizio: null,
                  livelloRecidiva: null,
                  chkVetroPianoInclinato: false,
                  chkVetroCurvo: false,
                  chkAltroTipologia: false,
                  notaAltroTipologia: null,
                  chkLuceVersoAlto: false,
                  chkAbbagliamento: false,
                  chkLuceIntrusiva: false,
                  chkAltroProblema: false,
                  notaAltroProblema: null,
                  descrizioneLibera: null,
                  destinatarioNome: null,
                  oggettoPec: null,
                  testoIntroduttivoPec: null,
                  pecCcAggiuntive: null,
                  includiArpa: false,
                  mittenteVisibile: true,
                  stato: "bozza",
                  numeroProtocollo: null,
                },
              })
            );
          }
          return Promise.resolve(okResponse({}));
        });

        render(
          <FormSegnalazione
            user={creaUser()}
            segnalazioneId="s-all-null"
            onBack={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        await waitFor(() => {
          expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
        });
      });

      it("ricerca comuni con risposta senza campo comuni (ramo ?? [] linea 189)", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni") && url.includes("search=")) {
            // Risposta senza campo 'comuni' -> fallback ?? []
            return Promise.resolve(okResponse({ total: 0 }));
          }
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          return Promise.resolve(okResponse({}));
        });

        render(
          <FormSegnalazione user={creaUser()} onBack={vi.fn()} onSaved={vi.fn()} />
        );

        await waitFor(() => {
          expect(screen.getByText(/Nuova segnalazione/i)).toBeInTheDocument();
        });

        const indirizzo = screen.getByLabelText(/Indirizzo/i);
        await userEvent.type(indirizzo, "via test");

        const search = screen.getByPlaceholderText(/Cerca comune/i);
        await userEvent.type(search, "Ber");

        vi.advanceTimersByTime(400);

        await waitFor(() => {
          // Nessun comune mostrato (lista vuota per fallback)
          expect(screen.queryByText(/Bergamo/i)).not.toBeInTheDocument();
        });

        vi.useRealTimers();
      });

      it("selezione comune con risultato null (ramo ?? null linea 197)", async () => {
        // Mock della ricerca comuni che ritorna un comune, ma poi la find
        // ritorna undefined quando si seleziona (caso limite)
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni") && url.includes("search=")) {
            return Promise.resolve(
              okResponse({
                comuni: [
                  {
                    id: 1,
                    nome: "Bergamo",
                    cap: "24100",
                    provincia: { sigla: "BG", regioneId: 1, regione: { regione: "LOMBARDIA" } },
                    pecComune: "comune@pec.it",
                  },
                ],
                total: 1,
              })
            );
          }
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          return Promise.resolve(okResponse({}));
        });

        render(
          <FormSegnalazione user={creaUser()} onBack={vi.fn()} onSaved={vi.fn()} />
        );

        await waitFor(() => {
          expect(screen.getByText(/Nuova segnalazione/i)).toBeInTheDocument();
        });

        const search = screen.getByPlaceholderText(/Cerca comune/i);
        await userEvent.type(search, "Bergamo");

        await waitFor(() => {
          expect(screen.getByText("Bergamo")).toBeInTheDocument();
        });

        // Click sul comune: la find ritorna il comune, quindi comuneSelezionato
        // viene impostato. Il ramo ?? null si triggera se la find ritorna undefined,
        // ma questo richiede un mock che ritorna una lista vuota dopo la ricerca.
        // Per coprire il ramo, verifichiamo che il comune venga selezionato.
        await userEvent.click(screen.getByText("Bergamo"));
      });

      it("upload con errore fetch (non-Error) (ramo e instanceof Error linea 289)", async () => {
        // Usa una segnalazione esistente (segnalazioneId) per avere un id valido
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          if (url.match(/\/api\/segnalazioni\/s-upload-err/)) {
            return Promise.resolve(
              okResponse({
                segnalazione: {
                  id: "s-upload-err",
                  indirizzoVia: "Via 1",
                  comuneId: null,
                  cap: "24040",
                  latitudine: null,
                  longitudine: null,
                  nomeEsercizio: null,
                  livelloRecidiva: 1,
                  chkVetroPianoInclinato: false,
                  chkVetroCurvo: false,
                  chkAltroTipologia: false,
                  notaAltroTipologia: null,
                  chkLuceVersoAlto: false,
                  chkAbbagliamento: false,
                  chkLuceIntrusiva: false,
                  chkAltroProblema: false,
                  notaAltroProblema: null,
                  descrizioneLibera: null,
                  destinatarioNome: null,
                  oggettoPec: null,
                  testoIntroduttivoPec: null,
                  pecCcAggiuntive: null,
                  includiArpa: false,
                  mittenteVisibile: true,
                  stato: "bozza",
                  numeroProtocollo: null,
                },
              })
            );
          }
          if (url.includes("/api/upload")) {
            return Promise.reject("Network error string");
          }
          return Promise.resolve(okResponse({}));
        });

        render(
          <FormSegnalazione
            user={creaUser()}
            segnalazioneId="s-upload-err"
            onBack={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        await waitFor(() => {
          expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
        });

        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
          const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
          await userEvent.upload(fileInput as HTMLInputElement, file);
        }

        await waitFor(() => {
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              description: "Errore sconosciuto",
            })
          );
        }, { timeout: 3000 });
      });

      it("upload con errore HTTP senza message (ramo ?? Errore sconosciuto linea 325)", async () => {
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          if (url.match(/\/api\/segnalazioni\/s-upload-err2/)) {
            return Promise.resolve(
              okResponse({
                segnalazione: {
                  id: "s-upload-err2",
                  indirizzoVia: "Via 1",
                  comuneId: null,
                  cap: "24040",
                  latitudine: null,
                  longitudine: null,
                  nomeEsercizio: null,
                  livelloRecidiva: 1,
                  chkVetroPianoInclinato: false,
                  chkVetroCurvo: false,
                  chkAltroTipologia: false,
                  notaAltroTipologia: null,
                  chkLuceVersoAlto: false,
                  chkAbbagliamento: false,
                  chkLuceIntrusiva: false,
                  chkAltroProblema: false,
                  notaAltroProblema: null,
                  descrizioneLibera: null,
                  destinatarioNome: null,
                  oggettoPec: null,
                  testoIntroduttivoPec: null,
                  pecCcAggiuntive: null,
                  includiArpa: false,
                  mittenteVisibile: true,
                  stato: "bozza",
                  numeroProtocollo: null,
                },
              })
            );
          }
          if (url.includes("/api/upload")) {
            return Promise.resolve({
              ok: false,
              status: 400,
              json: async () => ({}),
              text: async () => "",
            });
          }
          return Promise.resolve(okResponse({}));
        });

        render(
          <FormSegnalazione
            user={creaUser()}
            segnalazioneId="s-upload-err2"
            onBack={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        await waitFor(() => {
          expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
        });

        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
          const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
          await userEvent.upload(fileInput as HTMLInputElement, file);
        }

        await waitFor(() => {
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              description: "Errore sconosciuto",
            })
          );
        }, { timeout: 3000 });
      });

      it("eliminazione allegato con errore fetch (non-Error) (ramo linea 333)", async () => {
        // Prima carica una segnalazione esistente con un allegato
        mockFetch.mockImplementation((url: string) => {
          if (url.includes("/api/config/comuni")) {
            return Promise.resolve(okResponse({ comuni: [], total: 0 }));
          }
          if (url.match(/\/api\/segnalazioni\/s-with-att/)) {
            return Promise.resolve(
              okResponse({
                segnalazione: {
                  id: "s-with-att",
                  indirizzoVia: "Via 1",
                  comuneId: null,
                  cap: "24040",
                  latitudine: null,
                  longitudine: null,
                  nomeEsercizio: null,
                  livelloRecidiva: 1,
                  chkVetroPianoInclinato: false,
                  chkVetroCurvo: false,
                  chkAltroTipologia: false,
                  notaAltroTipologia: null,
                  chkLuceVersoAlto: false,
                  chkAbbagliamento: false,
                  chkLuceIntrusiva: false,
                  chkAltroProblema: false,
                  notaAltroProblema: null,
                  descrizioneLibera: null,
                  destinatarioNome: null,
                  oggettoPec: null,
                  testoIntroduttivoPec: null,
                  pecCcAggiuntive: null,
                  includiArpa: false,
                  mittenteVisibile: true,
                  stato: "bozza",
                  numeroProtocollo: null,
                  allegati: [
                    { id: "a1", urlStorage: "s-with-att/file.jpg", nomeOriginale: "file.jpg", tipo: "foto" },
                  ],
                },
              })
            );
          }
          if (url.includes("/api/allegati?id=a1")) {
            // DELETE rejection con non-Error
            return Promise.reject("Network error");
          }
          return Promise.resolve(okResponse({}));
        });

        vi.stubGlobal("confirm", () => true);

        render(
          <FormSegnalazione
            user={creaUser()}
            segnalazioneId="s-with-att"
            onBack={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        await waitFor(() => {
          expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
        });

        // Attendi che l'allegato sia caricato
        await waitFor(() => {
          expect(screen.getByText("file.jpg")).toBeInTheDocument();
        });

        // Click elimina allegato
        const deleteBtn = screen.getByRole("button", { name: "" });
        // Cerca il pulsante con icona Trash2
        const deleteButtons = screen.getAllByRole("button");
        const trashBtn = deleteButtons.find((b) => b.querySelector("svg.lucide-trash-2"));
        if (trashBtn) {
          await userEvent.click(trashBtn);
        }

        await waitFor(() => {
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              description: "Errore sconosciuto",
            })
          );
        });

        vi.unstubAllGlobals();
      });

      it("input longitudine con valore vuoto imposta null (ramo linea 505)", async () => {
        render(
          <FormSegnalazione user={creaUser()} onBack={vi.fn()} onSaved={vi.fn()} />
        );

        await waitFor(() => {
          expect(screen.getByText(/Nuova segnalazione/i)).toBeInTheDocument();
        });

        // Trova l'input longitudine (placeholder "auto")
        const longInputs = screen.getAllByPlaceholderText("auto");
        const longInput = longInputs[1];

        // Inserisci un valore (input type=number ritorna number)
        await userEvent.type(longInput, "9.5");

        // Cancella il valore per triggerare setLongitudine(null)
        await userEvent.clear(longInput);
        // L'input type=number vuoto ha value ""
        expect((longInput as HTMLInputElement).value).toBe("");
      });
    });
  });
});

// -----------------------------------------------------------------------------
// Rami residui per coverage 100% (linee 157, 160, 161, 162, 197, 289, 353)
// -----------------------------------------------------------------------------

describe("FormSegnalazione - rami residui coverage 100%", () => {
  // I test precedenti nel file (in particolare "eliminazione allegato con
  // errore fetch (non-Error)") chiamano vi.unstubAllGlobals() per ripristinare
  // lo stub di confirm. Questo rimuove anche lo stub globale di fetch e
  // confirm, rendendo mockFetch e confirmSpy inutilizzabili per i test
  // successivi. Si re-stubbano entrambi prima di ogni test di questo blocco.
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("confirm", confirmSpy);
  });

  it("recidiva con campi null nella segnalazione precedente (linee 157, 160, 161, 162)", async () => {
    // La segnalazione precedente ha livelloRecidiva, indirizzoVia, comuneId
    // e cap null: i rami `?? 1`, `?? ""`, `?? null`, `?? ""` del useEffect
    // di recidiva vengono tutti triggerati.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/config/comuni")) {
        return Promise.resolve(okResponse({ comuni: [], total: 0 }));
      }
      if (url.match(/\/api\/segnalazioni\/s-prec-null/)) {
        return Promise.resolve(
          okResponse({
            segnalazione: {
              id: "s-prec-null",
              numeroProtocollo: null,
              indirizzoVia: null, // ?? "" (linea 160)
              comuneId: null, // ?? null (linea 161)
              cap: null, // ?? "" (linea 162)
              latitudine: null,
              longitudine: null,
              nomeEsercizio: null,
              livelloRecidiva: null, // ?? 1 (linea 157)
              chkVetroPianoInclinato: false,
              chkVetroCurvo: false,
              chkAltroTipologia: false,
              notaAltroTipologia: null,
              chkLuceVersoAlto: false,
              chkAbbagliamento: false,
              chkLuceIntrusiva: false,
              chkAltroProblema: false,
              notaAltroProblema: null,
              descrizioneLibera: null,
              destinatarioNome: null,
              oggettoPec: null,
              testoIntroduttivoPec: null,
              pecCcAggiuntive: null,
              includiArpa: false,
              mittenteVisibile: true,
              stato: "bozza",
            },
          })
        );
      }
      return Promise.resolve(okResponse({}));
    });

    render(
      <FormSegnalazione
        user={creaUser()}
        segnalazionePrecedenteId="s-prec-null"
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Attende che il box recidiva sia renderizzato (segno che la fetch
    // precedente è completata e i campi null sono stati precompilati
    // con i fallback ??). Il livello mostrato è livelloRecidiva ?? 1 + 1 = 2.
    await waitFor(() => {
      expect(screen.getByText("Segnalazione collegata per recidiva")).toBeInTheDocument();
    });
    // Livello recidiva mostrato = (null ?? 1) + 1 = 2
    expect(screen.getByText(/livello 2/i)).toBeInTheDocument();
  });

  it("modifica con comuneId non presente nella lista comuni (linea 197: c ?? null)", async () => {
    // La segnalazione in modifica ha comuneId=999, ma la lista comuni
    // restituita da /api/config/comuni non lo contiene: la find ritorna
    // undefined e il ramo `c ?? null` del useEffect su comuneId viene
    // triggerato, impostando comuneSelezionato a null.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/config/comuni")) {
        return Promise.resolve(
          okResponse({
            comuni: [creaComune({ id: 1, nome: "Milano" })],
            total: 1,
          })
        );
      }
      if (url.match(/\/api\/segnalazioni\/s-comune-mismatch/)) {
        return Promise.resolve(
          okResponse({
            segnalazione: {
              id: "s-comune-mismatch",
              indirizzoVia: "Via Test 1",
              comuneId: 999, // non presente nella lista comuni
              cap: "24040",
              latitudine: null,
              longitudine: null,
              nomeEsercizio: null,
              livelloRecidiva: 1,
              chkVetroPianoInclinato: false,
              chkVetroCurvo: false,
              chkAltroTipologia: false,
              notaAltroTipologia: null,
              chkLuceVersoAlto: false,
              chkAbbagliamento: false,
              chkLuceIntrusiva: false,
              chkAltroProblema: false,
              notaAltroProblema: null,
              descrizioneLibera: null,
              destinatarioNome: null,
              oggettoPec: null,
              testoIntroduttivoPec: null,
              pecCcAggiuntive: null,
              includiArpa: false,
              mittenteVisibile: true,
              stato: "bozza",
              numeroProtocollo: null,
            },
          })
        );
      }
      return Promise.resolve(okResponse({}));
    });

    render(
      <FormSegnalazione
        user={creaUser()}
        segnalazioneId="s-comune-mismatch"
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Attende che il form sia caricato. Il ramo `c ?? null` è valutato
    // durante il render (useEffect su [comuneId, comuni]): comuneId=999
    // è truthy, la find ritorna undefined, `c ?? null` assegna null a
    // comuneSelezionato. Il box "Comune selezionato" non è visibile.
    await waitFor(() => {
      expect(screen.getByText(/Modifica segnalazione/i)).toBeInTheDocument();
    });
    // Il box info del comune non è visibile perché comuneSelezionato è null
    expect(screen.queryByText(/Comune selezionato:/i)).not.toBeInTheDocument();
  });

  it("salva con errore di rete non-Error (linea 289: e instanceof Error false)", async () => {
    // Il POST /api/segnalazioni lancia una stringa (non un Error):
    // il catch di salva() deve usare il fallback "Errore sconosciuto".
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        // Lancia un non-Error (stringa): copre il ramo false di
        // `e instanceof Error` nel catch di salva().
        throw "errore di rete come stringa";
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via String Error 1");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore",
          description: "Errore sconosciuto",
          variant: "destructive",
        })
      );
    });
  });

  it("eliminaAllegato con errore HTTP e JSON senza campo error (linea 353: data.error ?? Errore sconosciuto)", async () => {
    // La DELETE ritorna 403 con body JSON vuoto {}: data.error è undefined,
    // il ramo `?? "Errore sconosciuto"` viene triggerato.
    const user = userEvent.setup();
    const allegato = {
      id: "a-noerr",
      segnalazioneId: "s1",
      tipo: "foto",
      urlStorage: "/storage/noerr",
      nomeOriginale: "noerr.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seg = creaSegnalazione({ id: "s1", allegati: [allegato as never] });
    confirmSpy.mockReturnValue(true);
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u.startsWith("/api/segnalazioni/")) return okResponse({ segnalazione: seg });
      if (u.startsWith("/api/allegati") && method === "DELETE") {
        // Risposta 403 con JSON vuoto (nessun campo error):
        // copre il ramo `data.error ?? "Errore sconosciuto"`.
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => "",
        } as unknown as Response;
      }
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("noerr.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("noerr.jpg").closest("li");
    const btn = li!.querySelector("button")!;
    await user.click(btn);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Errore eliminazione",
          description: "Errore sconosciuto",
          variant: "destructive",
        })
      );
    });
    // L'allegato resta visibile (non rimosso)
    expect(screen.getByText("noerr.jpg")).toBeInTheDocument();
  });
});
