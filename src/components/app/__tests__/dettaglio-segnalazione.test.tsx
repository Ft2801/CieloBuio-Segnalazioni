/**
 * Test di rendering e interazione per DettaglioSegnalazione.
 *
 * Si coprono: caricamento iniziale, errori di rete, modalita demo,
 * rendering condizionale di ciascun ramo (stato, ruolo, includiArpa,
 * allegati, storico, coordinate, notaRifiuto, livelloRecidiva,
 * mittenteVisibile, ecc.) e interazioni utente (invia in revisione,
 * approva, rifiuta con nota, simula PEC, invia PEC reale, cambia stato,
 * elimina bozza, anteprima lettera, recidiva) con relativi percorsi
 * di successo ed errore. Si verifica anche la competenza territoriale
 * dei referenti e il blocco delle azioni in modalita demo.
 *
 * Autore: Fabio Tempera (2026)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser, Segnalazione, StatoSegnalazione, StoricoStato, Allegato } from "@/lib/types";
import { DettaglioSegnalazione } from "@/components/app/dettaglio-segnalazione";

// -----------------------------------------------------------------------------
// Polyfill per jsdom: Radix Select/Dialog usano hasPointerCapture,
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

// Toast mockato: ogni test puo ispezionare le chiamate a toast tramite
// toastSpy.mock.calls.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Demo mode mockato: di default isDemoSession ritorna false. I test che
// devono verificare il ramo demo possono impostare isDemoMock.mockReturnValue(true).
const isDemoMock = vi.fn<(u: unknown) => boolean>(() => false);
const guardDemoMock = vi.fn<(u: unknown) => void>();
vi.mock("@/lib/demo-mode", () => ({
  isDemoSession: (u: unknown) => isDemoMock(u),
  guardDemoReadOnly: (u: unknown) => guardDemoMock(u),
  DEMO_READONLY_MESSAGE: "demo readonly",
}));

// window.open stub (usato da "Anteprima lettera" e "Lettera con allegati")
const openSpy = vi.fn();
vi.stubGlobal("open", openSpy);

// window.confirm stub (usato da "Invia PEC" e "Elimina bozza")
const confirmSpy = vi.fn();
vi.stubGlobal("confirm", confirmSpy);

// fetch globale: ogni test configura mockResolvedValueOnce o mockImplementation.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

function creaAllegato(overrides: Partial<Allegato> & { id: string }): Allegato {
  const base: Allegato = {
    id: overrides.id,
    segnalazioneId: "s1",
    tipo: "foto",
    urlStorage: "/storage/x",
    nomeOriginale: "file.jpg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

function creaStorico(overrides: Partial<StoricoStato> & { id: string }): StoricoStato {
  const base: StoricoStato = {
    id: overrides.id,
    segnalazioneId: "s1",
    statoPrecedente: null,
    statoNuovo: "bozza",
    userId: "u1",
    timestamp: "2026-01-01T00:00:00.000Z",
    nota: null,
    user: { id: "u1", nomeCognome: "Mario Rossi", ruolo: "volontario" },
  };
  return { ...base, ...overrides };
}

// Helper per costruire una Segnalazione completa con valori sensati.
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

// Risposta fetch che lancia durante json() (per testare il catch in carica).
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

// Configura mockFetch per rispondere con una segnalazione al primo GET.
// Utile per il rendering iniziale.
function mockCaricamentoIniziale(seg: Segnalazione | null) {
  mockFetch.mockResolvedValueOnce(okResponse({ segnalazione: seg }));
}

// Renderizza il componente con props di default.
function renderDettaglio(
  id: string,
  user: SessionUser,
  props: Partial<{
    onBack: () => void;
    onApriModifica: (id: string) => void;
    onNuovaRecidiva: (idPrecedente: string) => void;
    onAggiornata: () => void;
  }> = {}
) {
  return render(
    <DettaglioSegnalazione
      id={id}
      user={user}
      onBack={props.onBack ?? vi.fn()}
      onApriModifica={props.onApriModifica ?? vi.fn()}
      onNuovaRecidiva={props.onNuovaRecidiva ?? vi.fn()}
      onAggiornata={props.onAggiornata ?? vi.fn()}
    />
  );
}

// Attende che il componente abbia terminato il caricamento iniziale
// (la parola "Caricamento" scompare dal DOM).
async function attendiCaricamento() {
  await waitFor(() => {
    expect(screen.queryByText("Caricamento…")).not.toBeInTheDocument();
  });
}

// -----------------------------------------------------------------------------
// Reset comuni prima di ogni test
// -----------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
  openSpy.mockReset();
  confirmSpy.mockReset();
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
// Caricamento e stati di errore
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - caricamento e stati di errore", () => {
  it("mostra lo stato di caricamento iniziale", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // mai risolta
    renderDettaglio("s1", creaUser());
    expect(screen.getByText("Caricamento…")).toBeInTheDocument();
  });

  it("mostra 'Segnalazione non trovata' quando il server ritorna null", async () => {
    mockCaricamentoIniziale(null);
    renderDettaglio("s-mancante", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Segnalazione non trovata")).toBeInTheDocument();
  });

  it("mostra il pulsante Indietro anche nello stato 'non trovata'", async () => {
    mockCaricamentoIniziale(null);
    renderDettaglio("s-mancante", creaUser());
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Indietro/i })).toBeInTheDocument();
  });

  it("chiama onBack dal pulsante Indietro nello stato 'non trovata'", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    mockCaricamentoIniziale(null);
    renderDettaglio("s-mancante", creaUser(), { onBack });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Indietro/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("gestisce il fallimento del fetch iniziale senza crashare", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    renderDettaglio("s-err", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Segnalazione non trovata")).toBeInTheDocument();
  });

  it("gestisce risposta json non valida in carica (catch ritorna {})", async () => {
    mockFetch.mockResolvedValueOnce(invalidJsonResponse());
    renderDettaglio("s-badjson", creaUser());
    await attendiCaricamento();
    // data.segnalazione e undefined -> segnalazione resta null
    expect(screen.getByText("Segnalazione non trovata")).toBeInTheDocument();
  });

  it("effettua GET /api/segnalazioni/[id] al montaggio", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s-fetch" }));
    renderDettaglio("s-fetch", creaUser());
    await attendiCaricamento();
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s-fetch");
  });
});

// -----------------------------------------------------------------------------
// Modalita demo
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - modalita demo", () => {
  it("usa getDemoSegnalazione senza chiamare fetch", async () => {
    isDemoMock.mockReturnValue(true);
    renderDettaglio("demo-1", creaUserDemo({ ruolo: "volontario" }));
    await attendiCaricamento();
    // demo-1 ha indirizzo "Via dei Platani 4" e nomeEsercizio "Capannone dismesso"
    expect(screen.getByText("Via dei Platani 4")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("mostra 'Segnalazione non trovata' se la demo non ha la segnalazione richiesta", async () => {
    isDemoMock.mockReturnValue(true);
    renderDettaglio("demo-inesistente", creaUserDemo({ ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.getByText("Segnalazione non trovata")).toBeInTheDocument();
  });

  it("ricarica dal demo data quando id cambia", async () => {
    isDemoMock.mockReturnValue(true);
    const { rerender } = renderDettaglio("demo-1", creaUserDemo({ ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.getByText("Via dei Platani 4")).toBeInTheDocument();
    // Cambio id: la funzione carica viene rieseguita con nuovo id
    rerender(
      <DettaglioSegnalazione
        id="demo-4"
        user={creaUserDemo({ ruolo: "volontario" })}
        onBack={vi.fn()}
        onApriModifica={vi.fn()}
        onNuovaRecidiva={vi.fn()}
        onAggiornata={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Via dell'Industria 5")).toBeInTheDocument();
    });
  });
});

// -----------------------------------------------------------------------------
// Rendering header, badge stato, recidiva
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - header è stato", () => {
  it("mostra il numeroProtocollo come titolo quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      numeroProtocollo: "20260101-TT-X-XX01",
      stato: "inviata",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByRole("heading", { name: "20260101-TT-X-XX01" })).toBeInTheDocument();
  });

  it("mostra 'Bozza senza protocollo' come titolo quando numeroProtocollo è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", numeroProtocollo: null }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByRole("heading", { name: "Bozza senza protocollo" })).toBeInTheDocument();
  });

  it("mostra l'etichetta dello stato corrente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", stato: "in_revisione" }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("In revisione")).toBeInTheDocument();
  });

  it("mostra il badge 'Recidiva livello N' quando livelloRecidiva > 1", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      livelloRecidiva: 3,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/Recidiva livello 3/i)).toBeInTheDocument();
  });

  it("non mostra il badge Recidiva quando livelloRecidiva = 1", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", livelloRecidiva: 1 }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText(/Recidiva livello/i)).not.toBeInTheDocument();
  });

  it("chiama onBack dal pulsante Indietro principale", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1" }));
    renderDettaglio("s1", creaUser(), { onBack });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Indietro/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// notaRifiuto
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - notaRifiuto", () => {
  it("mostra la card 'Rifiutata dal referente' con la nota quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      notaRifiuto: "Mancano le foto dell'impianto",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Rifiutata dal referente")).toBeInTheDocument();
    expect(screen.getByText("Mancano le foto dell'impianto")).toBeInTheDocument();
  });

  it("non mostra la card 'Rifiutata dal referente' quando notaRifiuto è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", notaRifiuto: null }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Rifiutata dal referente")).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Azioni volontario su bozza (isOwner)
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - azioni volontario su bozza", () => {
  function setupBozzaOwner() {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u1",
    }));
  }

  it("mostra Modifica, Invia in revisione, Elimina bozza per owner su bozza", async () => {
    setupBozzaOwner();
    renderDettaglio("s1", creaUser({ id: "u1", ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Modifica/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invia in revisione/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Elimina bozza/i })).toBeInTheDocument();
  });

  it("non mostra Modifica se l'utente non è il proprietario", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "altro-user",
    }));
    renderDettaglio("s1", creaUser({ id: "u1", ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /^Modifica$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Invia in revisione/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Elimina bozza/i })).not.toBeInTheDocument();
  });

  it("chiama onApriModifica con l'id al click del pulsante Modifica", async () => {
    const user = userEvent.setup();
    const onApriModifica = vi.fn();
    setupBozzaOwner();
    renderDettaglio("s1", creaUser({ id: "u1" }), { onApriModifica });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Modifica/i }));
    expect(onApriModifica).toHaveBeenCalledWith("s1");
  });

  it("invia in revisione con successo: POST /cambia-stato stato=in_revisione", async () => {
    const user = userEvent.setup();
    const onAggiornata = vi.fn();
    setupBozzaOwner();
    // Risposte fetch in sequenza: 1) caricamento iniziale (già configurato),
    // 2) POST cambia-stato, 3) ricarica segnalazione dopo azione.
    mockFetch
      .mockResolvedValueOnce(okResponse({ ok: true })) // POST cambia-stato
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "in_revisione" }) }));
    renderDettaglio("s1", creaUser({ id: "u1" }), { onAggiornata });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia in revisione/i }));
    await waitFor(() => expect(onAggiornata).toHaveBeenCalled());
    // Verifica URL e body della POST
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/cambia-stato"
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(call![1].body)).toEqual({ stato: "in_revisione" });
    // Toast di successo
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Inviata in revisione" })
    );
  });

  it("invia in revisione con fallimento HTTP: toast errore", async () => {
    const user = userEvent.setup();
    setupBozzaOwner();
    mockFetch.mockResolvedValueOnce(errorResponse(400, "Stato non valido"));
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia in revisione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Stato non valido", variant: "destructive" })
      )
    );
  });

  it("elimina bozza con successo dopo confirm true: DELETE e onBack", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    setupBozzaOwner();
    confirmSpy.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(okResponse({ ok: true })); // DELETE
    renderDettaglio("s1", creaUser({ id: "u1" }), { onBack });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Elimina bozza/i }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1" && c[1]?.method === "DELETE"
    );
    expect(call).toBeDefined();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Bozza eliminata" }));
  });

  it("non elimina la bozza se confirm ritorna false", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    setupBozzaOwner();
    confirmSpy.mockReturnValue(false);
    renderDettaglio("s1", creaUser({ id: "u1" }), { onBack });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Elimina bozza/i }));
    // Nessuna DELETE effettuata
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1" && c[1]?.method === "DELETE"
    );
    expect(call).toBeUndefined();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("elimina bozza con fallimento HTTP: toast errore", async () => {
    const user = userEvent.setup();
    setupBozzaOwner();
    confirmSpy.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(errorResponse(403, "Non autorizzato"));
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Elimina bozza/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Non autorizzato", variant: "destructive" })
      )
    );
  });
});

// -----------------------------------------------------------------------------
// Azioni referente su in_revisione
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - azioni referente su in_revisione", () => {
  function setupInRevisione() {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    }));
  }

  it("mostra Modifica, Approva, Rifiuta con nota per referente provinciale competente", async () => {
    setupInRevisione();
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Modifica/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rifiuta con nota/i })).toBeInTheDocument();
  });

  it("chiama onApriModifica al click del pulsante Modifica (referente)", async () => {
    const user = userEvent.setup();
    const onApriModifica = vi.fn();
    setupInRevisione();
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }), { onApriModifica });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Modifica/i }));
    expect(onApriModifica).toHaveBeenCalledWith("s1");
  });

  it("approva con successo: POST /approva, toast e onAggiornata", async () => {
    const user = userEvent.setup();
    const onAggiornata = vi.fn();
    setupInRevisione();
    mockFetch
      .mockResolvedValueOnce(okResponse({ ok: true })) // POST approva
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "approvata" }) }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }), { onAggiornata });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Approva/i }));
    await waitFor(() => expect(onAggiornata).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith("/api/segnalazioni/s1/approva", { method: "POST" });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Approvata" })
    );
  });

  it("approva con fallimento: toast errore con messaggio server", async () => {
    const user = userEvent.setup();
    setupInRevisione();
    mockFetch.mockResolvedValueOnce(errorResponse(403, "Non competente"));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Approva/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Non competente", variant: "destructive" })
      )
    );
  });

  it("rifiuta con successo: POST /rifiuta con nota, chiude dialog e resetta", async () => {
    const user = userEvent.setup();
    const onAggiornata = vi.fn();
    setupInRevisione();
    mockFetch
      .mockResolvedValueOnce(okResponse({ ok: true })) // POST rifiuta
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "bozza" }) }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }), { onAggiornata });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    // Dialog aperto
    const textarea = await screen.findByPlaceholderText(/Mancano le foto/i);
    await user.type(textarea, "Foto mancanti");
    await user.click(screen.getByRole("button", { name: /Conferma rifiuto/i }));
    await waitFor(() => expect(onAggiornata).toHaveBeenCalled());
    // Body contiene la nota
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/rifiuta"
    );
    expect(call).toBeDefined();
    expect(JSON.parse(call![1].body)).toEqual({ nota: "Foto mancanti" });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Rifiutata" })
    );
  });

  it("rifiuta senza nota: mostra toast 'Nota obbligatoria' e non chiama fetch", async () => {
    const user = userEvent.setup();
    setupInRevisione();
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    const btnConferma = await screen.findByRole("button", { name: /Conferma rifiuto/i });
    await user.click(btnConferma);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Nota obbligatoria", variant: "destructive" })
      )
    );
    // Nessuna POST verso /rifiuta
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/rifiuta"
    );
    expect(call).toBeUndefined();
  });

  it("rifiuta con fallimento HTTP: toast errore", async () => {
    const user = userEvent.setup();
    setupInRevisione();
    mockFetch.mockResolvedValueOnce(errorResponse(500, "DB down"));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    const textarea = await screen.findByPlaceholderText(/Mancano le foto/i);
    await user.type(textarea, "Nota valida");
    await user.click(screen.getByRole("button", { name: /Conferma rifiuto/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "DB down", variant: "destructive" })
      )
    );
  });

  it("chiude il dialog rifiuto cliccando Annulla", async () => {
    const user = userEvent.setup();
    setupInRevisione();
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 1,
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    const annulla = await screen.findByRole("button", { name: /Annulla/i });
    await user.click(annulla);
    // Dialog chiuso: il placeholder non è più visibile
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Mancano le foto/i)).not.toBeInTheDocument();
    });
  });

  it("admin vede i pulsanti di revisione (competenza universale)", async () => {
    setupInRevisione();
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Approva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rifiuta con nota/i })).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Azioni su approvata: Simula spedizione + Invia PEC
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - azioni su approvata", () => {
  function setupApprovata() {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "approvata",
      volontarioId: "v1",
      provinciaId: 1,
      regioneId: 1,
    }));
  }

  it("mostra Simula spedizione e Invia PEC per admin su approvata", async () => {
    setupApprovata();
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Simula spedizione/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invia PEC/i })).toBeInTheDocument();
  });

  it("mostra il testo informativo sulla simulazione", async () => {
    setupApprovata();
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByText(/La simulazione invia una PEC di prova solo al mittente/i)).toBeInTheDocument();
  });

  it("simula PEC con successo (emailInviata=true): toast 'Simulazione inviata'", async () => {
    const user = userEvent.setup();
    setupApprovata();
    mockFetch.mockResolvedValueOnce(okResponse({
      ok: true,
      emailInviata: true,
      messaggio: "Email di prova inviata",
      numeroProtocollo: "PROTO-1",
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Simula spedizione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Simulazione inviata",
          description: "Email di prova inviata. Protocollo: PROTO-1",
          duration: 6000,
        })
      )
    );
  });

  it("simula PEC con successo (emailInviata=false): toast 'Simulazione registrata'", async () => {
    const user = userEvent.setup();
    setupApprovata();
    mockFetch.mockResolvedValueOnce(okResponse({
      ok: true,
      emailInviata: false,
      messaggio: "Registrata senza invio",
      numeroProtocollo: "PROTO-2",
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Simula spedizione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Simulazione registrata" })
      )
    );
  });

  it("simula PEC con fallimento: toast errore", async () => {
    const user = userEvent.setup();
    setupApprovata();
    mockFetch.mockResolvedValueOnce(errorResponse(400, "Stato non approvato"));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Simula spedizione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Stato non approvato" })
      )
    );
  });

  it("non invia PEC reale se confirm ritorna false", async () => {
    const user = userEvent.setup();
    setupApprovata();
    confirmSpy.mockReturnValue(false);
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/invia-pec"
    );
    expect(call).toBeUndefined();
  });

  it("invia PEC reale con successo e destinatari array", async () => {
    const user = userEvent.setup();
    const onAggiornata = vi.fn();
    setupApprovata();
    confirmSpy.mockReturnValue(true);
    mockFetch
      .mockResolvedValueOnce(okResponse({
        ok: true,
        numeroProtocollo: "PROTO-3",
        destinatari: ["a@b.it", "c@d.it"],
      }))
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "inviata" }) }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }), { onAggiornata });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() => expect(onAggiornata).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "PEC inviata",
        description: "Protocollo PROTO-3. Destinatari: a@b.it, c@d.it",
      })
    );
  });

  it("invia PEC reale con destinatari non array: mostra 'n/d'", async () => {
    const user = userEvent.setup();
    setupApprovata();
    confirmSpy.mockReturnValue(true);
    mockFetch
      .mockResolvedValueOnce(okResponse({
        ok: true,
        numeroProtocollo: "PROTO-4",
        destinatari: null,
      }))
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "inviata" }) }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Protocollo PROTO-4. Destinatari: n/d",
        })
      )
    );
  });

  it("invia PEC reale con numeroProtocollo null: mostra 'n/d'", async () => {
    const user = userEvent.setup();
    setupApprovata();
    confirmSpy.mockReturnValue(true);
    mockFetch
      .mockResolvedValueOnce(okResponse({
        ok: true,
        numeroProtocollo: null,
        destinatari: ["a@b.it"],
      }))
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "inviata" }) }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Protocollo n/d. Destinatari: a@b.it",
        })
      )
    );
  });

  it("invia PEC reale con risposta json invalida: 'Errore sconosciuto'", async () => {
    const user = userEvent.setup();
    setupApprovata();
    confirmSpy.mockReturnValue(true);
    // json() lancia -> data = {} -> error undefined -> "Errore sconosciuto"
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("invalid");
      },
      text: async () => "",
    } as unknown as Response);
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Errore sconosciuto", variant: "destructive" })
      )
    );
  });

  it("invia PEC reale con fallimento HTTP e messaggio: toast errore", async () => {
    const user = userEvent.setup();
    setupApprovata();
    confirmSpy.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(errorResponse(403, "Non competente"));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Non competente", variant: "destructive" })
      )
    );
  });
});

// -----------------------------------------------------------------------------
// Cambio stato manuale (admin/referente)
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - cambio stato manuale", () => {
  function setupInAttesa() {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
  }

  it("mostra il pulsante Cambia stato quando ci sono transizioni lecite", async () => {
    setupInAttesa();
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Cambia stato/i })).toBeInTheDocument();
  });

  it("non mostra il pulsante Cambia stato per stati terminali (chiusa_positiva)", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "chiusa_positiva",
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Cambia stato/i })).not.toBeInTheDocument();
  });

  it("apre il dialog cambio stato con il primo stato lecito preselezionato", async () => {
    const user = userEvent.setup();
    setupInAttesa();
    // in_attesa -> ["chiusa_positiva", "chiusa_negativa", "inviata"]
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    // Dialog aperto
    expect(await screen.findByText("Cambia stato della segnalazione")).toBeInTheDocument();
    // Il trigger del Select mostra il primo stato lecito: "Chiusa positiva".
    // Radix Select puo renderizzare anche gli item nel DOM (nascosti):
    // si usa getAllByText per tollerare più match.
    expect(screen.getAllByText("Chiusa positiva").length).toBeGreaterThan(0);
  });

  it("conferma cambio stato con successo: POST /cambia-stato con stato e nota null", async () => {
    const user = userEvent.setup();
    const onAggiornata = vi.fn();
    setupInAttesa();
    mockFetch
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "chiusa_positiva" }) }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }), { onAggiornata });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const conferma = await screen.findByRole("button", { name: /^Conferma$/i });
    await user.click(conferma);
    await waitFor(() => expect(onAggiornata).toHaveBeenCalled());
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/cambia-stato"
    );
    expect(call).toBeDefined();
    // Body ha stato="chiusa_positiva" (primo della lista) e nota=null (vuoto)
    expect(JSON.parse(call![1].body)).toEqual({
      stato: "chiusa_positiva",
      nota: null,
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Stato aggiornato",
        description: "Nuovo stato: Chiusa positiva",
      })
    );
  });

  it("conferma cambio stato con nota opzionale compilata", async () => {
    const user = userEvent.setup();
    setupInAttesa();
    mockFetch
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "chiusa_positiva" }) }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const notaTextarea = await screen.findByLabelText(/Nota \(opzionale\)/i);
    await user.type(notaTextarea, "Impianto adeguato");
    await user.click(screen.getByRole("button", { name: /^Conferma$/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Stato aggiornato" })
      )
    );
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/s1/cambia-stato"
    );
    expect(JSON.parse(call![1].body)).toEqual({
      stato: "chiusa_positiva",
      nota: "Impianto adeguato",
    });
  });

  it("cambio stato con fallimento: toast errore", async () => {
    const user = userEvent.setup();
    setupInAttesa();
    mockFetch.mockResolvedValueOnce(errorResponse(400, "Transizione non lecita"));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const conferma = await screen.findByRole("button", { name: /^Conferma$/i });
    await user.click(conferma);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "Transizione non lecita" })
      )
    );
  });

  it("chiude il dialog cambio stato cliccando Annulla", async () => {
    const user = userEvent.setup();
    setupInAttesa();
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const annulla = await screen.findByRole("button", { name: /Annulla/i });
    await user.click(annulla);
    await waitFor(() => {
      expect(screen.queryByText("Cambia stato della segnalazione")).not.toBeInTheDocument();
    });
  });

  it("non mostra Cambia stato per un volontario non referente", async () => {
    setupInAttesa();
    renderDettaglio("s1", creaUser({ id: "u-other", ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Cambia stato/i })).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Genera segnalazione collegata (recidiva)
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - recidiva", () => {
  it("mostra 'Genera segnalazione collegata' per stato inviata e admin", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "inviata",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Genera segnalazione collegata/i })).toBeInTheDocument();
  });

  it("mostra 'Genera segnalazione collegata' per stato in_attesa", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Genera segnalazione collegata/i })).toBeInTheDocument();
  });

  it("mostra 'Genera segnalazione collegata' per stato chiusa_negativa", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "chiusa_negativa",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Genera segnalazione collegata/i })).toBeInTheDocument();
  });

  it("non mostra 'Genera segnalazione collegata' per stato bozza", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Genera segnalazione collegata/i })).not.toBeInTheDocument();
  });

  it("non mostra 'Genera segnalazione collegata' per stato chiusa_positiva", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "chiusa_positiva",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Genera segnalazione collegata/i })).not.toBeInTheDocument();
  });

  it("chiama onNuovaRecidiva con l'id al click del pulsante", async () => {
    const user = userEvent.setup();
    const onNuovaRecidiva = vi.fn();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s-rec",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s-rec", creaUser({ id: "u-admin", ruolo: "admin" }), { onNuovaRecidiva });
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Genera segnalazione collegata/i }));
    expect(onNuovaRecidiva).toHaveBeenCalledWith("s-rec");
  });

  it("non mostra 'Genera segnalazione collegata' per un volontario", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-other", ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Genera segnalazione collegata/i })).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Anteprima lettera
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - anteprima lettera", () => {
  it("mostra 'Anteprima lettera' per stato != bozza", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", stato: "inviata" }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Anteprima lettera/i })).toBeInTheDocument();
  });

  it("non mostra 'Anteprima lettera' per stato bozza", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", stato: "bozza" }));
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Anteprima lettera/i })).not.toBeInTheDocument();
  });

  it("apre la lettera in nuova scheda via window.open al click", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1", stato: "inviata" }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Anteprima lettera/i }));
    expect(openSpy).toHaveBeenCalledWith("/api/segnalazioni/s1/lettera", "_blank");
  });

  it("mostra 'Lettera con allegati' quando c'e almeno un allegato di tipo foto", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "inviata",
      allegati: [creaAllegato({ id: "a1", tipo: "foto" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Lettera con allegati/i })).toBeInTheDocument();
  });

  it("non mostra 'Lettera con allegati' se gli allegati non includono foto", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "inviata",
      allegati: [creaAllegato({ id: "a1", tipo: "documento" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Lettera con allegati/i })).not.toBeInTheDocument();
  });

  it("apre la lettera con allegati in nuova scheda (?with_attachments=1)", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "inviata",
      allegati: [creaAllegato({ id: "a1", tipo: "foto" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Lettera con allegati/i }));
    expect(openSpy).toHaveBeenCalledWith(
      "/api/segnalazioni/s1/lettera?with_attachments=1",
      "_blank"
    );
  });
});

// -----------------------------------------------------------------------------
// Card Luogo
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - card Luogo", () => {
  it("mostra indirizzo, comune con sigla, CAP e regione", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1" }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Via Test 1")).toBeInTheDocument();
    expect(screen.getByText(/Comune Test \(TT\)/i)).toBeInTheDocument();
    expect(screen.getByText("00000")).toBeInTheDocument();
    expect(screen.getByText("REGIONE TEST")).toBeInTheDocument();
  });

  it("mostra 'n/d' per comune assente e nessuna sigla provincia", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      comune: null,
      provincia: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // Comune "n/d" senza sigla: compare in Comune e Destinatario (almeno 1)
    expect(screen.getAllByText(/n\/d/i).length).toBeGreaterThan(0);
  });

  it("mostra 'n/d' per CAP vuoto", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      cap: "",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // Cerca tutti gli "n/d": CAP deve essere tra questi
    const nds = screen.getAllByText(/n\/d/i);
    expect(nds.length).toBeGreaterThan(0);
  });

  it("mostra 'n/d' per regione assente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      regione: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getAllByText(/n\/d/i).length).toBeGreaterThan(0);
  });

  it("mostra il nome esercizio quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      nomeEsercizio: "Bar Centrale",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Bar Centrale")).toBeInTheDocument();
  });

  it("non mostra la riga Esercizio quando nomeEsercizio è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      nomeEsercizio: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Esercizio:")).not.toBeInTheDocument();
  });

  it("mostra le coordinate con link a Google Maps quando presenti", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      latitudine: 45.123456,
      longitudine: 9.654321,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    const link = screen.getByRole("link", { name: /45\.123456, 9\.654321/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps?q=45.123456,9.654321");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("non mostra le coordinate quando latitudine o longitudine sono null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      latitudine: null,
      longitudine: 9.654321,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText(/Coordinate:/i)).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Card Persone
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - card Persone", () => {
  it("mostra il nome del volontario segnalatore", async () => {
    mockCaricamentoIniziale(creaSegnalazione({ id: "s1" }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Volontario Test")).toBeInTheDocument();
  });

  it("mostra 'n/d' quando il volontario e assente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      volontario: undefined,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getAllByText(/n\/d/i).length).toBeGreaterThan(0);
  });

  it("mostra il nome del referente approvatore quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      referenteApprovatore: { id: "r1", nomeCognome: "Giulia Verdi" },
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Giulia Verdi")).toBeInTheDocument();
  });

  it("non mostra la riga 'Approvata da' quando referenteApprovatore è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      referenteApprovatore: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Approvata da:")).not.toBeInTheDocument();
  });

  it("mostra il nome del destinatario quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      destinatarioNome: "Sindaco Mario",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Sindaco Mario")).toBeInTheDocument();
  });

  it("mostra 'n/d' per destinatario assente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      destinatarioNome: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getAllByText(/n\/d/i).length).toBeGreaterThan(0);
  });

  it("mostra 'Sì, volontario' quando mittenteVisibile è true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      mittenteVisibile: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/Sì, volontario/i)).toBeInTheDocument();
  });

  it("mostra 'No, referente' quando mittenteVisibile è false", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      mittenteVisibile: false,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/No, referente/i)).toBeInTheDocument();
  });

  it("mostra la data di invio formattata quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      dataInvio: "2026-05-12T10:30:00.000Z",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // La data viene formattata con toLocaleString("it-IT"): si verifica
    // che sia presente una stringa che contiene l'anno 2026.
    const dateText = screen.getByText(/2026/);
    expect(dateText).toBeInTheDocument();
  });

  it("non mostra la riga 'Data invio' quando dataInvio è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      dataInvio: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Data invio:")).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Card Tipologia e Problemi
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - card Tipologia non conformita", () => {
  it("mostra [X] per Vetro piano inclinato quando true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkVetroPianoInclinato: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[X\] Vetro piano inclinato/i)).toBeInTheDocument();
  });

  it("mostra [ ] per Vetro piano inclinato quando false", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkVetroPianoInclinato: false,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[ \] Vetro piano inclinato/i)).toBeInTheDocument();
  });

  it("mostra [X] per Vetro curvo quando true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkVetroCurvo: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[X\] Vetro curvo/i)).toBeInTheDocument();
  });

  it("mostra la nota Altro tipologia quando chkAltroTipologia è true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkAltroTipologia: true,
      notaAltroTipologia: "Cupola illuminata",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Cupola illuminata")).toBeInTheDocument();
  });

  it("non mostra la riga Altro tipologia quando chkAltroTipologia è false", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkAltroTipologia: false,
      notaAltroTipologia: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // La label "Altro:" appare solo nel ramo true
    const altri = screen.queryAllByText(/^Altro:/i);
    expect(altri).toHaveLength(0);
  });
});

describe("DettaglioSegnalazione - card Problemi riscontrati", () => {
  it("mostra [X] per Emissione luce verso l'alto quando true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkLuceVersoAlto: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[X\] Emissione luce verso l/i)).toBeInTheDocument();
  });

  it("mostra [X] per Abbagliamento quando true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkAbbagliamento: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[X\] Abbagliamento/i)).toBeInTheDocument();
  });

  it("mostra [X] per Luce intrusiva quando true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkLuceIntrusiva: true,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/\[X\] Luce intrusiva/i)).toBeInTheDocument();
  });

  it("mostra la nota Altro problema quando chkAltroProblema è true", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkAltroProblema: true,
      notaAltroProblema: "Lampade LED troppo potenti",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Lampade LED troppo potenti")).toBeInTheDocument();
  });

  it("non mostra la riga Altro problema quando chkAltroProblema è false", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      chkAltroProblema: false,
      notaAltroProblema: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    const altri = screen.queryAllByText(/^Altro:/i);
    expect(altri).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Descrizione libera
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - descrizione libera", () => {
  it("mostra la card Descrizione libera quando presente", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      descrizioneLibera: "Esempio di testo descrittivo multilinea.",
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Esempio di testo descrittivo multilinea.")).toBeInTheDocument();
    expect(screen.getByText("Descrizione libera")).toBeInTheDocument();
  });

  it("non mostra la card Descrizione libera quando è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      descrizioneLibera: null,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Descrizione libera")).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Allegati
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - allegati", () => {
  it("non mostra la card Allegati quando la lista e vuota", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText(/Allegati \(/i)).not.toBeInTheDocument();
  });

  it("mostra la card Allegati con conteggio quando ce n'e uno", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [creaAllegato({ id: "a1", nomeOriginale: "foto1.jpg" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/Allegati \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("foto1.jpg")).toBeInTheDocument();
  });

  it("mostra la card Allegati con conteggio plurale quando ce ne sono due", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [
        creaAllegato({ id: "a1", nomeOriginale: "foto1.jpg" }),
        creaAllegato({ id: "a2", nomeOriginale: "foto2.jpg" }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/Allegati \(2\)/i)).toBeInTheDocument();
  });

  it("renderizza <img> per allegato di tipo foto", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [creaAllegato({ id: "a1", tipo: "foto", nomeOriginale: "foto.jpg" })],
    }));
    const { container } = renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/api/allegati/a1/preview");
    expect(img!.getAttribute("alt")).toBe("foto.jpg");
  });

  it("renderizza icona FileText per allegato non foto (documento)", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [creaAllegato({ id: "a1", tipo: "documento", nomeOriginale: "relazione.pdf" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("relazione.pdf")).toBeInTheDocument();
  });

  it("genera link di download verso /api/allegati/[id]/download", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      allegati: [creaAllegato({ id: "a-dl", nomeOriginale: "doc.pdf" })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    const link = screen.getByText("doc.pdf").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/api/allegati/a-dl/download");
    expect(link!.getAttribute("target")).toBe("_blank");
  });
});

// -----------------------------------------------------------------------------
// Storico stati
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - storico stati", () => {
  it("non mostra la card Storico quando la lista è vuota", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Storico degli stati")).not.toBeInTheDocument();
  });

  it("non mostra la card Storico quando storicoStati è undefined", async () => {
    // Verifica il fallback `?? []` nel render dello storico: se storicoStati
    // è undefined, la condizione `storicoStati && storicoStati.length > 0`
    // è falsa e la card non viene renderizzata.
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: undefined,
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Storico degli stati")).not.toBeInTheDocument();
  });

  it("mostra la card Storico con gli eventi", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [
        creaStorico({ id: "st1", statoPrecedente: null, statoNuovo: "bozza" }),
        creaStorico({
          id: "st2",
          statoPrecedente: "bozza",
          statoNuovo: "in_revisione",
          timestamp: "2026-01-02T00:00:00.000Z",
        }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Storico degli stati")).toBeInTheDocument();
    expect(screen.getByText(/Bozza →/)).toBeInTheDocument();
    expect(screen.getByText("In revisione", { exact: false })).toBeInTheDocument();
  });

  it("mostra 'n/d' e stringa vuota quando lo storico non ha user", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [
        creaStorico({ id: "st1", user: null, userId: null }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // La riga contiene "n/d ()": si verifica la presenza di "n/d" nella card
    const storicoCard = screen.getByText("Storico degli stati").closest('[data-slot="card"]');
    expect(storicoCard?.textContent).toContain("n/d");
    expect(storicoCard?.textContent).toContain("()");
  });

  it("mostra la nota in corsivo quando presente nello storico", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [
        creaStorico({ id: "st1", nota: "Nota di prova per lo storico" }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText("Nota di prova per lo storico")).toBeInTheDocument();
  });

  it("non mostra la nota quando è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [creaStorico({ id: "st1", nota: null })],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.queryByText("Nota di prova per lo storico")).not.toBeInTheDocument();
  });

  it("non mostra 'statoPrecedente →' quando statoPrecedente è null", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [
        creaStorico({ id: "st1", statoPrecedente: null, statoNuovo: "bozza" }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    // L'etichetta mostra solo "Bozza" senza "→"
    const card = screen.getByText("Storico degli stati").closest('[data-slot="card"]');
    expect(card?.textContent).toContain("Bozza");
    expect(card?.textContent).not.toContain("→");
  });

  it("mostra ruolo utente etichettato (labelRuolo) nello storico", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      storicoStati: [
        creaStorico({
          id: "st1",
          user: { id: "u1", nomeCognome: "Mario Rossi", ruolo: "referente_regionale" },
        }),
      ],
    }));
    renderDettaglio("s1", creaUser());
    await attendiCaricamento();
    expect(screen.getByText(/Referente regionale/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Competenza territoriale
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - competenza territoriale", () => {
  it("referente_provinciale con provincia diversa NON vede i pulsanti di revisione", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 99, // provincia diversa
    }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Approva/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rifiuta con nota/i })).not.toBeInTheDocument();
  });

  it("referente_provinciale con provincia null NON vede i pulsanti (fail-closed)", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: null,
    }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Approva/i })).not.toBeInTheDocument();
  });

  it("referente_provinciale con provincia uguale VEDE i pulsanti di revisione", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 5,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_provinciale",
      provinciaId: 5,
    }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Approva/i })).toBeInTheDocument();
  });

  it("referente_regionale con regione uguale VEDE i pulsanti di revisione", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 7,
    }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_regionale",
      regioneId: 7,
    }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Approva/i })).toBeInTheDocument();
  });

  it("referente_regionale con regione diversa NON vede i pulsanti", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 7,
    }));
    renderDettaglio("s1", creaUser({
      id: "u2",
      ruolo: "referente_regionale",
      regioneId: 99,
    }));
    await attendiCaricamento();
    expect(screen.queryByRole("button", { name: /Approva/i })).not.toBeInTheDocument();
  });

  it("admin vede i pulsanti su approvata indipendentemente dalla provincia", async () => {
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "approvata",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({
      id: "u-admin",
      ruolo: "admin",
      provinciaId: null,
      regioneId: null,
    }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Simula spedizione/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invia PEC/i })).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Modalita demo: guardDemoReadOnly blocca le azioni
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - demo mode blocca azioni mutative", () => {
  function setupDemoBozzaOwner() {
    isDemoMock.mockReturnValue(true);
    guardDemoMock.mockImplementation(() => {
      throw new Error("demo readonly");
    });
  }

  it("invia in revisione in demo: toast errore demo, nessun POST", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    // In modalita demo la carica usa getDemoSegnalazione; demo-1 e una bozza
    // del volontario demo. Per far scattare il pulsante "Invia in revisione"
    // servono isOwner + stato bozza: user.id deve essere "demo-volontario".
    renderDettaglio("demo-1", creaUserDemo({
      id: "demo-volontario",
      ruolo: "volontario",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia in revisione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
    // Nessun POST verso cambia-stato
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/demo-1/cambia-stato"
    );
    expect(call).toBeUndefined();
  });

  it("approva in demo: toast errore demo", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    // demo-2 e in_revisione; user admin demo per avere isReviewer
    renderDettaglio("demo-2", creaUserDemo({
      id: "demo-admin",
      ruolo: "admin",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Approva/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/demo-2/approva"
    );
    expect(call).toBeUndefined();
  });

  it("rifiuta in demo: toast errore demo (dopo aver inserito la nota)", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    renderDettaglio("demo-2", creaUserDemo({
      id: "demo-admin",
      ruolo: "admin",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    const textarea = await screen.findByPlaceholderText(/Mancano le foto/i);
    await user.type(textarea, "Nota demo");
    await user.click(screen.getByRole("button", { name: /Conferma rifiuto/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/demo-2/rifiuta"
    );
    expect(call).toBeUndefined();
  });

  it("simula PEC in demo: toast errore demo", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    // demo-3 e approvata
    renderDettaglio("demo-3", creaUserDemo({
      id: "demo-admin",
      ruolo: "admin",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Simula spedizione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
  });

  it("invia PEC in demo: toast errore demo (anche se confirm true)", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    confirmSpy.mockReturnValue(true);
    renderDettaglio("demo-3", creaUserDemo({
      id: "demo-admin",
      ruolo: "admin",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/demo-3/invia-pec"
    );
    expect(call).toBeUndefined();
  });

  it("cambia stato in demo: toast errore demo", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    // demo-4 e inviata -> ha transizioni lecite
    renderDettaglio("demo-4", creaUserDemo({
      id: "demo-admin",
      ruolo: "admin",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const conferma = await screen.findByRole("button", { name: /^Conferma$/i });
    await user.click(conferma);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
  });

  it("elimina bozza in demo: toast errore demo (anche se confirm true)", async () => {
    const user = userEvent.setup();
    setupDemoBozzaOwner();
    confirmSpy.mockReturnValue(true);
    renderDettaglio("demo-1", creaUserDemo({
      id: "demo-volontario",
      ruolo: "volontario",
    }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Elimina bozza/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "demo readonly", variant: "destructive" })
      )
    );
    const call = mockFetch.mock.calls.find(
      (c) => c[0] === "/api/segnalazioni/demo-1" && c[1]?.method === "DELETE"
    );
    expect(call).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Comportamento transizione di stato: spinner/azioneInCorso disabilita
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - azioneInCorso disabilita i pulsanti", () => {
  it("durante invia in revisione i pulsanti azione restano disabilitati finché la fetch non completa", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u1",
    }));
    // POST cambia-stato mai risolta: tiene azioneInCorso=true
    let resolvePost: (v: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    const btn = screen.getByRole("button", { name: /Invia in revisione/i });
    await user.click(btn);
    // Mentre la POST e in corso il pulsante "Elimina bozza" e disabilitato
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Elimina bozza/i })).toBeDisabled();
    });
    // Risolvi la POST (con errore per semplicita)
    resolvePost(errorResponse(400, "err"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Elimina bozza/i })).not.toBeDisabled();
    });
  });
});

// -----------------------------------------------------------------------------
// Anteprima lettera in demo: anch'essa disponibile (stato != bozza)
// -----------------------------------------------------------------------------

describe("DettaglioSegnalazione - anteprima lettera in demo", () => {
  it("mostra Anteprima lettera per demo-2 (in_revisione) senza chiamare fetch", async () => {
    isDemoMock.mockReturnValue(true);
    renderDettaglio("demo-2", creaUserDemo({ ruolo: "volontario" }));
    await attendiCaricamento();
    expect(screen.getByRole("button", { name: /Anteprima lettera/i })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Catch block con valore non-Error: copre il ramo `e instanceof Error ? e.message : ""`
// Per ogni funzione mutativa (inviaInRevisione, approva, confermaRifiuto,
// simulaPec, inviaPecReale, cambiaStato, eliminaBozza) si simula un fetch
// che lancia una stringa (non un'istanza di Error): il catch deve popolare
// la description del toast con stringa vuota.
// -----------------------------------------------------------------------------
describe("DettaglioSegnalazione - catch con valore non-Error (description vuota)", () => {
  it("invia in revisione: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u1",
    }));
    // Il catch riceve una stringa (non Error): description = ""
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia in revisione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("approva: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 1,
    }));
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Approva/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("confermaRifiuto: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_revisione",
      provinciaId: 1,
      regioneId: 1,
    }));
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Rifiuta con nota/i }));
    const textarea = await screen.findByPlaceholderText(/Mancano le foto/i);
    await user.type(textarea, "Nota obbligatoria");
    await user.click(screen.getByRole("button", { name: /Conferma rifiuto/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("simulaPec: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "approvata",
      provinciaId: 1,
      regioneId: 1,
    }));
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Simula spedizione/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("inviaPecReale: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "approvata",
      provinciaId: 1,
      regioneId: 1,
    }));
    confirmSpy.mockReturnValue(true);
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Invia PEC/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("cambiaStato: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    const conferma = await screen.findByRole("button", { name: /^Conferma$/i });
    await user.click(conferma);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });

  it("eliminaBozza: fetch lancia non-Error, description vuota", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "bozza",
      volontarioId: "u1",
    }));
    confirmSpy.mockReturnValue(true);
    mockFetch.mockRejectedValueOnce("errore di rete stringa");
    renderDettaglio("s1", creaUser({ id: "u1" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Elimina bozza/i }));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Errore", description: "", variant: "destructive" })
      )
    );
  });
});

// -----------------------------------------------------------------------------
// Select onValueChange nel dialog cambio stato: cambio stato selezionato
// -----------------------------------------------------------------------------
describe("DettaglioSegnalazione - Select cambio stato manuale (onValueChange)", () => {
  it("cambia lo stato selezionato nel dialog tramite il Select", async () => {
    const user = userEvent.setup();
    mockCaricamentoIniziale(creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      provinciaId: 1,
      regioneId: 1,
    }));
    renderDettaglio("s1", creaUser({ id: "u-admin", ruolo: "admin" }));
    await attendiCaricamento();
    await user.click(screen.getByRole("button", { name: /Cambia stato/i }));
    // Apri il Select e scegli un'opzione diversa dal default
    const trigger = await screen.findByRole("combobox");
    await user.click(trigger);
    // in_attesa -> ["chiusa_positiva", "chiusa_negativa", "inviata"]
    // Il default è "chiusa_positiva"; selezioniamo "chiusa_negativa".
    // Si usa findByRole("option") per evitare ambiguità con il testo
    // "Chiusa negativa" presente anche nella DialogDescription.
    const opzione = await screen.findByRole("option", { name: "Chiusa negativa" });
    await user.click(opzione);
    // Il trigger del Select mostra ora "Chiusa negativa"
    expect(trigger).toHaveTextContent("Chiusa negativa");
    // Conferma: la POST usa lo stato selezionato
    mockFetch.mockResolvedValueOnce(okResponse({ ok: true }));
    mockFetch.mockResolvedValueOnce(okResponse({ segnalazione: creaSegnalazione({ id: "s1", stato: "chiusa_negativa" }) }));
    await user.click(screen.getByRole("button", { name: /^Conferma$/i }));
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c) => c[0] === "/api/segnalazioni/s1/cambia-stato"
      );
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toEqual({ stato: "chiusa_negativa", nota: null });
    });
  });

  it("cambio stato: stato non nella matrice TRANSIZIONI_LECITE non mostra opzioni (ramo ?? [])", async () => {
    // Crea una segnalazione con uno stato non standard per triggerare il
    // fallback ?? [] di TRANSIZIONI_LECITE[segnalazione.stato]
    mockCaricamentoIniziale(
      creaSegnalazione({ id: "s-weird", stato: "stato_inesistente" as any })
    );
    // Usa admin con id="v1" (matcha volontarioId) per evitare problemi
    renderDettaglio("s-weird", creaUser({ ruolo: "admin", id: "v1" }));
    await attendiCaricamento();

    // Il pulsante "Cambia stato" non dovrebbe essere visibile perché non ci
    // sono transizioni lecite (la lista filtrata è vuota per il fallback)
    expect(screen.queryByRole("button", { name: /cambia stato/i })).not.toBeInTheDocument();
  });

  it("storico: mostra 'Evento di sistema' quando statoNuovo è null (anonimizzazione GDPR)", async () => {
    mockCaricamentoIniziale(
      creaSegnalazione({
        id: "s-gdpr",
        stato: "chiusa_positiva",
        storicoStati: [
          creaStorico({ id: "st1", statoPrecedente: "inviata", statoNuovo: "in_attesa" }),
          creaStorico({ id: "st2", statoPrecedente: null, statoNuovo: null, nota: "Anonimizzazione GDPR" }),
        ],
      })
    );
    renderDettaglio("s-gdpr", creaUser({ ruolo: "admin" }));
    await attendiCaricamento();

    // Il secondo evento (statoNuovo null) deve mostrare "Evento di sistema"
    expect(screen.getByText("Evento di sistema")).toBeInTheDocument();
  });
});
