// @vitest-environment jsdom
/**
 * Copertura di ListaSegnalazioni: gestione delle richieste concorrenti,
 * debounce della ricerca, paginazione e relativi errori.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListaSegnalazioni } from "@/components/app/lista-segnalazioni";

const UTENTE = {
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

function riga(id: string) {
  return {
    id,
    numeroProtocollo: `P-${id}`,
    dataSegnalazione: "2026-01-01T00:00:00.000Z",
    stato: "bozza",
    volontarioId: "u-admin",
    comune: { id: 1, nome: "Milano" },
    provincia: { id: 1, sigla: "MI", nome: "Milano" },
    regione: { id: 1, nome: "Lombardia" },
    volontario: { id: "u-admin", nomeCognome: "Admin" },
    tipologia: "Insegna",
    tipologiaLabel: "Insegna",
    indirizzoVia: "Via Test 1",
    cap: "20100",
    latitudine: null,
    longitudine: null,
    allegati: [],
  } as never;
}

function ok(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
}

function ko(): Response {
  return {
    ok: false,
    status: 500,
    json: async () => {
      throw new Error("corpo non JSON");
    },
    text: async () => "",
  } as unknown as Response;
}

function differita<T>() {
  let risolvi: (v: T) => void = () => {};
  let rifiuta: (e: unknown) => void = () => {};
  const promessa = new Promise<T>((res, rej) => {
    risolvi = res;
    rifiuta = rej;
  });
  return { promessa, risolvi, rifiuta };
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

function renderLista(onApriDettaglio = vi.fn()) {
  return render(<ListaSegnalazioni user={UTENTE} onApriDettaglio={onApriDettaglio} onNuovaSegnalazione={vi.fn()} />);
}

describe("ListaSegnalazioni - caricamento", () => {
  it("una risposta non OK al caricamento mostra lo stato di errore", async () => {
    fetchMock.mockResolvedValue(ko());
    renderLista();
    expect(await screen.findByText("Impossibile caricare le segnalazioni")).toBeInTheDocument();
    expect(screen.queryAllByText("P-a")).toHaveLength(0);
  });

  it("una risposta non OK a una nuova ricerca svuota l'elenco e mostra l'errore", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ segnalazioni: [riga("a")], pagination: { hasMore: false, total: 1 } }))
      .mockResolvedValue(ko());
    renderLista();
    await screen.findAllByText("P-a");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    expect(await screen.findByText("Impossibile caricare le segnalazioni")).toBeInTheDocument();
    expect(screen.queryAllByText("P-a")).toHaveLength(0);
  });

  it("un errore di rete a una nuova ricerca svuota l'elenco e mostra l'errore", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ segnalazioni: [riga("a")], pagination: { hasMore: false, total: 1 } }))
      .mockRejectedValue(new Error("rete assente"));
    renderLista();
    await screen.findAllByText("P-a");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    expect(await screen.findByText("Impossibile caricare le segnalazioni")).toBeInTheDocument();
    expect(screen.queryAllByText("P-a")).toHaveLength(0);
  });

  it("mostra le righe e apre il dettaglio al clic", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok({ segnalazioni: [riga("a")], pagination: { hasMore: false, total: 1 } }));
    const onApriDettaglio = vi.fn();
    renderLista(onApriDettaglio);
    await user.click((await screen.findAllByRole("link"))[0] as HTMLElement);
    expect(onApriDettaglio).toHaveBeenCalledWith("a");
  });

  it("la risposta più vecchia non sovrascrive quella di una ricerca più recente", async () => {
    const vecchia = differita<Response>();
    fetchMock
      .mockReturnValueOnce(vecchia.promessa)
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    const campo = screen.getByRole("searchbox");
    fireEvent.change(campo, { target: { value: "milano" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      vecchia.risolvi(ok({ segnalazioni: [riga("vecchia")], pagination: { hasMore: false, total: 1 } }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryAllByText("P-vecchia")).toHaveLength(0);
    expect(screen.getAllByText("P-nuova").length).toBeGreaterThan(0);
  });

  it("digitazioni ravvicinate inviano solo la ricerca finale dopo il debounce", async () => {
    fetchMock.mockResolvedValue(ok({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    renderLista();
    const campo = screen.getByRole("searchbox");
    fireEvent.change(campo, { target: { value: "a" } });
    fireEvent.change(campo, { target: { value: "ab" } });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("search=ab"))).toBe(true));
    const ricercheParziali = fetchMock.mock.calls.filter((c) => /search=a(&|$)/.test(String(c[0])));
    expect(ricercheParziali).toHaveLength(0);
  });
});

describe("ListaSegnalazioni - paginazione", () => {
  const primaPagina = ok({
    segnalazioni: [riga("a"), riga("b")],
    pagination: { hasMore: true, total: 3 },
  });

  it("carica la pagina successiva e aggiunge le righe", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(primaPagina)
      .mockResolvedValueOnce(ok({ segnalazioni: [riga("c")], pagination: { hasMore: false, total: 3 } }));
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    expect((await screen.findAllByText("P-c")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Carica altre/i })).not.toBeInTheDocument();
  });

  it("una risposta non OK chiude la paginazione", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(primaPagina).mockResolvedValueOnce(ko());
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Carica altre/i })).not.toBeInTheDocument());
  });

  it("un corpo non JSON non aggiunge righe e chiude la paginazione", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(primaPagina).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("non JSON");
      },
      text: async () => "",
    } as unknown as Response);
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Carica altre/i })).not.toBeInTheDocument());
    expect(screen.getAllByText("P-a").length).toBeGreaterThan(0);
  });

  it("un errore di rete chiude la paginazione", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(primaPagina).mockRejectedValueOnce(new Error("rete assente"));
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Carica altre/i })).not.toBeInTheDocument());
  });

  it("una nuova ricerca durante il caricamento non lascia il pulsante bloccato", async () => {
    const user = userEvent.setup();
    const paginaInCorso = differita<Response>();
    fetchMock
      .mockResolvedValueOnce(primaPagina)
      .mockReturnValueOnce(paginaInCorso.promessa)
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "roma" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      paginaInCorso.risolvi(ok({ segnalazioni: [riga("vecchia")], pagination: { hasMore: false, total: 3 } }));
    });
    await waitFor(() => expect(screen.queryByText(/Caricamento…/)).not.toBeInTheDocument());
    expect(screen.queryAllByText("P-vecchia")).toHaveLength(0);
  });
});

describe("ListaSegnalazioni - risposte superate durante la lettura", () => {
  it("una lettura JSON superata da una ricerca più recente non sovrascrive l'elenco", async () => {
    const jsonVecchio = differita<unknown>();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => jsonVecchio.promessa, text: async () => "" })
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "torino" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      jsonVecchio.risolvi({ segnalazioni: [riga("vecchia")], pagination: { hasMore: false, total: 1 } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryAllByText("P-vecchia")).toHaveLength(0);
  });

  it("un errore di rete di una lettura superata non cancella l'elenco più recente", async () => {
    const vecchia = differita<Response>();
    fetchMock
      .mockReturnValueOnce(vecchia.promessa)
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bari" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      vecchia.rifiuta(new Error("rete assente"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByText("P-nuova").length).toBeGreaterThan(0);
  });

  it("una paginazione superata nel leggere il JSON non aggiunge righe", async () => {
    const user = userEvent.setup();
    const jsonPagina = differita<unknown>();
    fetchMock
      .mockResolvedValueOnce(ok({ segnalazioni: [riga("a")], pagination: { hasMore: true, total: 2 } }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => jsonPagina.promessa, text: async () => "" })
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "genova" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      jsonPagina.risolvi({ segnalazioni: [riga("superata")], pagination: { hasMore: true, total: 9 } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryAllByText("P-superata")).toHaveLength(0);
  });

  it("un errore di rete di una paginazione superata viene ignorato", async () => {
    const user = userEvent.setup();
    const paginaRifiutata = differita<Response>();
    fetchMock
      .mockResolvedValueOnce(ok({ segnalazioni: [riga("a")], pagination: { hasMore: true, total: 2 } }))
      .mockReturnValueOnce(paginaRifiutata.promessa)
      .mockResolvedValue(ok({ segnalazioni: [riga("nuova")], pagination: { hasMore: false, total: 1 } }));
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "napoli" } });
    await screen.findAllByText("P-nuova");
    await act(async () => {
      paginaRifiutata.rifiuta(new Error("rete assente"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByText("P-nuova").length).toBeGreaterThan(0);
  });

  it("il link della pratica apre il dettaglio solo con clic semplice, non con modificatori", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok({ segnalazioni: [riga("a")], pagination: { hasMore: false, total: 1 } }));
    const onApriDettaglio = vi.fn();
    renderLista(onApriDettaglio);
    const link = (await screen.findAllByRole("link"))[0] as HTMLElement;
    expect(link).toHaveAttribute("href", "?v=dettaglio&id=a");
    await user.keyboard("{Control>}");
    await user.click(link);
    await user.keyboard("{/Control}");
    expect(onApriDettaglio).not.toHaveBeenCalled();
    await user.click(link);
    expect(onApriDettaglio).toHaveBeenCalledTimes(1);
    expect(onApriDettaglio).toHaveBeenCalledWith("a");
  });
});

describe("ListaSegnalazioni - esportazione CSV (casi limite)", () => {
  const createObjectURL = vi.fn(() => "blob:test");

  beforeEach(() => {
    createObjectURL.mockClear();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  it("in sessione demo non richiede il file al server", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    render(
      <ListaSegnalazioni
        user={{ ...(UTENTE as object), isDemo: true } as never}
        onApriDettaglio={vi.fn()}
        onNuovaSegnalazione={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /Esporta in CSV/i }));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("export"))).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("risposta non OK con messaggio: non scarica il file", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Troppe richieste" }) });
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Esporta in CSV/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("risposta non OK con corpo non JSON: non scarica il file", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new SyntaxError("corpo non JSON");
      },
    });
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Esporta in CSV/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("errore di rete durante l'esportazione: non scarica il file", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockRejectedValueOnce(new Error("rete assente"));
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Esporta in CSV/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
