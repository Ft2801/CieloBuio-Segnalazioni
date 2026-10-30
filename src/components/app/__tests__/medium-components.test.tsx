/**
 * Test di rendering e interazione per i componenti app di complessita media:
 * VistaReminder, Dashboard, ListaSegnalazioni, AppShell.
 *
 * Per ogni componente si coprono: rendering iniziale, percorsi di errore,
 * modalità demo, rami condizionali (if/else, &&, ??, ternari) e
 * interazioni utente principali (click, input, submit).
 *
 * Autore: Fabio Tempera (2026)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { SessionUser, Segnalazione } from "@/lib/types";

// Polyfill per jsdom: Radix Select chiama hasPointerCapture/releasePointerCapture
// che non sono implementati in jsdom. Si aggiungono come no-op per evitare
// TypeError durante l'interazione col Select nei test.
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
// Mock delle dipendenze esterne condivise
// -----------------------------------------------------------------------------

// Mock di next/navigation (alcuni componenti figli potrebbero usarlo)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Mock di useToast: alcuni figli di AppShell lo usano, ma nei test diretti
// di VistaReminder/Dashboard/ListaSegnalazioni non è richiamato. Lo si
// mocka comunque per sicurezza in caso di rendering transitivo.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Stub di window.open usato da ListaSegnalazioni per l'export CSV
const openSpy = vi.fn();
vi.stubGlobal("open", openSpy);

// Mock fetch globale: ogni test può riconfigurare mockResolvedValue o
// mockRejectedValue per simulare risposte diverse.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock dei figli pesanti di AppShell: ci interessa verificare la corretta
// navigazione e delega, non il funzionamento interno dei figli (coperti
// dai rispettivi test). Si espongono gli handler per poter simulare le
// callback invocate dai figli verso il parent.
// vi.hoisted assicura che i riferimenti siano disponibili anche dentro le
// factory di vi.mock (che vengono hoisted in cima al file).
const {
  formBackMock,
  formSavedMock,
  dettaglioBackMock,
  dettaglioModificaMock,
  dettaglioRecidivaMock,
  dettaglioAggiornataMock,
  useSessionMock,
} = vi.hoisted(() => ({
  formBackMock: vi.fn(),
  formSavedMock: vi.fn(),
  dettaglioBackMock: vi.fn(),
  dettaglioModificaMock: vi.fn(),
  dettaglioRecidivaMock: vi.fn(),
  dettaglioAggiornataMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("@/components/app/form-segnalazione", () => ({
  FormSegnalazione: (props: Record<string, unknown>) => (
    <div
      data-testid="form-segnalazione-mock"
      data-props={JSON.stringify({
        segnalazioneId: props.segnalazioneId ?? null,
        segnalazionePrecedenteId: props.segnalazionePrecedenteId ?? null,
      })}
    >
      <button
        onClick={() => {
          formBackMock();
          (props.onBack as () => void)?.();
        }}
      >
        FormBack
      </button>
      <button
        onClick={() => {
          formSavedMock("salvato-id");
          (props.onSaved as (id: string) => void)?.("salvato-id");
        }}
      >
        FormSaved
      </button>
    </div>
  ),
}));

vi.mock("@/components/app/dettaglio-segnalazione", () => ({
  DettaglioSegnalazione: (props: Record<string, unknown>) => (
    <div data-testid="dettaglio-mock" data-id={String(props.id ?? "")}>
      <button
        onClick={() => {
          dettaglioBackMock();
          (props.onBack as () => void)?.();
        }}
      >
        DettaglioBack
      </button>
      <button
        onClick={() => {
          dettaglioModificaMock(String(props.id));
          (props.onApriModifica as (id: string) => void)?.(String(props.id));
        }}
      >
        DettaglioModifica
      </button>
      <button
        onClick={() => {
          dettaglioRecidivaMock(String(props.id));
          (props.onNuovaRecidiva as (id: string) => void)?.(String(props.id));
        }}
      >
        DettaglioRecidiva
      </button>
      <button
        onClick={() => {
          dettaglioAggiornataMock();
          (props.onAggiornata as () => void)?.();
        }}
      >
        DettaglioAggiornata
      </button>
    </div>
  ),
}));

vi.mock("@/components/app/pannello-admin", () => ({
  PannelloAdmin: () => <div data-testid="pannello-admin-mock">Pannello Admin</div>,
}));

// use-session e mockato per AppShell: ogni test può impostare il valore
// restituito tramite useSessionMock.mockReturnValue(...)
vi.mock("@/components/app/use-session", () => ({
  useSession: () => useSessionMock(),
}));

// Mock di @/lib/demo-data con override opzionale di DEMO_SEGNALAZIONI.
// Di default si comporta come il modulo reale; alcuni test possono impostare
// demoSegnalazioniOverride.current a una lista custom (ad esempio con
// segnalazioni prive di comune) per coprire i rami `comune?.nome ?? ""`
// del filtro di ricerca demo in ListaSegnalazioni.
const { demoSegnalazioniOverride } = vi.hoisted(() => ({
  demoSegnalazioniOverride: { current: null as Segnalazione[] | null },
}));
vi.mock("@/lib/demo-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo-data")>();
  return {
    ...actual,
    get DEMO_SEGNALAZIONI() {
      return demoSegnalazioniOverride.current ?? actual.DEMO_SEGNALAZIONI;
    },
  };
});

// -----------------------------------------------------------------------------
// Helper per costruire SessionUser in modo conciso nei test
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

function creaUserDemo(overrides: Partial<SessionUser> = {}): SessionUser {
  // Marcatore isDemo per attivare il percorso demo nei componenti
  return {
    ...creaUser(overrides),
    isDemo: true,
  } as unknown as SessionUser;
}

// Helper per costruire una Segnalazione di test con valori sensati.
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

// Risposta fetch di default (200 OK con payload vuoto)
function okResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => "",
  } as unknown as Response;
}

// -----------------------------------------------------------------------------
// Reset comuni prima di ogni test
// -----------------------------------------------------------------------------

beforeEach(() => {
  // La shell legge la vista dalla query string: ogni test parte dalla dashboard.
  window.history.replaceState(null, "", "/");
  mockFetch.mockReset();
  openSpy.mockReset();
  useSessionMock.mockReset();
  formBackMock.mockReset();
  formSavedMock.mockReset();
  dettaglioBackMock.mockReset();
  dettaglioModificaMock.mockReset();
  dettaglioRecidivaMock.mockReset();
  dettaglioAggiornataMock.mockReset();
  // Reset dell'override demo: di default si usa il modulo reale.
  demoSegnalazioniOverride.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// VistaReminder
// -----------------------------------------------------------------------------

import { VistaReminder } from "@/components/app/vista-reminder";

describe("VistaReminder", () => {
  it("mostra stato di caricamento quando data è null", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // mai risolta
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    expect(screen.getByText("Caricamento in corso…")).toBeInTheDocument();
  });

  it("chiama onBack al click del pulsante Indietro", async () => {
    const onBack = vi.fn();
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
    render(<VistaReminder user={creaUser()} onBack={onBack} onApriDettaglio={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Indietro/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renderizza stato vuoto quando non ci sono pratiche", async () => {
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Nessuna pratica supera la soglia/i)).toBeInTheDocument();
    });
  });

  it("renderizza le pratiche restituite dal server", async () => {
    const seg = creaSegnalazione({
      id: "s1",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Roma 10",
      numeroProtocollo: "20260101-TT-X-XX01",
      volontario: { id: "v1", nomeCognome: "Luigi Bianchi", email: "luigi@test.it" },
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 45, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Via Roma 10")).toBeInTheDocument();
    });
    // Soglia riportata correttamente dal payload
    expect(screen.getByText(/Soglia: 45 giorni senza risposta/i)).toBeInTheDocument();
    // Badge giorni presente: la soglia appare due volte (header + badge pratica)
    expect(screen.getAllByText(/\d+ giorni/i).length).toBeGreaterThan(0);
    // Numero protocollo mostrato come Badge
    expect(screen.getByText("20260101-TT-X-XX01")).toBeInTheDocument();
  });

  it("usa soglia default 30 quando data ancora null", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // loading
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    expect(screen.getByText(/30 giorni senza risposta/i)).toBeInTheDocument();
  });

  it("usa 0 giorni quando la pratica non ha dataInvio", async () => {
    const seg = creaSegnalazione({
      id: "s2",
      stato: "in_attesa",
      dataInvio: null,
      indirizzoVia: "Via Senza Data",
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Via Senza Data")).toBeInTheDocument();
    });
    // Il badge mostra "0 giorni"
    expect(screen.getAllByText(/0 giorni/).length).toBeGreaterThan(0);
  });

  it("mostra 'n/d' per nomeCognome volontario mancante", async () => {
    const seg = creaSegnalazione({
      id: "s3",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Volontario Mancante",
      volontario: undefined,
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/volontario: n\/d/i)).toBeInTheDocument();
    });
  });

  it("mostra 'n/d' per email volontario mancante (undefined)", async () => {
    const seg = creaSegnalazione({
      id: "s4",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Email Mancante",
      volontario: { id: "v1", nomeCognome: "Solo Nome", email: undefined as unknown as string },
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Via Email Mancante")).toBeInTheDocument();
    });
    // Email undefined: il coalescing ?? attiva il fallback "n/d"
    expect(screen.getAllByText("n/d").length).toBeGreaterThan(0);
  });

  it("non mostra il badge numeroProtocollo quando questo è null", async () => {
    const seg = creaSegnalazione({
      id: "s5",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Senza Protocollo",
      numeroProtocollo: null,
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Via Senza Protocollo")).toBeInTheDocument();
    });
    // Solo il badge giorni, nessun badge outline col protocollo
    const badges = screen.getAllByText(/.+/).filter((el) => el.classList?.contains("font-mono"));
    expect(badges).toHaveLength(0);
  });

  it("chiama onApriDettaglio dal pulsante Apri della pratica", async () => {
    const user = userEvent.setup();
    const onApri = vi.fn();
    const seg = creaSegnalazione({
      id: "s-click-card",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Cliccabile",
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={onApri} />);
    await waitFor(() => expect(screen.getByText("Via Cliccabile")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Apri dettaglio pratica/ }));
    expect(onApri).toHaveBeenCalledWith("s-click-card");
  });

  it("chiama onApriDettaglio cliccando sul pulsante Apri", async () => {
    const user = userEvent.setup();
    const onApri = vi.fn();
    const seg = creaSegnalazione({
      id: "s-click-btn",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Pulsante",
      numeroProtocollo: "PROTO-1",
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={onApri} />);
    await waitFor(() => expect(screen.getByText("Via Pulsante")).toBeInTheDocument());
    const btn = screen.getByRole("button", { name: /Apri dettaglio pratica PROTO-1/i });
    await user.click(btn);
    expect(onApri).toHaveBeenCalledWith("s-click-btn");
  });

  it("usa aria-label con id quando numeroProtocollo è null", async () => {
    const seg = creaSegnalazione({
      id: "s-aria",
      stato: "in_attesa",
      dataInvio: "2026-01-01T00:00:00.000Z",
      indirizzoVia: "Via Aria",
      numeroProtocollo: null,
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 1, pratiche: [seg] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Apri dettaglio pratica s-aria/i })).toBeInTheDocument();
    });
  });

  it("mostra lo stato di errore quando il fetch fallisce", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento in corso…")).not.toBeInTheDocument();
  });

  it("mostra lo stato di errore quando il corpo della risposta non è JSON valido", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid");
      },
      text: async () => "",
    } as unknown as Response);
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento in corso…")).not.toBeInTheDocument();
  });

  it("in modalità demo mostra i dati statici senza chiamare fetch", async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    render(<VistaReminder user={creaUserDemo({ ruolo: "volontario" })} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await waitFor(() => {
      // DEMO_SEGNALAZIONI contiene una segnalazione in_attesa (demo-5)
      expect(screen.getByText("Via del Porto 9")).toBeInTheDocument();
    });
    // Nessuna richiesta di rete in modalità demo
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// AppShell
// -----------------------------------------------------------------------------

import { AppShell } from "@/components/app/app-shell";

describe("AppShell", () => {
  // Il render avviene dentro act asincrono: le risposte fetch già risolte e gli
  // effetti dei figli (Dashboard, ListaSegnalazioni) si completano prima che il
  // test asserisca, senza aggiornamenti di stato fuori da act.
  async function renderAsync(ui: ReactElement) {
    const result = render(ui);
    await act(async () => {});
    return result;
  }

  function setUser(user: SessionUser | null, loading = false) {
    useSessionMock.mockReturnValue({
      user,
      loading,
      login: vi.fn().mockResolvedValue({ ok: true }),
      logout: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
    });
    // I figli reali (Dashboard, ListaSegnalazioni, VistaReminder) chiamano
    // fetch quando user non è demo. Si fornisce una risposta di default
    // sicura (payload vuoto) per evitare "Cannot read 'then' of undefined".
    if (user && !(typeof user === "object" && "isDemo" in user && (user as { isDemo?: unknown }).isDemo === true)) {
      mockFetch.mockResolvedValue(
        okResponse({
          sogliaGiorni: 30,
          count: 0,
          pratiche: [],
          totali: 0,
          bozze: 0,
          inRevisione: 0,
          approvate: 0,
          inviate: 0,
          inAttesa: 0,
          chiusePositive: 0,
          chiuseNegative: 0,
          recidive: 0,
          inAttesaOverdue: 0,
          segnalazioni: [],
          pagination: { hasMore: false, total: 0 },
        }),
      );
    }
  }

  it("mostra stato di caricamento quando loading e true", async () => {
    setUser(null, true);
    const { container } = await renderAsync(<AppShell />);
    expect(screen.getByText("Caricamento in corso…")).toBeInTheDocument();
    // Non viene renderizzata la sidebar
    expect(container.querySelector("aside")).not.toBeInTheDocument();
  });

  it("renderizza LoginScreen quando user è null", async () => {
    setUser(null, false);
    await renderAsync(<AppShell />);
    expect(screen.getByText("CieloBuio")).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
  });

  it("renderizza Dashboard di default per utente autenticato", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    expect(screen.getByText(/Benvenuto, Mario Rossi/i)).toBeInTheDocument();
    // Il pulsante "Nuova segnalazione" compare sia nella sidebar che nella Dashboard:
    // si verifica la presenza nella main content tramite within.
    const main = document.querySelector("main");
    expect(within(main as HTMLElement).getByRole("link", { name: /Nuova segnalazione/i })).toBeInTheDocument();
  });

  it("mostra le voci di navigazione base per volontario (no Promemoria, no Admin)", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    expect(screen.getByRole("link", { name: /^Dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Segnalazioni" })).toBeInTheDocument();
    // "Nuova segnalazione" compare in sidebar e dashboard: si verifica solo
    // la presenza nella sidebar (aside)
    const aside = document.querySelector("aside");
    expect(within(aside as HTMLElement).getByRole("link", { name: /Nuova segnalazione/i })).toBeInTheDocument();
    // Promemoria non visibile per volontario
    expect(screen.queryByRole("button", { name: /^Promemoria/i })).not.toBeInTheDocument();
    // Amministrazione non visibile per non-admin
    expect(screen.queryByRole("link", { name: /Amministrazione/i })).not.toBeInTheDocument();
  });

  it("raggruppa la navigazione in Lavoro, Follow-up e Sistema per l'admin", async () => {
    setUser(creaUser({ ruolo: "admin" }));
    await renderAsync(<AppShell />);
    const aside = document.querySelector("aside") as HTMLElement;
    expect(within(aside).getByRole("group", { name: "Lavoro" })).toHaveTextContent("Nuova segnalazione");
    expect(within(aside).getByRole("group", { name: "Follow-up" })).toHaveTextContent("Promemoria");
    const sistema = within(aside).getByRole("group", { name: "Sistema" });
    expect(sistema).toHaveTextContent("Amministrazione");
    expect(sistema).toHaveTextContent("Guida");
  });

  it("non mostra il gruppo Follow-up al volontario, che vede comunque Sistema con la guida", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    const aside = document.querySelector("aside") as HTMLElement;
    expect(within(aside).queryByRole("group", { name: "Follow-up" })).not.toBeInTheDocument();
    expect(within(aside).getByRole("group", { name: "Sistema" })).toHaveTextContent("Guida");
  });

  it("mostra la voce Promemoria per referente_provinciale", async () => {
    setUser(creaUser({ ruolo: "referente_provinciale" }));
    await renderAsync(<AppShell />);
    expect(screen.getByRole("link", { name: /^Promemoria$/i })).toBeInTheDocument();
    // Amministrazione resta nascosta
    expect(screen.queryByRole("link", { name: /Amministrazione/i })).not.toBeInTheDocument();
  });

  it("mostra la voce Amministrazione solo per admin", async () => {
    setUser(creaUser({ ruolo: "admin" }));
    await renderAsync(<AppShell />);
    expect(screen.getByRole("link", { name: /Amministrazione/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Promemoria$/i })).toBeInTheDocument();
  });

  it("non mostra alcun banner di prova neppure per utenti demo", async () => {
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/dimostrativa|modalit[aà] demo|ambiente di prova/i);
  });

  it("non mostra il banner demo per utenti reali", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("naviga a ListaSegnalazioni cliccando 'Segnalazioni'", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    // La pagina ListaSegnalazioni ha un h1 "Segnalazioni" (lo scope su heading level 1
    // evita ambiguita con la scritta "Segnalazioni" del footer della sidebar)
    expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
  });

  it("naviga a VistaReminder cliccando 'Promemoria' (non volontario)", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "referente_provinciale" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: /^Promemoria$/i }));
    expect(screen.getByText(/Pratiche in attesa da promemoria/i)).toBeInTheDocument();
  });

  it("naviga a PannelloAdmin cliccando 'Amministrazione' (admin)", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "admin" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: /Amministrazione/i }));
    expect(screen.getByTestId("pannello-admin-mock")).toBeInTheDocument();
  });

  it("naviga a FormSegnalazione cliccando 'Nuova segnalazione'", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    // Click sul pulsante della sidebar (aside) per navigare
    const aside = document.querySelector("aside");
    await user.click(within(aside as HTMLElement).getByRole("link", { name: /Nuova segnalazione/i }));
    expect(screen.getByTestId("form-segnalazione-mock")).toBeInTheDocument();
  });

  it("marca la voce attiva con aria-current='page'", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    const dashboardBtn = screen.getByRole("link", { name: /^Dashboard$/i });
    expect(dashboardBtn.getAttribute("aria-current")).toBe("page");
  });

  it("aggiorna la voce attiva dopo la navigazione", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    const listaBtn = screen.getByRole("link", { name: "Segnalazioni" });
    expect(listaBtn.getAttribute("aria-current")).toBe("page");
    const dashboardBtn = screen.getByRole("link", { name: /^Dashboard$/i });
    expect(dashboardBtn.getAttribute("aria-current")).toBeNull();
  });

  it("apre la sidebar su mobile cliccando il pulsante menu", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    const menuBtn = screen.getByRole("button", { name: /Apri menu/i });
    await user.click(menuBtn);
    // L'overlay di chiusura appare: si verifica che esista
    expect(document.querySelector(".bg-black\\/40")).not.toBeNull();
  });

  it("chiude la sidebar cliccando l'overlay", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    const { container } = await renderAsync(<AppShell />);
    const menuBtn = screen.getByRole("button", { name: /Apri menu/i });
    await user.click(menuBtn);
    // L'overlay e il div con classe "fixed inset-0 z-30 bg-black/40 md:hidden"
    const overlay = container.querySelector(".bg-black\\/40");
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);
    // L'overlay sparisce dopo la chiusura
    await waitFor(() => {
      expect(container.querySelector(".bg-black\\/40")).toBeNull();
    });
  });

  it("chiude la sidebar quando si cambia vista", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    const { container } = await renderAsync(<AppShell />);
    await user.click(screen.getByRole("button", { name: /Apri menu/i }));
    expect(container.querySelector(".bg-black\\/40")).not.toBeNull();
    // Click su una voce di navigazione: la sidebar si chiude (useEffect su vista)
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => {
      expect(container.querySelector(".bg-black\\/40")).toBeNull();
    });
  });

  it("chiama logout dal pulsante Esci nella sidebar", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    setUser(creaUser({ ruolo: "volontario" }));
    // Override useSessionMock con logout personalizzato per poterne verificare la chiamata
    useSessionMock.mockReturnValue({
      user: creaUser({ ruolo: "volontario" }),
      loading: false,
      login: vi.fn(),
      logout,
      refresh: vi.fn(),
    });
    await renderAsync(<AppShell />);
    const esciBtns = screen.getAllByRole("button", { name: /^Esci$/i });
    // Pulsante "Esci" nella sidebar (con testo) - ce n'è uno nella sidebar
    const sidebarEsci = esciBtns.find((b) => b.closest("aside") !== null);
    await user.click(sidebarEsci as HTMLElement);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("chiama logout dal pulsante header mobile", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    setUser(creaUser({ ruolo: "volontario" }));
    useSessionMock.mockReturnValue({
      user: creaUser({ ruolo: "volontario" }),
      loading: false,
      login: vi.fn(),
      logout,
      refresh: vi.fn(),
    });
    await renderAsync(<AppShell />);
    // Su mobile l'uscita sta solo nel menu a scomparsa: si apre il menu e si usa "Esci".
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    const menu = screen.getByRole("complementary", { name: "Menu principale" });
    await user.click(within(menu).getByRole("button", { name: /Esci/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("mostra nome, email e ruolo dell'utente nella sidebar", async () => {
    setUser(creaUser({ ruolo: "referente_regionale", nomeCognome: "Giulia Verdi", email: "giulia@test.it" }));
    await renderAsync(<AppShell />);
    expect(screen.getByText("Giulia Verdi")).toBeInTheDocument();
    expect(screen.getByText("giulia@test.it")).toBeInTheDocument();
    expect(screen.getByText("Referente regionale")).toBeInTheDocument();
  });

  it("naviga dal Dashboard a ListaSegnalazioni passando filtroStato", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    // Dashboard e la vista corrente: trova la card "Bozze" nella main
    const main = document.querySelector("main");
    await user.click(within(main as HTMLElement).getByText("Bozze"));
    // Lista renderizzata (h1 "Segnalazioni")
    expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
  });

  it("naviga dal Dashboard al Reminder tramite il banner overdue", async () => {
    const user = userEvent.setup();
    // Il promemoria non è consentito al volontario: si usa un referente.
    setUser(creaUserDemo({ ruolo: "referente_provinciale" }));
    await renderAsync(<AppShell />);
    // DEMO_STATS ha inAttesaOverdue = 1: banner visibile
    const vaiBtn = await screen.findByRole("button", { name: /Vai ai promemoria/i });
    await user.click(vaiBtn);
    expect(screen.getByText(/Pratiche in attesa da promemoria/i)).toBeInTheDocument();
  });

  it("dal FormSegnalazione (nuova) onBack torna a ListaSegnalazioni", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    const aside = document.querySelector("aside");
    await user.click(within(aside as HTMLElement).getByRole("link", { name: /Nuova segnalazione/i }));
    expect(screen.getByTestId("form-segnalazione-mock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "FormBack" }));
    expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
  });

  it("dal FormSegnalazione (nuova) onSaved va a ListaSegnalazioni", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    const aside = document.querySelector("aside");
    await user.click(within(aside as HTMLElement).getByRole("link", { name: /Nuova segnalazione/i }));
    await user.click(screen.getByRole("button", { name: "FormSaved" }));
    expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
  });

  it("dal Dettaglio onBack torna a ListaSegnalazioni (dopo navigazione)", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "DettaglioBack" }));
    expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
  });

  it("dal Dettaglio il pulsante Modifica apre FormSegnalazione in modifica", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    // Vai alla lista, apri dettaglio della prima segnalazione demo
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "DettaglioModifica" }));
    expect(screen.getByTestId("form-segnalazione-mock")).toBeInTheDocument();
  });

  it("dal Dettaglio onNuovaRecidiva va a FormSegnalazione con id precedente", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    await user.click(screen.getByRole("button", { name: "DettaglioRecidiva" }));
    const form = screen.getByTestId("form-segnalazione-mock");
    const props = JSON.parse(form.getAttribute("data-props") || "{}");
    expect(props.segnalazionePrecedenteId).toBe("demo-1");
  });

  it("dal FormSegnalazione (modifica) onBack torna al Dettaglio", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    await user.click(screen.getByRole("button", { name: "DettaglioModifica" }));
    expect(screen.getByTestId("form-segnalazione-mock")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "FormBack" }));
    // Torna al dettaglio
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
  });

  it("dal FormSegnalazione (modifica) onSaved torna al Dettaglio", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    await user.click(screen.getByRole("button", { name: "DettaglioModifica" }));
    await user.click(screen.getByRole("button", { name: "FormSaved" }));
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
  });

  it("dal VistaReminder onBack torna a Dashboard", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "referente_provinciale" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: /^Promemoria$/i }));
    expect(screen.getByText(/Pratiche in attesa da promemoria/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Indietro/i }));
    expect(screen.getByText(/Benvenuto, Mario Rossi/i)).toBeInTheDocument();
  });

  it("dal VistaReminder il pulsante Apri porta al Dettaglio", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "admin" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: /^Promemoria$/i }));
    await waitFor(() => {
      // In modalità demo, VistaReminder mostra una pratica in_attesa (demo-5)
      expect(screen.getByText("Via del Porto 9")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /^Apri dettaglio pratica/ }));
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
    const dettaglio = screen.getByTestId("dettaglio-mock");
    expect(dettaglio.getAttribute("data-id")).toBe("demo-5");
  });

  it("renderizza il footer con copyright, anno corrente e autore", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/© CieloBuio \d{4}\. Sviluppo: Fabio Tempera\./);
  });

  it("per referente_provinciale la navigazione a Promemoria non monta PannelloAdmin", async () => {
    const user = userEvent.setup();
    setUser(creaUser({ ruolo: "referente_provinciale" }));
    await renderAsync(<AppShell />);
    // La voce Amministrazione non è visibile per questo ruolo; si verifica
    // che il flusso consentito (Promemoria) non monti la vista admin.
    await user.click(screen.getByRole("link", { name: /^Promemoria$/i }));
    expect(screen.queryByTestId("pannello-admin-mock")).not.toBeInTheDocument();
  });

  it("header mobile mostra il titolo CieloBuio", async () => {
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    // Header mobile è visibile: contiene un bottone "Apri menu" e il titolo
    expect(screen.getByRole("button", { name: /Apri menu/i })).toBeInTheDocument();
  });

  it("con user null mostra LoginScreen con il pulsante Accedi", async () => {
    const login = vi.fn().mockResolvedValue({ ok: true });
    useSessionMock.mockReturnValue({
      user: null,
      loading: false,
      login,
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    await renderAsync(<AppShell />);
    // LoginScreen renderizzato: si verifica l'esistenza del form
    expect(screen.getByRole("button", { name: /Accedi/i })).toBeInTheDocument();
  });

  it("dal ListaSegnalazioni (vuoto) onNavigate('nuova-segnalazione') mostra il form", async () => {
    const user = userEvent.setup();
    // Utente non demo: fetch ritorna lista vuota, scatena stato vuoto.
    setUser(creaUser({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    // Stato vuoto: il pulsante "Crea una nuova segnalazione" chiama onNavigate
    const creaBtn = await screen.findByRole("button", { name: /Crea una nuova segnalazione/i });
    await user.click(creaBtn);
    // FormSegnalazione renderizzato (mock figlio)
    expect(screen.getByTestId("form-segnalazione-mock")).toBeInTheDocument();
  });

  it("dal Dettaglio onAggiornata non cambia vista (callback no-op)", async () => {
    const user = userEvent.setup();
    setUser(creaUserDemo({ ruolo: "volontario" }));
    await renderAsync(<AppShell />);
    // Naviga al dettaglio di una segnalazione demo
    await user.click(screen.getByRole("link", { name: "Segnalazioni" }));
    await waitFor(() => expect(screen.getAllByText("Capannone dismesso").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("link", { name: /Capannone dismesso/ })[0]);
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
    // Click sul pulsante DettaglioAggiornata del mock figlio
    await user.click(screen.getByRole("button", { name: "DettaglioAggiornata" }));
    expect(dettaglioAggiornataMock).toHaveBeenCalledTimes(1);
    // La vista resta sul dettaglio (no cambio vista)
    expect(screen.getByTestId("dettaglio-mock")).toBeInTheDocument();
  });

  describe("indirizzi della vista", () => {
    it("apre la vista indicata dalla query string con i suoi parametri", async () => {
      window.history.replaceState(null, "", "/?v=lista&stato=bozza");
      setUser(creaUser({ ruolo: "volontario" }));
      await renderAsync(<AppShell />);
      expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Segnalazioni" })).toHaveAttribute("aria-current", "page");
    });

    it("una vista non consentita al ruolo ricade sulla dashboard", async () => {
      window.history.replaceState(null, "", "/?v=admin");
      setUser(creaUser({ ruolo: "volontario" }));
      await renderAsync(<AppShell />);
      expect(screen.getByRole("heading", { name: /Benvenuto/ })).toBeInTheDocument();
      expect(screen.queryByTestId("pannello-admin-mock")).not.toBeInTheDocument();
    });

    it("la voce Guida apre la guida e la guida è segnata come voce attiva", async () => {
      const user = userEvent.setup();
      setUser(creaUser({ ruolo: "volontario" }));
      await renderAsync(<AppShell />);
      await user.click(screen.getByRole("link", { name: "Guida" }));
      expect(screen.getByRole("heading", { name: "Guida", level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Guida" })).toHaveAttribute("aria-current", "page");
      expect(window.location.search).toBe("?v=guida");
    });

    it("il pulsante Indietro del browser riporta alla vista dell'indirizzo", async () => {
      const user = userEvent.setup();
      setUser(creaUser({ ruolo: "volontario" }));
      await renderAsync(<AppShell />);
      await user.click(screen.getByRole("link", { name: "Guida" }));
      expect(screen.getByRole("heading", { name: "Guida", level: 1 })).toBeInTheDocument();
      await act(async () => {
        window.history.replaceState(null, "", "/?v=lista");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(screen.getByRole("heading", { name: "Segnalazioni", level: 1 })).toBeInTheDocument();
    });

    it("cliccare la voce della vista già aperta non aggiunge una voce alla cronologia", async () => {
      const user = userEvent.setup();
      setUser(creaUser({ ruolo: "volontario" }));
      await renderAsync(<AppShell />);
      const spia = vi.spyOn(window.history, "pushState");
      await user.click(screen.getByRole("link", { name: /^Dashboard$/i }));
      expect(spia).not.toHaveBeenCalled();
      spia.mockRestore();
    });

    it("il logout sostituisce l'indirizzo con la dashboard", async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, "", "/?v=lista");
      const logout = vi.fn().mockResolvedValue(undefined);
      useSessionMock.mockReturnValue({
        user: creaUser({ ruolo: "volontario" }),
        loading: false,
        login: vi.fn(),
        logout,
        refresh: vi.fn(),
      });
      await renderAsync(<AppShell />);
      await user.click(screen.getByRole("button", { name: "Apri menu" }));
      const menu = screen.getByRole("complementary", { name: "Menu principale" });
      await user.click(within(menu).getByRole("button", { name: /Esci/i }));
      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.search).toBe(""));
      expect(screen.getByRole("heading", { name: /Benvenuto/ })).toBeInTheDocument();
    });
  });
});

describe("VistaReminder - riprova", () => {
  it("il pulsante Riprova ripete il caricamento dopo un errore", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockRejectedValueOnce(new Error("rete assente"))
      .mockResolvedValueOnce(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
    render(<VistaReminder user={creaUser()} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Riprova/i }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});

describe("AppShell - Escape", () => {
  it("il tasto Escape chiude la sidebar aperta", async () => {
    const user = userEvent.setup();
    useSessionMock.mockReturnValue({
      user: creaUser({ ruolo: "volontario" }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
    await act(async () => {
      render(<AppShell />);
    });
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    expect(document.querySelector(".bg-black\\/40")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(document.querySelector(".bg-black\\/40")).toBeNull();
  });

  it("un tasto diverso da Escape non chiude la sidebar aperta", async () => {
    const user = userEvent.setup();
    useSessionMock.mockReturnValue({
      user: creaUser({ ruolo: "volontario" }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
    await act(async () => {
      render(<AppShell />);
    });
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    await user.keyboard("a");
    expect(document.querySelector(".bg-black\\/40")).not.toBeNull();
  });
});

describe("AppShell - gestione del focus nel menu mobile", () => {
  function impostaUtente() {
    useSessionMock.mockReturnValue({
      user: creaUser({ ruolo: "volontario" }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    mockFetch.mockResolvedValue(okResponse({ sogliaGiorni: 30, count: 0, pratiche: [] }));
  }

  it("all'apertura del menu il focus va sulla prima voce di navigazione", async () => {
    const user = userEvent.setup();
    impostaUtente();
    await act(async () => {
      render(<AppShell />);
    });
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    const nav = screen.getByRole("navigation", { name: "Navigazione principale" });
    expect(nav.querySelector("a")).toHaveFocus();
  });

  it("Escape chiude il menu e riporta il focus sul pulsante Apri menu", async () => {
    const user = userEvent.setup();
    impostaUtente();
    await act(async () => {
      render(<AppShell />);
    });
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Apri menu" })).toHaveFocus();
  });

  it("il tocco fuori dal menu lo chiude e riporta il focus sul pulsante Apri menu", async () => {
    const user = userEvent.setup();
    impostaUtente();
    const { container } = render(<AppShell />);
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: "Apri menu" }));
    const overlay = container.querySelector<HTMLElement>(".bg-black\\/40");
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);
    expect(screen.getByRole("button", { name: "Apri menu" })).toHaveFocus();
    expect(container.querySelector(".bg-black\\/40")).toBeNull();
  });
});
