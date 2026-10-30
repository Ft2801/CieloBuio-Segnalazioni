// @vitest-environment jsdom
/**
 * Copertura dei rami di Dashboard (errore statistiche, tastiera sulle card)
 * e di VistaReminder (errore di caricamento, annullamento, dati assenti).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "@/components/app/dashboard";
import { VistaReminder } from "@/components/app/vista-reminder";

const ADMIN = {
  id: "u-admin",
  email: "admin@t.it",
  nomeCognome: "Admin",
  ruolo: "admin",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "AD",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
  attivo: true,
} as never;

const STATISTICHE = {
  totali: 10,
  bozze: 1,
  inRevisione: 2,
  approvate: 3,
  inviate: 1,
  inAttesa: 1,
  chiusePositive: 1,
  chiuseNegative: 1,
  recidive: 0,
  inAttesaOverdue: 0,
};

function risposta(ok: boolean, corpo: unknown, jsonFallisce = false) {
  return {
    ok,
    json: jsonFallisce ? () => Promise.reject(new Error("json")) : async () => corpo,
  } as never;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Dashboard - rami residui", () => {
  it("una risposta statistiche non valida mostra l'errore e non numeri falsi nelle card", async () => {
    fetchMock.mockResolvedValue(risposta(false, { error: "Errore" }));
    render(<Dashboard user={ADMIN} onNavigate={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/stats"));
    expect(await screen.findByText("Impossibile caricare le statistiche")).toBeInTheDocument();
    // Le schede mostrano "n/d" invece di zero: un valore assente non va presentato come dato.
    expect(screen.getAllByText("n/d").length).toBeGreaterThan(0);
    expect(screen.queryByText("10")).not.toBeInTheDocument();
  });

  it("gli indicatori del riepilogo aprono la lista filtrata con clic semplice", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(risposta(true, STATISTICHE));
    const onNavigate = vi.fn();
    render(<Dashboard user={ADMIN} onNavigate={onNavigate} />);
    const bozze = await screen.findByRole("link", { name: /^Bozze: 1/ });
    expect(bozze).toHaveAttribute("href", "?v=lista&stato=bozza");
    // Con Ctrl il browser apre la scheda: l'app non intercetta il clic.
    await user.keyboard("{Control>}");
    await user.click(bozze);
    await user.keyboard("{/Control}");
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(bozze);
    expect(onNavigate).toHaveBeenCalledWith({ name: "lista", stato: "bozza" });
  });
});

describe("VistaReminder - rami residui", () => {
  const onBack = vi.fn();
  const onApriDettaglio = vi.fn();

  it("risposta non valida mostra lo stato di errore e non rompe la vista", async () => {
    fetchMock.mockResolvedValue(risposta(false, {}));
    render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/reminder"));
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
    expect(screen.queryByText(/Il caricamento/i)).not.toBeInTheDocument();
  });

  it("un errore di rete mostra lo stato di errore", async () => {
    fetchMock.mockRejectedValue(new Error("rete assente"));
    render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
  });

  it("una risposta senza il campo pratiche mostra l'errore e nessun elenco", async () => {
    fetchMock.mockResolvedValue(risposta(true, {}));
    render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("un elenco pratiche vuoto mostra il messaggio di nessuna pratica sopra soglia", async () => {
    fetchMock.mockResolvedValue(risposta(true, { sogliaGiorni: 30, count: 0, pratiche: [] }));
    render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    expect(await screen.findByText("Nessuna pratica supera la soglia.")).toBeInTheDocument();
    expect(screen.queryByText("Impossibile caricare le pratiche in attesa")).not.toBeInTheDocument();
  });

  it("un JSON non valido in risposta positiva segnala l'errore", async () => {
    fetchMock.mockResolvedValue(risposta(true, undefined, true));
    render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText("Impossibile caricare le pratiche in attesa")).toBeInTheDocument();
  });

  it("smontaggio prima della risposta: la richiesta parte e il componente non lancia errori", async () => {
    let risolvi: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((r) => {
        risolvi = r;
      }),
    );
    const { unmount } = render(<VistaReminder user={ADMIN} onBack={onBack} onApriDettaglio={onApriDettaglio} />);
    unmount();
    risolvi(risposta(false, {}));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("VistaReminder - errore dopo lo smontaggio", () => {
  it("un errore di rete arrivato dopo lo smontaggio è gestito senza errori non catturati", async () => {
    let rifiuta: (e: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((_r, rej) => {
        rifiuta = rej;
      }),
    );
    const { unmount } = render(<VistaReminder user={ADMIN} onBack={vi.fn()} onApriDettaglio={vi.fn()} />);
    unmount();
    rifiuta(new Error("rete assente"));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith("/api/reminder");
  });
});
