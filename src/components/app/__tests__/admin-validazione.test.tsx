// @vitest-environment jsdom
/**
 * Validazione dei moduli di amministrazione: gli errori sono collegati ai campi,
 * il focus va al primo campo errato e scompaiono quando il modulo cambia.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser } from "@/lib/types";
import { PannelloAdmin } from "@/components/app/pannello-admin";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const fetchMock = vi.fn();

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
} as unknown as SessionUser;

const LOMBARDIA = {
  id: 7,
  regione: "Lombardia",
  riferimentoLegge: "LR 31/2015",
  titoloLegge: "",
  testoProgettoIlluminotecnico: "",
  testoDeroghe: "",
  testoDatiFotometrici: "",
  testoApprovazione: "",
  testoInstallazione: "",
  testoControllo: "",
};

function richiesteDelete() {
  return fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ regioni: [LOMBARDIA] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function apriNuovaRegione(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /Nuova/i }));
}

describe("PannelloAdmin - validazione dei moduli", () => {
  it("mostra gli errori collegati ai campi e porta il focus al primo", async () => {
    const user = userEvent.setup();
    render(<PannelloAdmin user={ADMIN} />);
    await screen.findByRole("button", { name: "Elimina Lombardia" });
    await apriNuovaRegione(user);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));

    const regione = screen.getByPlaceholderText("LOMBARDIA");
    expect(regione).toHaveAttribute("aria-invalid", "true");
    expect(regione).toHaveAttribute("aria-describedby", "errore-campo-admin-1");
    expect(screen.getByText("Inserisci il nome della regione.")).toHaveAttribute("id", "errore-campo-admin-1");
    await waitFor(() => expect(regione).toHaveFocus());
    expect(richiesteDelete()).toHaveLength(0);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("non segnala come errato un campo già compilato", async () => {
    const user = userEvent.setup();
    render(<PannelloAdmin user={ADMIN} />);
    await screen.findByRole("button", { name: "Elimina Lombardia" });
    await apriNuovaRegione(user);
    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "sicilia");
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));

    expect(screen.getByPlaceholderText("LOMBARDIA")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Inserisci il riferimento di legge.")).toBeInTheDocument();
    expect(screen.queryByText("Inserisci il nome della regione.")).not.toBeInTheDocument();
  });

  it("gli errori scompaiono quando l'utente modifica il modulo", async () => {
    const user = userEvent.setup();
    render(<PannelloAdmin user={ADMIN} />);
    await screen.findByRole("button", { name: "Elimina Lombardia" });
    await apriNuovaRegione(user);
    await user.click(screen.getByRole("button", { name: /^Salva$/i }));
    expect(screen.getByText("Inserisci il nome della regione.")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("LOMBARDIA"), "x");
    expect(screen.queryByText("Inserisci il nome della regione.")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("LOMBARDIA")).not.toHaveAttribute("aria-invalid");
  });
});
