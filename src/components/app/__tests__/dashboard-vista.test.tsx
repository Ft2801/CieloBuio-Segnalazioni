// @vitest-environment jsdom
/**
 * Copertura della Dashboard: statistiche dal server e in demo, errori con
 * riprova, attività da fare per ruolo, banner delle pratiche scadute e
 * navigazione verso le altre viste tramite link reali.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser, Segnalazione } from "@/lib/types";
import { DEMO_SEGNALAZIONI } from "@/lib/demo-data";
import { Dashboard } from "@/components/app/dashboard";

const fetchMock = vi.fn();

const STATISTICHE = {
  sogliaGiorni: 30,
  totali: 10,
  bozze: 1,
  inRevisione: 2,
  approvate: 3,
  inviate: 4,
  inAttesa: 5,
  chiusePositive: 1,
  chiuseNegative: 1,
  recidive: 0,
  inAttesaOverdue: 0,
};

function utente(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
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
    ...overrides,
  } as SessionUser;
}

function risposta(corpo: unknown, ok = true) {
  return {
    ok,
    json: async () => corpo,
  } as unknown as Response;
}

function segnalazione(overrides: Partial<Segnalazione> & { id: string }): Segnalazione {
  return {
    numeroProtocollo: null,
    dataSegnalazione: "2026-01-01T00:00:00.000Z",
    stato: "bozza",
    indirizzoVia: "Via Dashboard 1",
    nomeEsercizio: null,
    comune: { id: 1, nome: "Comune Test", pecComune: null, nomeSindaco: null },
    provincia: { id: 1, sigla: "TT", nome: "Provincia Test" },
    volontario: null,
    livelloRecidiva: 1,
    ...overrides,
  } as unknown as Segnalazione;
}

/** Risponde in base all'URL: statistiche, elenchi per stato. */
function rispostePer({
  stats = risposta(STATISTICHE),
  elenchi = {} as Record<string, unknown>,
}: {
  stats?: Response | Promise<Response>;
  elenchi?: Record<string, unknown>;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/stats") return stats;
    const stato = new URL(url, "http://x").searchParams.get("stato") ?? "";
    return risposta(elenchi[stato] ?? { segnalazioni: [] });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Dashboard - statistiche", () => {
  it("mostra i valori dal server e il riepilogo testuale", async () => {
    rispostePer({});
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(
      await screen.findByText(
        "10 segnalazioni in totale · 1 chiuse con esito positivo · 1 con esito negativo · 0 recidive",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Inviate: 4/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Benvenuto, Admin" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/stats");
  });

  it("mostra le recidive al singolare quando sono una", async () => {
    rispostePer({ stats: risposta({ ...STATISTICHE, recidive: 1 }) });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/· 1 recidiva$/)).toBeInTheDocument();
  });

  it("usa il singolare per una sola segnalazione totale", async () => {
    rispostePer({ stats: risposta({ ...STATISTICHE, totali: 1 }) });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/^1 segnalazione in totale/)).toBeInTheDocument();
  });

  it("in modalità demo usa i dati statici senza richieste di rete", async () => {
    render(<Dashboard user={{ ...utente(), isDemo: true } as unknown as SessionUser} onNavigate={vi.fn()} />);
    expect(await screen.findByRole("link", { name: /^Bozze: / })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/Caricamento in corso|Nessuna attività|Completa|Da approvare|Da inviare/).length,
    ).toBeGreaterThan(0);
  });

  it("durante il caricamento mostra un trattino e non uno zero", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(screen.getByRole("link", { name: /^Bozze: n\/d/ })).toBeInTheDocument();
    expect(screen.getByText("Il riepilogo dettagliato non è disponibile.")).toBeInTheDocument();
  });
});

describe("Dashboard - errori statistiche", () => {
  it("una risposta non valida mostra l'errore e riprova al clic", async () => {
    fetchMock.mockResolvedValueOnce(risposta({ error: "x" }, false));
    fetchMock.mockResolvedValue(risposta({ segnalazioni: [] }));
    const user = userEvent.setup();
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le statistiche")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Bozze: n\/d/ })).toBeInTheDocument();
    fetchMock.mockReset();
    rispostePer({});
    await user.click(screen.getByRole("button", { name: /Riprova/ }));
    expect(await screen.findByText(/^10 segnalazioni in totale/)).toBeInTheDocument();
    expect(screen.queryByText("Impossibile caricare le statistiche")).not.toBeInTheDocument();
  });

  it("una risposta con corpo di errore JSON non viene mostrata come statistica", async () => {
    rispostePer({ stats: risposta({ error: "Server" }, true) });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le statistiche")).toBeInTheDocument();
  });

  it("un JSON non leggibile con risposta positiva segnala l'errore", async () => {
    rispostePer({
      stats: { ok: true, json: async () => Promise.reject(new Error("json")) } as unknown as Response,
    });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le statistiche")).toBeInTheDocument();
  });

  it("un errore di rete mostra l'errore", async () => {
    fetchMock.mockRejectedValue(new Error("rete"));
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Impossibile caricare le statistiche")).toBeInTheDocument();
  });
});

describe("Dashboard - attività da fare", () => {
  it("il volontario vede le bozze con la descrizione dello stato e il link al dettaglio", async () => {
    rispostePer({
      elenchi: {
        bozza: { segnalazioni: [segnalazione({ id: "b1", nomeEsercizio: "Bar Uno" })] },
      },
    });
    render(<Dashboard user={utente({ ruolo: "volontario" })} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Bar Uno")).toBeInTheDocument();
    expect(screen.getByText(/Completa e invia al referente · Comune Test/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bar Uno/ })).toHaveAttribute("href", "?v=dettaglio&id=b1");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("stato=bozza"));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("stato=in_revisione"));
  });

  it("il referente vede le pratiche in revisione e approvate", async () => {
    rispostePer({
      elenchi: {
        in_revisione: {
          segnalazioni: [segnalazione({ id: "r1", stato: "in_revisione", indirizzoVia: "Via Revisione" })],
        },
        approvata: {
          segnalazioni: [segnalazione({ id: "r2", stato: "approvata", indirizzoVia: "Via Approvata", comune: null })],
        },
      },
    });
    render(<Dashboard user={utente({ ruolo: "referente_provinciale" })} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Via Revisione")).toBeInTheDocument();
    expect(screen.getByText("Da approvare o respingere · Comune Test")).toBeInTheDocument();
    expect(screen.getByText("Da inviare via PEC")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("stato=approvata"));
  });

  it("uno stato senza azione dedicata mostra l'etichetta dello stato", async () => {
    rispostePer({
      elenchi: {
        bozza: { segnalazioni: [segnalazione({ id: "x1", stato: "inviata", indirizzoVia: "Via Inviata" })] },
      },
    });
    render(<Dashboard user={utente({ ruolo: "volontario" })} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Via Inviata")).toBeInTheDocument();
    expect(screen.queryByText(/Completa e invia/)).not.toBeInTheDocument();
  });

  it("mostra lo stato vuoto quando non ci sono attività", async () => {
    rispostePer({});
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Nessuna attività in sospeso.")).toBeInTheDocument();
  });

  it("un errore nel caricamento delle attività mostra il messaggio dedicato", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/stats") return risposta(STATISTICHE);
      return risposta({ error: "x" }, false);
    });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Non è stato possibile caricare le attività/)).toBeInTheDocument();
  });

  it("un errore di rete nelle attività mostra il messaggio dedicato", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/stats") return risposta(STATISTICHE);
      throw new Error("rete");
    });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Non è stato possibile caricare le attività/)).toBeInTheDocument();
  });

  it("in demo elenca le segnalazioni in stato da fare, al massimo cinque", async () => {
    render(<Dashboard user={{ ...utente(), isDemo: true } as unknown as SessionUser} onNavigate={vi.fn()} />);
    const attese = DEMO_SEGNALAZIONI.filter((s) => ["in_revisione", "approvata"].includes(s.stato)).slice(0, 5);
    expect(attese.length).toBeGreaterThan(0);
    expect(await screen.findByText(attese[0].nomeEsercizio ?? attese[0].indirizzoVia)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Da approvare|Da inviare|Completa/ }).length).toBeLessThanOrEqual(5);
  });
});

describe("Dashboard - banner pratiche scadute", () => {
  it("con pratiche oltre soglia mostra il banner e apre i promemoria", async () => {
    rispostePer({ stats: risposta({ ...STATISTICHE, inAttesaOverdue: 2 }) });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard user={utente()} onNavigate={onNavigate} />);
    expect(await screen.findByText("2 pratiche in attesa da oltre 30 giorni")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vai ai promemoria" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "reminder" });
  });

  it("usa il singolare per una pratica e un giorno di soglia", async () => {
    rispostePer({ stats: risposta({ ...STATISTICHE, inAttesaOverdue: 1, sogliaGiorni: 1 }) });
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("1 pratica in attesa da oltre 1 giorno")).toBeInTheDocument();
  });

  it("senza pratiche scadute il banner non compare", async () => {
    rispostePer({});
    render(<Dashboard user={utente()} onNavigate={vi.fn()} />);
    await screen.findByText(/^10 segnalazioni in totale/);
    expect(screen.queryByText(/in attesa da oltre/)).not.toBeInTheDocument();
  });
});

describe("Dashboard - navigazione", () => {
  it("il pulsante Nuova segnalazione è un link alla vista di creazione", async () => {
    rispostePer({});
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard user={utente()} onNavigate={onNavigate} />);
    const link = screen.getByRole("link", { name: /Nuova segnalazione/ });
    expect(link).toHaveAttribute("href", "?v=nuova-segnalazione");
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "nuova-segnalazione" });
  });

  it("l'indicatore Inviate apre la lista filtrata sullo stato inviata", async () => {
    rispostePer({});
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard user={utente()} onNavigate={onNavigate} />);
    await user.click(await screen.findByRole("link", { name: /^Inviate: 4/ }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "lista", stato: "inviata" });
  });

  it("un indicatore non apre nulla se il clic usa Ctrl", async () => {
    rispostePer({});
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard user={utente()} onNavigate={onNavigate} />);
    const link = await screen.findByRole("link", { name: /^In attesa: 5/ });
    await user.keyboard("{Control>}");
    await user.click(link);
    await user.keyboard("{/Control}");
    await waitFor(() => expect(onNavigate).not.toHaveBeenCalled());
  });
});

describe("Dashboard - priorità dei contatori", () => {
  it("evidenzia i contatori che richiedono un'azione e attenua gli esiti", async () => {
    rispostePer({});
    render(<Dashboard user={utente({ ruolo: "referente_provinciale" })} onNavigate={vi.fn()} />);
    const daApprovare = await screen.findByRole("link", { name: /^In revisione:/ });
    expect(daApprovare.querySelector(".text-4xl")).not.toBeNull();
    const inviate = screen.getByRole("link", { name: /^Inviate:/ });
    expect(inviate.querySelector(".text-2xl")).not.toBeNull();
    expect(inviate.querySelector(".text-4xl")).toBeNull();
  });
});
