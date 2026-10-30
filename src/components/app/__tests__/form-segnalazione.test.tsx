/**
 * Test di rendering e interazione per FormSegnalazione.
 *
 * Si coprono: caricamento iniziale (nuova vs modifica), recidiva,
 * ricerca comune con debounce 300ms, selezione comune con auto-derivazione
 * provincia/regione/PEC/cap/oggetto/testo introduttivo, checkbox tipologia
 * (3), checkbox problemi (4), nota "altro" condizionale, personalizzazione
 * invio (destinatario, ARPA, CC, oggetto, testo introduttivo, mittente
 * visibile), allegati (upload immagine, upload PDF, validazione dimensione
 * 10MB, limite 4 allegati, eliminazione con dialog di conferma, errori server/rete,
 * blocco demo), GPS (successo, errore, non disponibile), submit (POST nuovo
 * con esci true/false, PUT modifica, validazione indirizzo vuoto, errore
 * server, errore rete, risposta JSON non valida, demo mode), pulsanti
 * Indietro/Annulla, demo mode bloccante su salva/carica/elimina.
 *
 * Autore: Fabio Tempera (2026)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
function configuraFetch(
  opts: {
    comuni?: unknown[];
    segnalazione?: Segnalazione | null;
    segnalazionePrecedente?: Segnalazione | null;
    uploadAllegato?: unknown;
  } = {},
) {
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
  mockFetch.mockImplementation(async (url: string | URL, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
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
function renderForm(
  props: Partial<{
    user: SessionUser;
    segnalazioneId: string | null;
    segnalazionePrecedenteId: string | null;
    onBack: () => void;
    onSaved: (id: string) => void;
  }> = {},
) {
  const onBack = props.onBack ?? vi.fn();
  const onSaved = props.onSaved ?? vi.fn();
  const risultato = render(
    <FormSegnalazione
      user={props.user ?? creaUser()}
      segnalazioneId={props.segnalazioneId ?? null}
      segnalazionePrecedenteId={props.segnalazionePrecedenteId ?? null}
      onBack={onBack}
      onSaved={onSaved}
    />,
  );
  // La sezione PEC avanzata è chiusa di default: nei test di rendering la si apre.
  apriPec();
  return risultato;
}

/** Il referente vede la sezione PEC (il volontario no). */
function renderFormReferente(props: Parameters<typeof renderForm>[0] = {}) {
  return renderForm({ user: creaUser({ ruolo: "referente_provinciale", provinciaId: 1 }), ...props });
}

/** Porta il form sul passo indicato dalla barra dei passi. */
const ETICHETTE_PASSO = {
  Luogo: /Luogo/,
  "Non conformità": /Non conformità/,
  "Allegati e invio": /Allegati e invio/,
} as const;

function vaiAlPasso(nome: keyof typeof ETICHETTE_PASSO) {
  fireEvent.click(screen.getByRole("button", { name: ETICHETTE_PASSO[nome] }));
}

/** Apre il dettaglio <details> della PEC avanzata, se presente. */
function apriPec() {
  const dettagli = document.querySelector("details");
  if (dettagli) dettagli.open = true;
}

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
  it("mostra 'Nuova segnalazione' quando segnalazioneId non è fornito", async () => {
    renderForm();
    await act(async () => {});
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
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    // Nessuna chiamata a /api/segnalazioni/[id]
    const segCall = mockFetch.mock.calls.find((c) => typeof c[0] === "string" && c[0].startsWith("/api/segnalazioni/"));
    expect(segCall).toBeUndefined();
  });

  it("effettua GET /api/config/comuni al montaggio (debounce iniziale)", async () => {
    renderForm();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
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
    renderFormReferente({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Precaricata 5") as HTMLInputElement).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Bar Test") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("00100") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("Descrizione test") as HTMLTextAreaElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sindaco Test") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("Oggetto precompilato") as HTMLInputElement).toBeInTheDocument();
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

  it("mostra 'Caricamento…' durante il fetch iniziale della segnalazione", async () => {
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [] });
      // Mai risolta per /api/segnalazioni/: rimane in caricamento.
      if (u.startsWith("/api/segnalazioni/")) return new Promise(() => {});
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s-loading" });
    await act(async () => {});
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
  it("rende vuota la lista se l'API dei Comuni risponde con errore HTTP", async () => {
    instradaFetch({
      "/api/config/comuni": () => Promise.resolve(errorResponse(503, "Temporaneamente non disponibile")),
    });
    renderForm();
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await act(async () => {});
    expect(screen.getByText(/Nessun comune/i)).toBeInTheDocument();
  });

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
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    // Digita nel campo di ricerca comune (placeholder "Cerca comune...")
    await user.type(screen.getByPlaceholderText(/Cerca comune/i), "Roma");
    // Attende che il debounce (300ms) faccia partire la fetch con la search.
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/config/comuni?search=${encodeURIComponent("Roma")}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      },
      { timeout: 2000 },
    );
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
      expect(screen.getByDisplayValue("20121") as HTMLInputElement).toBeInTheDocument();
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
      expect(screen.getByDisplayValue("99999") as HTMLInputElement).toBeInTheDocument();
    });
  });

  it("selezionare un comune precompila destinatarioNome con 'Sindaco ...'", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune({ nomeSindaco: "Giuseppe Sala" })] });
    renderFormReferente();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sindaco Giuseppe Sala") as HTMLInputElement).toBeInTheDocument();
    });
  });

  it("selezionare un comune precompila oggettoPec e testoIntroduttivoPec se vuoti", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderFormReferente();
    await waitFor(() => {
      expect(screen.getByText("Milano")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Milano"));
    await waitFor(() => {
      expect(
        screen.getByDisplayValue(/Segnalazione impianto di illuminazione/i) as HTMLInputElement,
      ).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue(/Si segnala la presenza/i) as HTMLTextAreaElement).toBeInTheDocument();
  });

  it("limita la visualizzazione a 30 comuni (slice)", async () => {
    const lista = Array.from({ length: 35 }, (_, i) => creaComune({ id: i + 1, nome: `Comune${i}` }));
    configuraFetch({ comuni: lista });
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Comune0")).toBeInTheDocument();
    });
    // I primi 30 comuni sono visibili, il 31° (indice 30) no.
    expect(screen.getByText("Comune29")).toBeInTheDocument();
    expect(screen.queryByText("Comune30")).not.toBeInTheDocument();
  });

  it("aggiorna CAP, destinatario e oggetto quando cambia il Comune precompilato", async () => {
    const user = userEvent.setup();
    configuraFetch({
      comuni: [creaComune(), creaComune({ id: 2, nome: "Monza", cap: "20900", nomeSindaco: "Luca Bianchi" })],
    });
    renderFormReferente();
    await user.click(await screen.findByText("Milano"));
    expect(screen.getByLabelText("CAP")).toHaveValue("20121");
    expect(screen.getByLabelText("Destinatario")).toHaveValue("Sindaco Giuseppe Sala");
    await user.click(screen.getByText("Monza"));
    expect(screen.getByLabelText("CAP")).toHaveValue("20900");
    expect(screen.getByLabelText("Destinatario")).toHaveValue("Sindaco Luca Bianchi");
    expect(screen.getByLabelText("Oggetto PEC")).toHaveValue(
      "Segnalazione impianto di illuminazione non conforme - Monza (MI)",
    );
  });

  it("non sovrascrive CAP e dati PEC scritti a mano quando cambia il Comune", async () => {
    const user = userEvent.setup();
    configuraFetch({
      comuni: [
        creaComune({ nomeSindaco: null }),
        creaComune({ id: 2, nome: "Monza", cap: "20900", nomeSindaco: "Luca Bianchi" }),
      ],
    });
    renderFormReferente();
    await user.click(await screen.findByText("Milano"));
    expect(screen.getByLabelText("Destinatario")).toHaveValue("Comune di Milano");
    fireEvent.change(screen.getByLabelText("CAP"), { target: { value: "99999" } });
    fireEvent.change(screen.getByLabelText("Destinatario"), { target: { value: "Ufficio protocollo" } });
    fireEvent.change(screen.getByLabelText("Oggetto PEC"), { target: { value: "Oggetto personalizzato" } });
    await user.click(screen.getByText("Monza"));
    expect(screen.getByLabelText("CAP")).toHaveValue("99999");
    expect(screen.getByLabelText("Destinatario")).toHaveValue("Ufficio protocollo");
    expect(screen.getByLabelText("Oggetto PEC")).toHaveValue("Oggetto personalizzato");
  });

  it("un errore tardivo di una ricerca annullata non svuota i Comuni più recenti", async () => {
    const user = userEvent.setup();
    let rifiutaMilano: (errore: Error) => void = () => undefined;
    const milanoInAttesa = new Promise<Response>((_resolve, reject) => {
      rifiutaMilano = reject;
    });
    instradaFetch({
      "/api/config/comuni?search=Mi": () => milanoInAttesa,
      "/api/config/comuni?search=Mo": () =>
        Promise.resolve(okResponse({ comuni: [creaComune({ id: 2, nome: "Monza" })] })),
    });
    renderForm();
    const cerca = screen.getByPlaceholderText(/Cerca comune/i);
    await user.type(cerca, "Mi");
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => c[0] === "/api/config/comuni?search=Mi")).toBe(true));
    await user.clear(cerca);
    await user.type(cerca, "Mo");
    expect(await screen.findByText("Monza")).toBeInTheDocument();
    const vecchia = mockFetch.mock.calls.find((c) => c[0] === "/api/config/comuni?search=Mi");
    expect(vecchia?.[1]?.signal.aborted).toBe(true);
    await act(async () => rifiutaMilano(new Error("Ricerca superata")));
    expect(screen.getByText("Monza")).toBeInTheDocument();
    expect(screen.queryByText(/Nessun comune/i)).not.toBeInTheDocument();
  });

  it("una ricerca precedente lenta non sovrascrive i risultati della ricerca corrente", async () => {
    const user = userEvent.setup();
    let risolviMilano: (risposta: Response) => void = () => undefined;
    const milanoInAttesa = new Promise<Response>((resolve) => {
      risolviMilano = resolve;
    });
    instradaFetch({
      "/api/config/comuni?search=Mi": () => milanoInAttesa,
      "/api/config/comuni?search=Mo": () =>
        Promise.resolve(okResponse({ comuni: [creaComune({ id: 2, nome: "Monza" })] })),
    });
    renderForm();
    const cerca = screen.getByPlaceholderText(/Cerca comune/i);
    await user.type(cerca, "Mi");
    await waitFor(() => expect(mockFetch.mock.calls.some((c) => c[0] === "/api/config/comuni?search=Mi")).toBe(true));
    await user.clear(cerca);
    await user.type(cerca, "Mo");
    expect(await screen.findByText("Monza")).toBeInTheDocument();
    const vecchia = mockFetch.mock.calls.find((c) => c[0] === "/api/config/comuni?search=Mi");
    expect(vecchia?.[1]?.signal.aborted).toBe(true);
    await act(async () => risolviMilano(okResponse({ comuni: [creaComune()] })));
    expect(screen.getByText("Monza")).toBeInTheDocument();
    expect(screen.queryByText("Milano")).not.toBeInTheDocument();
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
    vaiAlPasso("Non conformità");
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
    vaiAlPasso("Non conformità");
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
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    const input = screen.getByLabelText("Destinatario");
    await user.type(input, "Sindaco Test");
    expect((input as HTMLInputElement).value).toBe("Sindaco Test");
  });

  it("permette di modificare pecCcAggiuntive", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    const input = screen.getByLabelText(/PEC aggiuntive in copia/i);
    await user.type(input, "cc1@pec.it");
    expect((input as HTMLInputElement).value).toBe("cc1@pec.it");
  });

  it("permette di modificare oggettoPec", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    const input = screen.getByLabelText("Oggetto PEC");
    await user.type(input, "Oggetto test");
    expect((input as HTMLInputElement).value).toBe("Oggetto test");
  });

  it("permette di modificare testoIntroduttivoPec", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    const ta = screen.getByLabelText("Testo introduttivo PEC");
    await user.type(ta, "Intro test");
    expect((ta as HTMLTextAreaElement).value).toBe("Intro test");
  });

  it("permette di modificare descrizioneLibera", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Non conformità");
    const ta = screen.getByLabelText(/Descrizione libera/i);
    await user.type(ta, "Descrizione dettagliata");
    expect((ta as HTMLTextAreaElement).value).toBe("Descrizione dettagliata");
  });

  it("attivando lo switch includiArpa cambia stato", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    const sw = screen.getAllByRole("switch")[0];
    await user.click(sw);
    await waitFor(() => {
      expect(sw).toHaveAttribute("data-state", "checked");
    });
  });

  it("mittenteVisibile true mostra 'volontario' nel testo", async () => {
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
    await act(async () => {});
    expect(screen.getByText(/Mittente: volontario/)).toBeInTheDocument();
  });

  it("attivando/disattivando lo switch mittenteVisibile cambia testo", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    vaiAlPasso("Allegati e invio");
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
  it("mostra il label di caricamento quando allegati.length < 4", async () => {
    renderForm();
    await act(async () => {});
    expect(screen.getByText(/Carica allegato \(massimo 4\)/i)).toBeInTheDocument();
  });

  it("mostra 'Hai raggiunto il limite di 4 allegati' quando allegati.length === 4", async () => {
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
      expect(screen.getByText(/Hai raggiunto il limite di 4 allegati/i)).toBeInTheDocument();
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
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Salva prima la bozza" }));
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
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "File troppo grande" }));
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
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Allegato caricato" }));
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
      const uploadCall = mockFetch.mock.calls.find((c) => c[0] === "/api/upload" && c[1]?.method === "POST");
      expect(uploadCall).toBeDefined();
      const fd = uploadCall?.[1].body as FormData;
      expect(fd.get("tipo")).toBe("documento");
      expect(fd.get("segnalazioneId")).toBe("s1");
    });
  });

  it("upload con errore server mostra il toast di caricamento con il messaggio del server", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    configuraFetch({ segnalazione: seg });
    // Override: /api/upload risponde 400.
    mockFetch.mockImplementation(async (url: string | URL, _init?: RequestInit) => {
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
        expect.objectContaining({ title: "Caricamento allegato non riuscito", description: "Tipo non supportato" }),
      );
    });
  });

  it("upload con errore di rete mostra il toast di connessione", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1" });
    mockFetch.mockImplementation(async (url: string | URL, _init?: RequestInit) => {
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
        expect.objectContaining({
          title: "Connessione non riuscita",
          description: "Verifica la connessione e riprova.",
        }),
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Allegati - eliminazione
// -----------------------------------------------------------------------------

describe("FormSegnalazione - allegati eliminazione", () => {
  it("elimina l'allegato dopo la conferma nel dialog: chiama DELETE /api/allegati?id=", async () => {
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
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("eliminami.jpg")).toBeInTheDocument();
    });
    // Il pulsante di eliminazione è nel contenitore (li) del file.
    const li = screen.getByText("eliminami.jpg").closest("li");
    const btn = li?.querySelector("button") as HTMLButtonElement;
    await user.click(btn);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina allegato" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`/api/allegati?id=a-del`, expect.objectContaining({ method: "DELETE" }));
    });
    // L'allegato viene rimosso dalla lista.
    await waitFor(() => {
      expect(screen.queryByText("eliminami.jpg")).not.toBeInTheDocument();
    });
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Allegato eliminato" }));
  });

  it("non elimina l'allegato se il dialog di conferma viene annullato", async () => {
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
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => {
      expect(screen.getByText("mantienimi.jpg")).toBeInTheDocument();
    });
    const li = screen.getByText("mantienimi.jpg").closest("li");
    const btn = li?.querySelector("button") as HTMLButtonElement;
    await user.click(btn);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annulla" }));
    // La DELETE non viene chiamata.
    const deleteCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/allegati") && c[1]?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
    // L'allegato resta visibile.
    expect(screen.getByText("mantienimi.jpg")).toBeInTheDocument();
  });

  it("eliminazione con errore server mostra il toast di eliminazione con il messaggio del server", async () => {
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
    const btn = li?.querySelector("button") as HTMLButtonElement;
    await user.click(btn);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina allegato" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Eliminazione non riuscita", description: "Non autorizzato" }),
      );
    });
    // L'allegato resta visibile (non viene rimosso).
    expect(screen.getByText("errore.jpg")).toBeInTheDocument();
  });

  it("eliminazione con errore di rete mostra il toast di connessione", async () => {
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
    const btn = li?.querySelector("button") as HTMLButtonElement;
    await user.click(btn);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina allegato" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Connessione non riuscita",
          description: "Verifica la connessione e riprova.",
        }),
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
    await waitFor(() => expect(screen.getByText("scaricabile.jpg")).toBeInTheDocument());
    vaiAlPasso("Allegati e invio");
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
      expect(screen.getByText("Documento")).toBeInTheDocument();
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
        expect.objectContaining({ title: "GPS non disponibile", variant: "destructive" }),
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
    geoGetCurrentPosition.mockImplementation(
      (success: (p: { coords: { latitude: number; longitude: number } }) => void) => {
        success({ coords: { latitude: 45.4642, longitude: 9.19 } });
      },
    );
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("45.4642") as HTMLInputElement).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("9.19") as HTMLInputElement).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Posizione rilevata" }));
  });

  it("GPS con errore mostra toast 'Errore GPS' con il messaggio", async () => {
    const user = userEvent.setup();
    renderForm();
    geoGetCurrentPosition.mockImplementation((_s: unknown, error: (e: Error) => void) => {
      error(new Error("Permission denied"));
    });
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Posizione non rilevata",
          description: "Impossibile rilevare la posizione. Riprova o inserisci le coordinate manualmente.",
          variant: "destructive",
        }),
      );
    });
  });

  it("GPS negato (codice 1) mostra il messaggio sul permesso", async () => {
    const user = userEvent.setup();
    renderForm();
    geoGetCurrentPosition.mockImplementation((_s: unknown, error: (e: { code: number; message: string }) => void) => {
      error({ code: 1, message: "denied" });
    });
    await user.click(screen.getByRole("button", { name: /Rileva posizione GPS/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Permesso di posizione negato. Inserisci l'indirizzo o le coordinate manualmente.",
        }),
      ),
    );
  });
});

// -----------------------------------------------------------------------------
// Submit - salva
// -----------------------------------------------------------------------------

describe("FormSegnalazione - salvataggio", () => {
  it("salva con indirizzo vuoto mostra l'errore collegato al campo, senza toast", async () => {
    const user = userEvent.setup();
    renderForm();
    // Indirizzo lasciato vuoto (default).
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    const campo = screen.getByLabelText("Indirizzo *");
    await waitFor(() => {
      expect(campo).toHaveAttribute("aria-invalid", "true");
    });
    expect(campo).toHaveAttribute("aria-describedby", "errore-indirizzo");
    expect(document.getElementById("errore-indirizzo")).toHaveTextContent("Inserisci l'indirizzo");
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Indirizzo obbligatorio" }));
    // Nessuna chiamata POST.
    const postCall = mockFetch.mock.calls.find((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST");
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
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni", expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("new-id");
    });
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Bozza salvata" }));
  });

  it("un doppio click prima del rerender crea una sola bozza", async () => {
    let completaPost: (risposta: Response) => void = () => undefined;
    const postInAttesa = new Promise<Response>((resolve) => {
      completaPost = resolve;
    });
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (url === "/api/segnalazioni" && init?.method === "POST") return postInAttesa;
      return okResponse({});
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Indirizzo *"), { target: { value: "Via unica 1" } });
    const bottone = screen.getByRole("button", { name: /Salva bozza/i });
    act(() => {
      fireEvent.click(bottone);
      fireEvent.click(bottone);
    });
    expect(mockFetch.mock.calls.filter((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST")).toHaveLength(1);
    await act(async () => {
      completaPost(okResponse({ segnalazione: { id: "new-id" } }));
    });
  });

  it("salva bozza (esci=false) non chiama onSaved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 2");
    await user.click(screen.getByRole("button", { name: /Salva bozza/i }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni", expect.objectContaining({ method: "POST" }));
    });
    // onSaved non viene chiamato.
    expect(onSaved).not.toHaveBeenCalled();
    // Toast di successo comunque mostrato.
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Bozza salvata" }));
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
      expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-edit", expect.objectContaining({ method: "PUT" }));
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("s-edit");
    });
  });

  it("salva con errore server mostra il toast di salvataggio con il messaggio del server", async () => {
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
          title: "Salvataggio non riuscito",
          description: "Comune non valido",
          variant: "destructive",
        }),
      );
    });
  });

  it("salva con errore di rete mostra il toast di salvataggio con il messaggio dell'errore", async () => {
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
          title: "Salvataggio non riuscito",
          description: "server irraggiungibile",
          variant: "destructive",
        }),
      );
    });
  });

  it("salva con risposta 200 OK ma JSON non valido: segnala risposta incompleta", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        // res.ok true ma json() lancia: senza ID la bozza non può essere
        // considerata salvata e occorre verificare l'elenco prima di riprovare.
        return invalidJsonResponse();
      }
      return okResponse({});
    });
    renderForm({ onSaved });
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 5");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Salvataggio non riuscito",
          description: expect.stringContaining("Risposta incompleta"),
        }),
      );
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("salva con errore HTTP e corpo non JSON mostra il messaggio generico", async () => {
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
          title: "Salvataggio non riuscito",
          description: "Operazione non riuscita. Riprova tra qualche istante.",
          variant: "destructive",
        }),
      );
    });
  });

  it("salva invia payload con segnalazionePrecedenteId quando fornito", async () => {
    const user = userEvent.setup();
    const segPrec = creaSegnalazione({ id: "s-prec", indirizzoVia: "Via Precedente 9" });
    mockFetch.mockImplementation(async (url: string | URL, _init?: RequestInit) => {
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
      const postCall = mockFetch.mock.calls.find((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall?.[1].body as string);
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
    expect(screen.getByRole("button", { name: /Salva bozza/i })).toBeDisabled();
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
        title: "Salvataggio non riuscito",
        description: "demo readonly",
        variant: "destructive",
      }),
    );
    // Nessuna POST effettuata (la guardia ha lanciato prima della fetch).
    const postCall = mockFetch.mock.calls.find((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  it("caricaAllegato in demo mode mostra toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    let isDemo = false;
    isDemoMock.mockImplementation(() => isDemo);
    const seg = creaSegnalazione({ id: "s-demo" });
    configuraFetch({ segnalazione: seg });
    const { container } = renderForm({
      user: creaUserDemo(),
      segnalazioneId: "s-demo",
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument();
    });
    isDemo = true;
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "foto.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    // Nessuna chiamata a /api/upload.
    const uploadCall = mockFetch.mock.calls.find((c) => c[0] === "/api/upload");
    expect(uploadCall).toBeUndefined();
  });

  it("eliminaAllegato in demo mode mostra toast 'Azione non disponibile'", async () => {
    const user = userEvent.setup();
    let isDemo = false;
    isDemoMock.mockImplementation(() => isDemo);
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
    isDemo = true;
    const li = screen.getByText("demo.jpg").closest("li");
    const btn = li?.querySelector("button") as HTMLButtonElement;
    await user.click(btn);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Elimina allegato" }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Azione non disponibile",
          description: "demo readonly",
          variant: "destructive",
        }),
      );
    });
    // Nessuna DELETE effettuata.
    const deleteCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/allegati") && c[1]?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
    // L'allegato resta visibile.
    expect(screen.getByText("demo.jpg")).toBeInTheDocument();
  });

  it("in demo mode il form si renderizza comunque (nessun blocco al rendering)", async () => {
    isDemoMock.mockReturnValue(true);
    renderForm({ user: creaUserDemo() });
    await act(async () => {});
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
    expect(screen.getByDisplayValue("00100") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bar Ricorrente") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("41.9") as HTMLInputElement).toBeInTheDocument();
    expect(screen.getByDisplayValue("12.5") as HTMLInputElement).toBeInTheDocument();
  });

  it("non mostra il box recidiva se segnalazionePrecedenteId non è fornito", async () => {
    renderForm();
    await attendiEffetti();
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/segnalazioni\//));
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
  });

  it("non mostra il box recidiva se la fetch precedente ritorna null", async () => {
    configuraFetch({ segnalazionePrecedente: null });
    renderForm({ segnalazionePrecedenteId: "s-mancante" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-mancante");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
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

  it("carica lo stato dei checkbox, dello switch ARPA e le note della segnalazione esistente", async () => {
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
    const { container } = renderFormReferente({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByDisplayValue("Nota tip")).toBeInTheDocument());
    for (const id of ["chk1", "chk2", "chk3", "chk4", "chk5", "chk6", "chk7"]) {
      expect(container.querySelector(`#${id}`)).toHaveAttribute("data-state", "checked");
    }
    expect(container.querySelector("#includi-arpa")).toHaveAttribute("data-state", "checked");
    expect(container.querySelector("#mittente-visibile")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByDisplayValue("Nota prob")).toBeInTheDocument();
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
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-vuoto");
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
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Salvataggio non riuscito" }));
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("salva in modalità nuova usa POST (non PUT)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via POST 1");
    await user.click(screen.getByRole("button", { name: /Salva bozza/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST");
      expect(postCall).toBeDefined();
    });
    // Nessuna PUT.
    const putCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/api/segnalazioni/") && c[1]?.method === "PUT",
    );
    expect(putCall).toBeUndefined();
  });

  it("salva invia payload con tutti i campi del form", async () => {
    const user = userEvent.setup();
    renderFormReferente();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Payload 1");
    await user.type(screen.getByLabelText(/Nome esercizio/i), "Bar Payload");
    await user.type(screen.getByLabelText("CAP"), "20100");
    vaiAlPasso("Allegati e invio");
    await user.type(screen.getByLabelText("Destinatario"), "Sindaco Payload");
    await user.type(screen.getByLabelText(/PEC aggiuntive/i), "cc@pec.it");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find((c) => c[0] === "/api/segnalazioni" && c[1]?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall?.[1].body as string);
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
  }, 30000);
});

// -----------------------------------------------------------------------------
// Helper per le risposte anomale, i campi null e le asserzioni negative
// -----------------------------------------------------------------------------

const MESSAGGIO_GENERICO = "Operazione non riuscita. Riprova tra qualche istante.";

/** Risposta con corpo non leggibile come JSON. */
function rispostaNonJson(ok: boolean): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => {
      throw new Error("corpo non JSON");
    },
    text: async () => "",
  } as unknown as Response;
}

/** Risposta di errore HTTP con corpo JSON privo del campo error. */
function rispostaErroreVuota(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

/**
 * Instrada le chiamate fetch: il primo prefisso che corrisponde all'URL
 * determina la risposta. Le route non elencate ricevono l'elenco comuni
 * oppure un corpo vuoto.
 */
function instradaFetch(instradamenti: Record<string, () => Promise<Response>>, comuni: unknown[] = []) {
  mockFetch.mockImplementation(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    const prefisso = Object.keys(instradamenti).find((p) => u.startsWith(p));
    if (prefisso) return instradamenti[prefisso]();
    if (u.startsWith("/api/config/comuni")) return okResponse({ comuni });
    return okResponse({});
  });
}

/** Segnalazione con i campi facoltativi a null: copre i ripieghi del form. */
function segnalazioneConCampiNull(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    numeroProtocollo: null,
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
    ...overrides,
  };
}

/** Lascia completare le promise pendenti prima di un'asserzione negativa. */
async function attendiEffetti() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Restituisce l'input file del form; il test fallisce se non è presente. */
function inputFile(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

/** Allegato di prova per le segnalazioni con allegati. */
function allegatoDiProva(id: string, nomeOriginale: string, tipo = "foto") {
  return {
    id,
    segnalazioneId: "s1",
    tipo,
    urlStorage: `/storage/${id}`,
    nomeOriginale,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Apre la conferma dell'allegato indicato e clicca il pulsante scelto nel dialog. */
async function rispondiConfermaAllegato(
  user: ReturnType<typeof userEvent.setup>,
  nomeFile: string,
  pulsante: "Elimina allegato" | "Annulla",
) {
  const riga = screen.getByText(nomeFile).closest("li");
  await user.click(riga?.querySelector("button") as HTMLButtonElement);
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: pulsante }));
}

// -----------------------------------------------------------------------------
// Campi null, ripieghi e ricerca comuni
// -----------------------------------------------------------------------------

describe("FormSegnalazione - campi null e ripieghi", () => {
  it("precarica una segnalazione con campi null lasciando vuoti i campi del luogo", async () => {
    instradaFetch({
      "/api/segnalazioni/s-null": () =>
        Promise.resolve(okResponse({ segnalazione: segnalazioneConCampiNull("s-null") })),
    });
    renderFormReferente({ segnalazioneId: "s-null" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Modifica segnalazione" })).toBeInTheDocument());
    expect(screen.getByLabelText("Indirizzo *")).toHaveValue("");
    expect(screen.getByLabelText("CAP")).toHaveValue("");
    expect(screen.getByLabelText(/Nome esercizio/i)).toHaveValue("");
    expect((screen.getByLabelText("Latitudine") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Mittente: volontario/)).toBeInTheDocument();
  });

  it("recidiva con campi null nella segnalazione precedente mostra il livello base 1 e campi vuoti", async () => {
    instradaFetch({
      "/api/segnalazioni/s-prec-null": () =>
        Promise.resolve(okResponse({ segnalazione: segnalazioneConCampiNull("s-prec-null") })),
    });
    renderForm({ segnalazionePrecedenteId: "s-prec-null" });
    await waitFor(() => expect(screen.getByText("Segnalazione collegata per recidiva")).toBeInTheDocument());
    // Il livello mostrato è (livelloRecidiva ?? 1) + 1.
    expect(screen.getByText(/livello 2/i)).toBeInTheDocument();
    expect(screen.getByText(/senza protocollo/)).toBeInTheDocument();
    expect(screen.getByLabelText("Indirizzo *")).toHaveValue("");
  });

  it("ricerca comuni con risposta senza il campo comuni mostra l'elenco vuoto", async () => {
    const user = userEvent.setup();
    instradaFetch({
      "/api/config/comuni?search=": () => Promise.resolve(okResponse({ total: 0 })),
    });
    renderForm();
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await user.type(screen.getByPlaceholderText(/Cerca comune/i), "Ber");
    await waitFor(
      () =>
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/config/comuni?search=${encodeURIComponent("Ber")}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ),
      { timeout: 2000 },
    );
    await attendiEffetti();
    expect(screen.getByText(/Nessun comune/i)).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("selezionando un comune trovato dalla ricerca ne mostra i dati e compila il CAP", async () => {
    const user = userEvent.setup();
    const bergamo = creaComune({
      id: 2,
      nome: "Bergamo",
      cap: "24100",
      pecComune: "comune@pec.it",
      nomeSindaco: null,
      provincia: {
        sigla: "BG",
        nome: "Bergamo",
        regione: { regione: "Lombardia", riferimentoLegge: "LR 31/2015" },
      },
    });
    instradaFetch({
      "/api/config/comuni?search=": () => Promise.resolve(okResponse({ comuni: [bergamo] })),
    });
    renderForm();
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/config/comuni",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await user.type(screen.getByPlaceholderText(/Cerca comune/i), "Bergamo");
    await user.click(await screen.findByText("Bergamo"));
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
    const box = screen.getByText("Comune selezionato:").closest("div");
    expect(box?.textContent).toContain("LR 31/2015");
    expect(box?.textContent).toContain("comune@pec.it");
    expect(screen.getByLabelText("CAP")).toHaveValue("24100");
  });

  it("nessun comune risulta selezionato finché l'utente non sceglie dalla lista", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune()] });
    renderForm();
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    expect(screen.queryByText("Comune selezionato:")).not.toBeInTheDocument();
    await user.click(screen.getByText("Milano"));
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
  });

  it("in modifica un comuneId presente nella lista mostra il comune selezionato", async () => {
    configuraFetch({
      comuni: [creaComune()],
      segnalazione: creaSegnalazione({ id: "s-comune-ok", comuneId: 1 }),
    });
    renderForm({ segnalazioneId: "s-comune-ok" });
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
  });

  it("riconosce il Comune esistente anche se la lista arriva dopo il dettaglio", async () => {
    let risolviComuni: (risposta: Response) => void = () => undefined;
    const elencoInAttesa = new Promise<Response>((resolve) => {
      risolviComuni = resolve;
    });
    mockFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("/api/config/comuni")) return elencoInAttesa;
      if (u === "/api/segnalazioni/s-lento") {
        return okResponse({ segnalazione: creaSegnalazione({ id: "s-lento", comuneId: 1 }) });
      }
      return okResponse({});
    });
    renderForm({ segnalazioneId: "s-lento" });
    await screen.findByDisplayValue("Via Test 1");
    expect(screen.queryByText("Comune selezionato:")).not.toBeInTheDocument();
    await act(async () => {
      risolviComuni(okResponse({ comuni: [creaComune()] }));
    });
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
  });

  it("in modifica un comuneId assente dalla lista non seleziona alcun comune", async () => {
    configuraFetch({
      comuni: [creaComune({ id: 1, nome: "Milano" })],
      segnalazione: creaSegnalazione({ id: "s-comune-mismatch", comuneId: 999 }),
    });
    renderForm({ segnalazioneId: "s-comune-mismatch" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Modifica segnalazione" })).toBeInTheDocument());
    await attendiEffetti();
    expect(screen.queryByText("Comune selezionato:")).not.toBeInTheDocument();
  });

  it("mostra il Comune salvato nel dettaglio anche se non appare nei risultati di ricerca", async () => {
    const segnalazione = creaSegnalazione({
      id: "s-comune-dettaglio",
      comuneId: 999,
      cap: "27029",
      comune: { id: 999, nome: "Vigevano", cap: "27029", pecComune: "vigevano@pec.it", nomeSindaco: null },
      provincia: { id: 2, sigla: "PV", nome: "Pavia" },
      regione: { id: 1, regione: "LOMBARDIA", riferimentoLegge: "LR 31/2015" },
    });
    configuraFetch({ comuni: [creaComune()], segnalazione });
    renderForm({ segnalazioneId: segnalazione.id });
    const box = await screen.findByText("Comune selezionato:");
    expect(box.closest("div")?.textContent).toContain("Vigevano (PV)");
    expect(screen.getByLabelText("CAP")).toHaveValue("27029");
  });

  it("in modifica con CAP vuoto il CAP viene compilato dal comune selezionato", async () => {
    const segnalazione = creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u-test",
      comuneId: 1,
      cap: "",
    } as never);
    configuraFetch({ comuni: [creaComune()], segnalazione });
    renderForm({ segnalazioneId: "s1", user: creaUser({ id: "u-test" }) });
    await waitFor(() => expect(screen.getByDisplayValue(String(creaComune().cap))).toBeInTheDocument());
  });

  it("in modifica, un comune senza sindaco usa il nome del comune come destinatario", async () => {
    configuraFetch({
      comuni: [creaComune({ nomeSindaco: null })],
      segnalazione: creaSegnalazione({
        id: "s1",
        stato: "bozza",
        volontarioId: "u-test",
        comuneId: 1,
        destinatarioNome: null,
      } as never),
    });
    renderForm({
      segnalazioneId: "s1",
      user: creaUser({ id: "u-test", ruolo: "referente_provinciale", provinciaId: 1 }),
    });
    await waitFor(() => expect(screen.getByDisplayValue("Comune di Milano")).toBeInTheDocument());
  });

  it("con campi già compilati la selezione del comune non sovrascrive destinatario, oggetto e testo", async () => {
    const user = userEvent.setup();
    const segnalazione = creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u-test",
      comuneId: 1,
      cap: "20100",
      destinatarioNome: "Destinatario già scritto",
      oggettoPec: "Oggetto già scritto",
      testoIntroduttivoPec: "Testo già scritto",
    } as never);
    configuraFetch({ comuni: [creaComune()], segnalazione });
    renderForm({
      segnalazioneId: "s1",
      user: creaUser({ id: "u-test", ruolo: "referente_provinciale", provinciaId: 1 }),
    });
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(screen.getByText("Milano"));
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Destinatario già scritto")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Oggetto già scritto")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Testo già scritto")).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Caricamento e recidiva con risposte anomale
// -----------------------------------------------------------------------------

describe("FormSegnalazione - caricamento con risposte anomale", () => {
  it("modifica: errore con corpo non JSON mostra il toast di caricamento con il messaggio di ripiego", async () => {
    instradaFetch({ "/api/segnalazioni/s1": () => Promise.resolve(rispostaNonJson(false)) });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Caricamento non riuscito",
          description: "La segnalazione non è stata caricata.",
          variant: "destructive",
        }),
      ),
    );
  });

  it("modifica: risposta OK con corpo non JSON impedisce il salvataggio", async () => {
    instradaFetch({ "/api/segnalazioni/s1": () => Promise.resolve(rispostaNonJson(true)) });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.queryByText("Caricamento…")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Modifica segnalazione" })).toBeInTheDocument();
    expect(screen.getByLabelText("Indirizzo *")).toHaveValue("");
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Caricamento non riuscito" }));
    expect(screen.getByRole("button", { name: "Salva bozza" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Impossibile caricare");
  });

  it("recidiva: risposta di errore non mostra il box recidiva e non segnala errori", async () => {
    instradaFetch({ "/api/segnalazioni/prec": () => Promise.resolve(errorResponse(404, "non trovata")) });
    renderForm({ segnalazionePrecedenteId: "prec" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/prec");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("recidiva: risposta senza segnalazione non mostra il box recidiva", async () => {
    instradaFetch({ "/api/segnalazioni/prec": () => Promise.resolve(okResponse({})) });
    renderForm({ segnalazionePrecedenteId: "prec" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/prec");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("recidiva: corpo non JSON non mostra il box recidiva", async () => {
    instradaFetch({ "/api/segnalazioni/prec": () => Promise.resolve(invalidJsonResponse()) });
    renderForm({ segnalazionePrecedenteId: "prec" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/prec");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("recidiva: errore di rete non mostra il box recidiva", async () => {
    instradaFetch({ "/api/segnalazioni/prec-rotta": () => Promise.reject(new Error("rete assente")) });
    renderForm({ segnalazionePrecedenteId: "prec-rotta" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/prec-rotta");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
  });

  it("elenco comuni con corpo non JSON mostra il form senza toast", async () => {
    instradaFetch({ "/api/config/comuni": () => Promise.resolve(invalidJsonResponse()) });
    renderForm();
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/config/comuni",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByPlaceholderText("Cerca comune...")).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("elenco comuni con errore di rete lascia il form utilizzabile", async () => {
    const user = userEvent.setup();
    instradaFetch({ "/api/config/comuni": () => Promise.reject(new Error("rete assente")) });
    renderForm();
    await attendiEffetti();
    const indirizzo = screen.getByLabelText("Indirizzo *");
    await user.type(indirizzo, "Via Offline 1");
    expect(indirizzo).toHaveValue("Via Offline 1");
  });

  it("caricamento con rifiuto non Error mostra il messaggio generico", async () => {
    instradaFetch({ "/api/segnalazioni/s1": () => Promise.reject("rete non definita") });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Caricamento non riuscito", description: MESSAGGIO_GENERICO }),
      ),
    );
  });

  it("errore di caricamento con messaggio non stringa usa il messaggio di ripiego", async () => {
    instradaFetch({
      "/api/segnalazioni/s-err": () =>
        Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 42 }) } as unknown as Response),
    });
    renderForm({ segnalazioneId: "s-err" });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Caricamento non riuscito",
          description: "La segnalazione non è stata caricata.",
        }),
      ),
    );
  });

  it("errore di caricamento con messaggio stringa mostra il messaggio del server", async () => {
    instradaFetch({
      "/api/segnalazioni/s-str": () => Promise.resolve(errorResponse(403, "Accesso negato alla segnalazione")),
    });
    renderForm({ segnalazioneId: "s-str" });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Accesso negato alla segnalazione" }),
      ),
    );
  });
});

// -----------------------------------------------------------------------------
// Allegati: errori di caricamento, eliminazione e stati particolari
// -----------------------------------------------------------------------------

describe("FormSegnalazione - allegati con errori e stati particolari", () => {
  it("upload con errore di rete non Error mostra il messaggio di connessione", async () => {
    const user = userEvent.setup();
    instradaFetch({
      "/api/segnalazioni/s-rete": () =>
        Promise.resolve(okResponse({ segnalazione: creaSegnalazione({ id: "s-rete" }) })),
      "/api/upload": () => Promise.reject("Network error string"),
    });
    const { container } = renderForm({ segnalazioneId: "s-rete" });
    await waitFor(() => expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument());
    await user.upload(inputFile(container), new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Connessione non riuscita",
          description: "Verifica la connessione e riprova.",
        }),
      ),
    );
  });

  it.each([
    ["HTTP 400 con corpo JSON privo di error", () => rispostaErroreVuota(400)],
    ["HTTP 500 con corpo non JSON", () => rispostaNonJson(false)],
  ] as const)("upload con %s mostra il messaggio generico", async (_descrizione, risposta) => {
    const user = userEvent.setup();
    instradaFetch({
      "/api/segnalazioni/s-up": () => Promise.resolve(okResponse({ segnalazione: creaSegnalazione({ id: "s-up" }) })),
      "/api/upload": () => Promise.resolve(risposta()),
    });
    const { container } = renderForm({ segnalazioneId: "s-up" });
    await waitFor(() => expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument());
    await user.upload(inputFile(container), new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Caricamento allegato non riuscito",
          description: MESSAGGIO_GENERICO,
          variant: "destructive",
        }),
      ),
    );
  });

  it("una selezione file senza file non avvia alcun upload", async () => {
    instradaFetch({
      "/api/segnalazioni/s1": () => Promise.resolve(okResponse({ segnalazione: creaSegnalazione({ id: "s1" }) })),
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument());
    fireEvent.change(inputFile(container), { target: { files: [] } });
    expect(mockFetch.mock.calls.some((c) => c[0] === "/api/upload")).toBe(false);
  });

  it("eliminazione con errore di rete non Error mostra il messaggio di connessione", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1", allegati: [allegatoDiProva("a-rete", "rete.jpg")] as never });
    instradaFetch({
      "/api/segnalazioni/s1": () => Promise.resolve(okResponse({ segnalazione: seg })),
      "/api/allegati": () => Promise.reject("Network error"),
    });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByText("rete.jpg")).toBeInTheDocument());
    await rispondiConfermaAllegato(user, "rete.jpg", "Elimina allegato");
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Connessione non riuscita",
          description: "Verifica la connessione e riprova.",
        }),
      ),
    );
    expect(screen.getByText("rete.jpg")).toBeInTheDocument();
  });

  it.each([
    ["HTTP 403 con corpo JSON privo di error", () => rispostaErroreVuota(403)],
    ["HTTP 500 con corpo non JSON", () => rispostaNonJson(false)],
  ] as const)(
    "eliminazione con %s mostra il messaggio generico e mantiene l'allegato",
    async (_descrizione, risposta) => {
      const user = userEvent.setup();
      const seg = creaSegnalazione({ id: "s1", allegati: [allegatoDiProva("a-gen", "generico.jpg")] as never });
      instradaFetch({
        "/api/segnalazioni/s1": () => Promise.resolve(okResponse({ segnalazione: seg })),
        "/api/allegati": () => Promise.resolve(risposta()),
      });
      renderForm({ segnalazioneId: "s1" });
      await waitFor(() => expect(screen.getByText("generico.jpg")).toBeInTheDocument());
      await rispondiConfermaAllegato(user, "generico.jpg", "Elimina allegato");
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Eliminazione non riuscita",
            description: MESSAGGIO_GENERICO,
            variant: "destructive",
          }),
        ),
      );
      expect(screen.getByText("generico.jpg")).toBeInTheDocument();
    },
  );

  it("errore di eliminazione: il messaggio del server viene mostrato nel toast", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1", allegati: [allegatoDiProva("a-msg", "messaggio.jpg")] as never });
    instradaFetch({
      "/api/segnalazioni/s1": () => Promise.resolve(okResponse({ segnalazione: seg })),
      "/api/allegati": () => Promise.resolve(errorResponse(403, "Non autorizzato")),
    });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByText("messaggio.jpg")).toBeInTheDocument());
    await rispondiConfermaAllegato(user, "messaggio.jpg", "Elimina allegato");
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Eliminazione non riuscita", description: "Non autorizzato" }),
      ),
    );
  });

  it("l'Escape chiude la conferma di eliminazione allegato senza eliminare", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1", allegati: [allegatoDiProva("a-esc", "escape.jpg")] as never });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByText("escape.jpg")).toBeInTheDocument());
    vaiAlPasso("Allegati e invio");
    await user.click(screen.getByRole("button", { name: /Elimina allegato/i }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockFetch.mock.calls.some((c) => String(c[0]).startsWith("/api/allegati"))).toBe(false);
    expect(screen.getByText("escape.jpg")).toBeInTheDocument();
  });

  it("il tipo di allegato sconosciuto viene mostrato con il valore grezzo", async () => {
    const seg = creaSegnalazione({
      id: "s1",
      allegati: [allegatoDiProva("a-raw", "grezzo.bin", "tipo-sconosciuto")] as never,
    });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByText("grezzo.bin")).toBeInTheDocument());
    expect(screen.getByText("tipo-sconosciuto")).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Demo, GPS, salvataggio e segnalazioni collegate
// -----------------------------------------------------------------------------

describe("FormSegnalazione - demo, GPS e salvataggio con errori non Error", () => {
  it("in demo la modifica non interroga il server", async () => {
    isDemoMock.mockReturnValue(true);
    renderForm({ segnalazioneId: "s1", user: creaUserDemo() });
    await attendiEffetti();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/segnalazioni/s1");
  });

  it("in demo la recidiva non carica la segnalazione precedente", async () => {
    isDemoMock.mockReturnValue(true);
    renderForm({ segnalazionePrecedenteId: "prec", user: creaUserDemo() });
    await attendiEffetti();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/segnalazioni/prec");
  });

  it("durante la rilevazione GPS il pulsante mostra lo stato di attesa", async () => {
    const user = userEvent.setup();
    geoGetCurrentPosition.mockImplementation(() => {});
    renderForm();
    await user.click(await screen.findByRole("button", { name: /Rileva posizione GPS/i }));
    expect(screen.getByRole("button", { name: /Rilevazione in corso/i })).toBeInTheDocument();
  });

  it("salva con errore di rete non Error mostra il messaggio generico", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      if (u.startsWith("/api/config/comuni")) return okResponse({ comuni: [creaComune()] });
      if (u === "/api/segnalazioni" && method === "POST") {
        throw "errore di rete come stringa";
      }
      return okResponse({});
    });
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via String Error 1");
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Salvataggio non riuscito",
          description: MESSAGGIO_GENERICO,
          variant: "destructive",
        }),
      ),
    );
  });

  it("recidiva con errore di rete non Error non mostra il box recidiva", async () => {
    instradaFetch({ "/api/segnalazioni/prec-str": () => Promise.reject("rete assente") });
    renderForm({ segnalazionePrecedenteId: "prec-str" });
    await attendiEffetti();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/prec-str");
    expect(screen.queryByText("Segnalazione collegata per recidiva")).not.toBeInTheDocument();
  });

  it("selezione di un comune senza PEC né sindaco mostra PEC non configurata", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [creaComune({ nomeSindaco: null, pecComune: null })] });
    renderForm();
    await waitFor(() => expect(screen.getByText("Milano")).toBeInTheDocument());
    await user.click(screen.getByText("Milano"));
    await waitFor(() => expect(screen.getByText("Comune selezionato:")).toBeInTheDocument());
    expect(screen.getByText(/non ancora configurata/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Demo con segnalazione di prova e campo longitudine svuotato
// -----------------------------------------------------------------------------

describe("FormSegnalazione - demo con dati di prova e input numerici", () => {
  it("in demo la modifica di una segnalazione di prova precarica i dati demo senza chiamare il server", async () => {
    isDemoMock.mockReturnValue(true);
    renderForm({ segnalazioneId: "demo-1", user: creaUserDemo() });
    await waitFor(() => expect(screen.getByDisplayValue("Via dei Platani 4")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Capannone dismesso")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/segnalazioni/demo-1");
  });

  it("svuotando la longitudine il campo resta vuoto e non viene inviato un valore numerico", async () => {
    const user = userEvent.setup();
    const seg = creaSegnalazione({ id: "s1", longitudine: 9.5 });
    configuraFetch({ segnalazione: seg });
    renderForm({ segnalazioneId: "s1" });
    const lngInput = (await waitFor(() => screen.getByLabelText("Longitudine"))) as HTMLInputElement;
    await waitFor(() => expect(lngInput.value).toBe("9.5"));
    await user.clear(lngInput);
    expect(lngInput.value).toBe("");
  });
});

// -----------------------------------------------------------------------------
// Passi, riepilogo errori e auto-salvataggio
// -----------------------------------------------------------------------------

describe("FormSegnalazione - passi, riepilogo errori e auto-salvataggio", () => {
  const MESSAGGIO_INDIRIZZO = "Inserisci l'indirizzo della pratica per continuare.";

  it("Continua non passa oltre senza indirizzo e collega l'errore al campo", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect((await screen.findAllByText(MESSAGGIO_INDIRIZZO)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Indirizzo *")).toHaveAttribute("aria-invalid", "true");
    // Resta sul primo passo: il precedente è disabilitato.
    expect(screen.getByRole("button", { name: "Passo precedente" })).toBeDisabled();
  });

  it("Continua avanza di passo con l'indirizzo compilato e nell'ultimo passo non compare", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 1");
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect(screen.getByRole("button", { name: "Passo precedente" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect(screen.getByRole("button", { name: "Passo precedente" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Continua" })).not.toBeInTheDocument();
  });

  it("il riepilogo errori porta al campo indirizzo e digitare cancella l'errore", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /Salva ed esci alla lista/i }));
    const collegamento = (await screen.findAllByRole("button", { name: MESSAGGIO_INDIRIZZO }))[0];
    await user.click(collegamento);
    const campo = screen.getByLabelText("Indirizzo *");
    expect(campo).toHaveFocus();
    await user.type(campo, "V");
    await waitFor(() => {
      expect(screen.queryAllByText(MESSAGGIO_INDIRIZZO)).toHaveLength(0);
    });
  });

  it("la sola apertura della pratica non invia un PUT automatico", async () => {
    configuraFetch({
      segnalazione: creaSegnalazione({
        id: "s-intatta",
        cap: "20121",
        destinatarioNome: "Sindaco",
        oggettoPec: "Oggetto",
        testoIntroduttivoPec: "Introduzione",
      }),
    });
    renderForm({ segnalazioneId: "s-intatta" });
    await screen.findByDisplayValue("Via Test 1");
    await screen.findByText("Comune selezionato:");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2150));
    });
    expect(mockFetch.mock.calls.some((c) => c[0] === "/api/segnalazioni/s-intatta" && c[1]?.method === "PUT")).toBe(
      false,
    );
  });

  it("l'auto-salvataggio aggiorna in silenzio una bozza esistente dopo una breve pausa", async () => {
    configuraFetch({ segnalazione: creaSegnalazione({ id: "s-edit", indirizzoVia: "Via Auto 1" }) });
    const user = userEvent.setup();
    renderForm({ segnalazioneId: "s-edit" });
    await user.type(await screen.findByDisplayValue("Via Auto 1"), " bis");
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-edit", expect.objectContaining({ method: "PUT" }));
      },
      { timeout: 4000 },
    );
    // Il salvataggio automatico non mostra il toast di conferma.
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Bozza salvata" }));
    await waitFor(() => {
      expect(screen.getByText(/Bozza salvata alle/)).toBeInTheDocument();
    });
  });

  it("non avvia l'autosalvataggio senza il Comune obbligatorio", async () => {
    configuraFetch({ segnalazione: creaSegnalazione({ id: "s-senza-comune", comuneId: null }) });
    const user = userEvent.setup();
    renderForm({ segnalazioneId: "s-senza-comune" });
    await user.type(await screen.findByDisplayValue("Via Test 1"), " bis");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2150));
    });
    expect(
      mockFetch.mock.calls.some((c) => c[0] === "/api/segnalazioni/s-senza-comune" && c[1]?.method === "PUT"),
    ).toBe(false);
  });

  it("un errore dell'auto-salvataggio resta silenzioso e lo stato mostra come riprovare", async () => {
    configuraFetch({ segnalazione: creaSegnalazione({ id: "s-edit", indirizzoVia: "Via Auto 2" }) });
    const instradato = mockFetch.getMockImplementation() ?? (async () => okResponse({}));
    mockFetch.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return errorResponse(500, "Errore server");
      return instradato(url, init);
    });
    const user = userEvent.setup();
    renderForm({ segnalazioneId: "s-edit" });
    await user.type(await screen.findByDisplayValue("Via Auto 2"), " bis");
    await waitFor(
      () => {
        expect(screen.getByText("Salvataggio non riuscito. Usa Salva per riprovare.")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Salvataggio non riuscito" }));
    const tentativi = mockFetch.mock.calls.filter((c) => c[1]?.method === "PUT").length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
    });
    expect(mockFetch.mock.calls.filter((c) => c[1]?.method === "PUT")).toHaveLength(tentativi);
  });

  it("svuotare l'indirizzo non avvia l'auto-salvataggio", async () => {
    configuraFetch({ segnalazione: creaSegnalazione({ id: "s-edit", indirizzoVia: "Via Auto 3" }) });
    const user = userEvent.setup();
    renderForm({ segnalazioneId: "s-edit" });
    await user.clear(await screen.findByDisplayValue("Via Auto 3"));
    await act(async () => {
      await new Promise((risolvi) => setTimeout(risolvi, 2300));
    });
    const invii = mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(invii).toHaveLength(0);
  });
});

describe("FormSegnalazione - navigazione tra i passi", () => {
  it("Passo precedente riporta al passo Luogo e cliccare il passo attivo lo lascia invariato", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Indirizzo *"), "Via Roma 9");
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect(screen.getByRole("button", { name: "Passo precedente" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Passo precedente" }));
    expect(screen.getByLabelText("Indirizzo *")).toHaveValue("Via Roma 9");
    // Clic sul passo già attivo: nessun cambio di passo.
    await user.click(screen.getByRole("button", { name: /Luogo/ }));
    expect(screen.getByRole("button", { name: "Passo precedente" })).toBeDisabled();
    expect(screen.getByLabelText("Indirizzo *")).toHaveValue("Via Roma 9");
  });
});

describe("FormSegnalazione - indicazioni di compilazione", () => {
  it("spiega che i campi contrassegnati con asterisco sono obbligatori", async () => {
    configuraFetch({ comuni: [] });
    renderForm();
    await act(async () => {});
    expect(screen.getByText(/sono obbligatori/)).toBeInTheDocument();
  });

  it("cita il testo cercato quando la ricerca del comune non trova nulla", async () => {
    const user = userEvent.setup();
    configuraFetch({ comuni: [] });
    renderForm();
    await user.type(screen.getByPlaceholderText("Cerca comune..."), "Xyz");
    expect(await screen.findByText(/Nessun comune trovato per "Xyz"/)).toBeInTheDocument();
  });

  it("riporta il riferimento normativo nel dettaglio, fuori dall'etichetta della casella", async () => {
    configuraFetch({ comuni: [] });
    renderForm();
    await act(async () => {});
    const etichetta = screen.getByText(
      "Elevati fenomeni di abbagliamento e pericolo per il traffico pedonale e stradale",
    );
    expect(etichetta.tagName).toBe("LABEL");
    expect(etichetta.textContent).not.toContain("art. 23");
    expect(screen.getByText("Vietati anche ai sensi dell'art. 23 del Codice della Strada.")).toBeInTheDocument();
  });
});

describe("versioni delle risposte allegati", () => {
  it.each([{}, { allegato: {} }])("non inserisce allegati da una risposta incompleta: %j", async (risposta) => {
    const user = userEvent.setup();
    instradaFetch({
      "/api/segnalazioni/s1": () =>
        Promise.resolve(okResponse({ segnalazione: creaSegnalazione({ id: "s1", updatedAt: undefined as never }) })),
      "/api/upload": () => Promise.resolve(okResponse(risposta)),
    });
    const { container } = renderForm({ segnalazioneId: "s1" });
    await waitFor(() => expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument());
    await user.upload(inputFile(container), new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Connessione non riuscita" })),
    );
  });
  it.each([true, false])(
    "recepisce la versione allegato prima della cancellazione, JSON valido: %s",
    async (jsonValido) => {
      const user = userEvent.setup();
      const versione = "2026-01-01T00:00:00.123Z";
      instradaFetch({
        "/api/segnalazioni/s1": () =>
          Promise.resolve(okResponse({ segnalazione: creaSegnalazione({ id: "s1", updatedAt: undefined as never }) })),
        "/api/upload": () =>
          Promise.resolve(
            okResponse({ allegato: allegatoDiProva("a1", "foto.jpg"), updatedAt: jsonValido ? versione : undefined }),
          ),
        "/api/allegati": () =>
          Promise.resolve(jsonValido ? okResponse({ ok: true, updatedAt: versione }) : rispostaNonJson(true)),
      });
      const { container } = renderForm({ segnalazioneId: "s1" });
      await waitFor(() => expect(screen.getByDisplayValue("Via Test 1")).toBeInTheDocument());
      await user.upload(inputFile(container), new File(["x"], "foto.jpg", { type: "image/jpeg" }));
      await waitFor(() => expect(screen.getByText("foto.jpg")).toBeInTheDocument());
      await rispondiConfermaAllegato(user, "foto.jpg", "Elimina allegato");
      await waitFor(() => expect(screen.queryByText("foto.jpg")).not.toBeInTheDocument());
      const chiamata = mockFetch.mock.calls.find(([url]) => String(url).startsWith("/api/allegati"));
      expect(chiamata?.[1]?.headers).toEqual(jsonValido ? { "If-Match": JSON.stringify(versione) } : undefined);
    },
  );
});
