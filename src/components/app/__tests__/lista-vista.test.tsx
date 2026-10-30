// @vitest-environment jsdom
/**
 * Copertura della vista Segnalazioni: modalità demo, filtri, ricerca,
 * paginazione, errori di caricamento, esportazione CSV e navigazione
 * verso il dettaglio con link reali.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser, Segnalazione } from "@/lib/types";
import { DEMO_SEGNALAZIONI as DEMO_REALI } from "@/lib/demo-data";
import { plurale } from "@/lib/format";
import { ListaSegnalazioni } from "@/components/app/lista-segnalazioni";

const { toastMock, demoOverride } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  demoOverride: { current: null as Segnalazione[] | null },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Override opzionale dei dati demo per coprire i rami con campi mancanti.
vi.mock("@/lib/demo-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo-data")>();
  return {
    ...actual,
    get DEMO_SEGNALAZIONI() {
      return demoOverride.current ?? actual.DEMO_SEGNALAZIONI;
    },
  };
});

const fetchMock = vi.fn();

function utente(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "user@example.it",
    nomeCognome: "Mario Rossi",
    ruolo: "referente_provinciale",
    provinciaId: 1,
    regioneId: 1,
    inizialiProtocollo: "MR",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
    ...overrides,
  } as SessionUser;
}

function utenteDemo(): SessionUser {
  return { ...utente(), isDemo: true } as unknown as SessionUser;
}

function segnalazione(overrides: Partial<Segnalazione> & { id: string }): Segnalazione {
  return {
    numeroProtocollo: null,
    dataSegnalazione: "2026-01-01T00:00:00.000Z",
    stato: "in_revisione",
    indirizzoVia: "Via Test 1",
    nomeEsercizio: null,
    comune: { id: 1, nome: "Comune Test", pecComune: null, nomeSindaco: null },
    provincia: { id: 1, sigla: "TT", nome: "Provincia Test" },
    volontario: { id: "v1", nomeCognome: "Volontario Test", email: "v@test.it" },
    livelloRecidiva: 1,
    _count: { allegati: 0 },
    ...overrides,
  } as unknown as Segnalazione;
}

function risposta(corpo: unknown, ok = true) {
  return {
    ok,
    json: async () => corpo,
    blob: async () => new Blob(["csv"], { type: "text/csv" }),
  } as unknown as Response;
}

function renderLista(props: { user?: SessionUser; filtroStatoIniziale?: Segnalazione["stato"] | "all" } = {}) {
  const onApriDettaglio = vi.fn();
  const onNuovaSegnalazione = vi.fn();
  render(
    <ListaSegnalazioni
      user={props.user ?? utente()}
      filtroStatoIniziale={props.filtroStatoIniziale}
      onApriDettaglio={onApriDettaglio}
      onNuovaSegnalazione={onNuovaSegnalazione}
    />,
  );
  return { onApriDettaglio, onNuovaSegnalazione };
}

beforeAll(() => {
  // Radix Select usa API di puntatore non presenti in jsdom.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.mockReset();
  demoOverride.current = null;
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ListaSegnalazioni - modalità demo", () => {
  it("mostra i dati statici senza richieste di rete e con il conteggio corretto", async () => {
    renderLista({ user: utenteDemo() });
    const atteso = plurale(DEMO_REALI.length, "segnalazione trovata", "segnalazioni trovate");
    expect(await screen.findByText(atteso)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filtra per stato iniziale", async () => {
    renderLista({ user: utenteDemo(), filtroStatoIniziale: "bozza" });
    const n = DEMO_REALI.filter((s) => s.stato === "bozza").length;
    expect(await screen.findByText(plurale(n, "segnalazione trovata", "segnalazioni trovate"))).toBeInTheDocument();
  });

  it("la ricerca testuale con debounce restringe i risultati e mostra lo stato vuoto", async () => {
    const user = userEvent.setup();
    renderLista({ user: utenteDemo() });
    await screen.findByText(plurale(DEMO_REALI.length, "segnalazione trovata", "segnalazioni trovate"));
    await user.type(screen.getByRole("searchbox", { name: /Cerca per indirizzo/i }), "zzzz-nessuno");
    expect(await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.")).toBeInTheDocument();
  });

  it("la ricerca trova per indirizzo, protocollo e comune, e gestisce campi mancanti", async () => {
    demoOverride.current = [
      segnalazione({ id: "a", indirizzoVia: "Via Alfa", numeroProtocollo: "P-ALFA", comune: null, provincia: null }),
      segnalazione({ id: "b", indirizzoVia: "Via Beta", numeroProtocollo: null }),
    ];
    const user = userEvent.setup();
    renderLista({ user: utenteDemo() });
    const campo = await screen.findByRole("searchbox", { name: /Cerca per indirizzo/i });
    // Per protocollo (il primo record ha protocollo, il secondo no).
    await user.type(campo, "p-alfa");
    expect((await screen.findAllByText("Via Alfa")).length).toBeGreaterThan(0);
    await user.clear(campo);
    // Per comune: il primo record non ha comune (ramo ?? ""), il secondo sì.
    await user.type(campo, "comune test");
    await waitFor(() => expect(screen.queryByText("Via Alfa")).not.toBeInTheDocument());
    expect(screen.getAllByText("Via Beta").length).toBeGreaterThan(0);
    await user.clear(campo);
    await user.type(campo, "via beta");
    expect((await screen.findAllByText("Via Beta")).length).toBeGreaterThan(0);
  });

  it("l'esportazione in demo non chiama la rete e avvisa l'utente", async () => {
    const user = userEvent.setup();
    renderLista({ user: utenteDemo() });
    await screen.findByText(plurale(DEMO_REALI.length, "segnalazione trovata", "segnalazioni trovate"));
    await user.click(screen.getByRole("button", { name: "Esporta in CSV" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Esportazione non disponibile" }));
  });
});

describe("ListaSegnalazioni - caricamento dalla rete", () => {
  it("mostra lo stato di caricamento finché la risposta non arriva", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderLista();
    expect(screen.getByRole("status")).toHaveTextContent("Caricamento in corso");
  });

  it("mostra righe con titolo, protocollo, allegati, recidiva e volontario", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [
          segnalazione({
            id: "s1",
            nomeEsercizio: "Bar Centrale",
            numeroProtocollo: "20260101-TT-X-XX01",
            stato: "inviata",
            livelloRecidiva: 3,
            _count: { allegati: 2 },
          }),
          segnalazione({
            id: "s2",
            indirizzoVia: "Via Senza Dati",
            volontario: undefined,
            comune: null,
            provincia: null,
          }),
        ],
        pagination: { hasMore: false, total: 2 },
      }),
    );
    renderLista();
    expect((await screen.findAllByText("Bar Centrale")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/segnalazioni?limit=50&offset=0");
    expect(screen.getByText("2 segnalazioni trovate")).toBeInTheDocument();
    expect(screen.getAllByText("20260101-TT-X-XX01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 allegati").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recidiva 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("n/d").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Via Senza Dati").length).toBeGreaterThan(0);
    expect(screen.getByText("2 segnalazioni")).toBeInTheDocument();
  });

  it("usa il singolare per un solo allegato e nasconde la recidiva di primo livello", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [segnalazione({ id: "s1", _count: { allegati: 1 }, livelloRecidiva: 1 })],
        pagination: { hasMore: false, total: 1 },
      }),
    );
    renderLista();
    expect((await screen.findAllByText("1 allegato")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Recidiva/)).not.toBeInTheDocument();
    expect(screen.getByText("1 segnalazione")).toBeInTheDocument();
  });

  it("non mostra il conteggio allegati quando è zero o non è presente", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [segnalazione({ id: "s1" }), segnalazione({ id: "s2", _count: undefined })],
        pagination: { hasMore: false, total: 2 },
      }),
    );
    renderLista();
    await screen.findAllByText("Via Test 1");
    expect(screen.queryByText(/allegat/)).not.toBeInTheDocument();
  });

  it("il filtro per stato richiede le segnalazioni dello stato scelto", async () => {
    fetchMock.mockResolvedValue(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    const user = userEvent.setup();
    renderLista();
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.click(screen.getByRole("combobox", { name: "Filtra per stato" }));
    await user.click(await screen.findByRole("option", { name: /Inviat/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/segnalazioni?stato=inviata&limit=50&offset=0"),
    );
  });

  it("mostra lo stato vuoto e il pulsante per creare una segnalazione", async () => {
    fetchMock.mockResolvedValue(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    const user = userEvent.setup();
    const { onNuovaSegnalazione } = renderLista();
    await user.click(await screen.findByRole("button", { name: /Crea una nuova segnalazione/i }));
    expect(onNuovaSegnalazione).toHaveBeenCalledTimes(1);
  });

  it("gestisce una risposta con JSON non valido come elenco vuoto", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("json");
      },
    } as unknown as Response);
    renderLista();
    expect(await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.")).toBeInTheDocument();
  });

  it("con risposta non valida mostra l'errore e riprova al clic", async () => {
    fetchMock.mockResolvedValueOnce(risposta({ error: "x" }, false));
    fetchMock.mockResolvedValueOnce(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    const user = userEvent.setup();
    renderLista();
    expect(await screen.findByText("Impossibile caricare le segnalazioni")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Riprova/i }));
    expect(await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.")).toBeInTheDocument();
  });

  it("un errore di rete mostra l'errore", async () => {
    fetchMock.mockRejectedValue(new Error("rete"));
    renderLista();
    expect(await screen.findByText("Impossibile caricare le segnalazioni")).toBeInTheDocument();
    expect(screen.getByText("Verifica la connessione e riprova.")).toBeInTheDocument();
  });

  it("include lo stato filtrato nella richiesta", async () => {
    fetchMock.mockResolvedValue(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    renderLista({ filtroStatoIniziale: "inviata" });
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    expect(fetchMock).toHaveBeenCalledWith("/api/segnalazioni?stato=inviata&limit=50&offset=0");
  });

  it("la ricerca testuale viene inviata al server dopo il debounce", async () => {
    fetchMock.mockResolvedValue(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    const user = userEvent.setup();
    renderLista();
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.type(screen.getByRole("searchbox", { name: /Cerca per indirizzo/i }), "  Roma ");
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("search=Roma")));
  });
});

describe("ListaSegnalazioni - paginazione", () => {
  it("carica la pagina successiva e aggiorna il conteggio", async () => {
    fetchMock.mockResolvedValueOnce(
      risposta({ segnalazioni: [segnalazione({ id: "s1" })], pagination: { hasMore: true, total: 3 } }),
    );
    fetchMock.mockResolvedValueOnce(
      risposta({ segnalazioni: [segnalazione({ id: "s2" })], pagination: { hasMore: false, total: 3 } }),
    );
    const user = userEvent.setup();
    renderLista();
    await user.click(await screen.findByRole("button", { name: "Carica altre (visualizzate 1 di 3)" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/segnalazioni?limit=50&offset=1");
    expect(await screen.findByText("2 di 3 segnalazioni caricate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Carica altre/ })).not.toBeInTheDocument();
  });

  it("una pagina successiva in errore nasconde il pulsante", async () => {
    fetchMock.mockResolvedValueOnce(
      risposta({ segnalazioni: [segnalazione({ id: "s1" })], pagination: { hasMore: true, total: 3 } }),
    );
    fetchMock.mockResolvedValueOnce(risposta({ error: "x" }, false));
    const user = userEvent.setup();
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Carica altre/ })).not.toBeInTheDocument());
  });

  it("un errore di rete nella pagina successiva nasconde il pulsante", async () => {
    fetchMock.mockResolvedValueOnce(
      risposta({ segnalazioni: [segnalazione({ id: "s1" })], pagination: { hasMore: true, total: 3 } }),
    );
    fetchMock.mockRejectedValueOnce(new Error("rete"));
    const user = userEvent.setup();
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Carica altre/ })).not.toBeInTheDocument());
  });

  it("la pagina successiva con JSON non valido non aggiunge righe", async () => {
    fetchMock.mockResolvedValueOnce(
      risposta({ segnalazioni: [segnalazione({ id: "s1" })], pagination: { hasMore: true, total: 2 } }),
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("json");
      },
    } as unknown as Response);
    const user = userEvent.setup();
    renderLista();
    await user.click(await screen.findByRole("button", { name: /Carica altre/ }));
    await waitFor(() => expect(screen.getByText("1 di 2 segnalazioni caricate")).toBeInTheDocument());
  });
});

describe("ListaSegnalazioni - esportazione CSV", () => {
  it("scarica il file con la data del giorno nel nome e non apre schede", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchMock.mockResolvedValueOnce(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockResolvedValueOnce(risposta({}));
    const user = userEvent.setup();
    renderLista({ filtroStatoIniziale: "bozza" });
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.click(screen.getByRole("button", { name: "Esporta in CSV" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/segnalazioni/export?stato=bozza");
    expect(openSpy).not.toHaveBeenCalled();
    const oggi = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(`segnalazioni-${oggi}.csv`);
  });

  it("mostra il messaggio del server quando l'esportazione fallisce", async () => {
    fetchMock.mockResolvedValueOnce(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockResolvedValueOnce(risposta({ error: "Troppe richieste" }, false));
    const user = userEvent.setup();
    renderLista();
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.click(screen.getByRole("button", { name: "Esporta in CSV" }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Esportazione non riuscita", description: "Troppe richieste" }),
      ),
    );
  });

  it("usa il messaggio predefinito quando la risposta di errore non è JSON", async () => {
    fetchMock.mockResolvedValueOnce(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("json");
      },
    } as unknown as Response);
    const user = userEvent.setup();
    renderLista();
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.click(screen.getByRole("button", { name: "Esporta in CSV" }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: "Riprova tra qualche minuto." })),
    );
  });

  it("un errore di rete durante l'esportazione mostra un avviso", async () => {
    fetchMock.mockResolvedValueOnce(risposta({ segnalazioni: [], pagination: { hasMore: false, total: 0 } }));
    fetchMock.mockRejectedValueOnce(new Error("rete"));
    const user = userEvent.setup();
    renderLista();
    await screen.findByText("Nessuna segnalazione trovata con i filtri selezionati.");
    await user.click(screen.getByRole("button", { name: "Esporta in CSV" }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Verifica la connessione e riprova." }),
      ),
    );
  });
});

describe("ListaSegnalazioni - navigazione verso il dettaglio", () => {
  it("il clic semplice sul titolo apre il dettaglio, quello con modificatore no", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [segnalazione({ id: "a", indirizzoVia: "Via Apri" })],
        pagination: { hasMore: false, total: 1 },
      }),
    );
    const user = userEvent.setup();
    const { onApriDettaglio } = renderLista();
    const link = (await screen.findAllByRole("link"))[0];
    expect(link).toHaveAttribute("href", "?v=dettaglio&id=a");
    await user.keyboard("{Control>}");
    await user.click(link);
    await user.keyboard("{/Control}");
    expect(onApriDettaglio).not.toHaveBeenCalled();
    await user.click(link);
    expect(onApriDettaglio).toHaveBeenCalledWith("a");
  });

  it("la riga senza protocollo e senza comune mostra l'indirizzo come titolo", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [
          segnalazione({ id: "s-senza-prot", indirizzoVia: "Via Senza Protocollo", comune: null, provincia: null }),
        ],
        pagination: { hasMore: false, total: 1 },
      }),
    );
    renderLista();
    const link = (await screen.findAllByRole("link", { name: /Via Senza Protocollo/ }))[0];
    expect(link).toHaveAttribute("href", "?v=dettaglio&id=s-senza-prot");
  });

  it("il clic sulla scheda mobile apre il dettaglio della pratica", async () => {
    fetchMock.mockResolvedValue(
      risposta({ segnalazioni: [segnalazione({ id: "m1" })], pagination: { hasMore: false, total: 1 } }),
    );
    const user = userEvent.setup();
    const { onApriDettaglio } = renderLista();
    const schede = (await screen.findAllByRole("link")).filter((l) => l.getAttribute("href") === "?v=dettaglio&id=m1");
    await user.click(schede[1]);
    expect(onApriDettaglio).toHaveBeenCalledWith("m1");
  });

  it("la tabella ha una didascalia e la scheda mobile contiene lo stesso link", async () => {
    fetchMock.mockResolvedValue(
      risposta({ segnalazioni: [segnalazione({ id: "b" })], pagination: { hasMore: false, total: 1 } }),
    );
    renderLista();
    await screen.findAllByRole("link");
    const tabella = screen.getByRole("table", { name: "Elenco delle segnalazioni" });
    expect(within(tabella).getAllByRole("link")[0]).toHaveAttribute("href", "?v=dettaglio&id=b");
    const schede = screen.getAllByRole("link").filter((l) => l.getAttribute("href") === "?v=dettaglio&id=b");
    expect(schede).toHaveLength(2);
  });
});

describe("ListaSegnalazioni - riga del luogo", () => {
  const comuneBergamasco = {
    id: 2,
    nome: "Castelvetro Lombardo",
    pecComune: "castelvetro@pec.it",
    nomeSindaco: "Sindaco Test",
  };
  const provinciaBergamo = { id: 2, sigla: "BG", nome: "Bergamo" };

  it("non ripete l'indirizzo quando è già il titolo della pratica", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [
          segnalazione({
            id: "s10",
            indirizzoVia: "Via Garibaldi 22",
            comune: comuneBergamasco,
            provincia: provinciaBergamo,
          }),
        ],
        total: 1,
      }),
    );
    renderLista();
    expect((await screen.findAllByText("Castelvetro Lombardo (BG)")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Via Garibaldi 22, Castelvetro Lombardo (BG)")).not.toBeInTheDocument();
  });

  it("mostra indirizzo, comune e provincia quando l'esercizio ha già un nome", async () => {
    fetchMock.mockResolvedValue(
      risposta({
        segnalazioni: [
          segnalazione({
            id: "s11",
            nomeEsercizio: "Bar Centrale",
            indirizzoVia: "Via Garibaldi 22",
            comune: comuneBergamasco,
            provincia: provinciaBergamo,
          }),
        ],
        total: 1,
      }),
    );
    renderLista();
    expect((await screen.findAllByText("Via Garibaldi 22, Castelvetro Lombardo (BG)")).length).toBeGreaterThan(0);
  });
});
