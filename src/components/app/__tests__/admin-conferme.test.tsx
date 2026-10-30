// @vitest-environment jsdom
/**
 * Azioni distruttive dell'amministrazione: la conferma descrive l'elemento
 * coinvolto e la richiesta parte solo dopo la conferma esplicita.
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

describe("PannelloAdmin - conferme di eliminazione", () => {
  it("la conferma nomina la regione e la richiesta parte solo dopo 'Elimina'", async () => {
    const user = userEvent.setup();
    render(<PannelloAdmin user={ADMIN} />);
    await user.click(await screen.findByRole("button", { name: "Elimina Lombardia" }));
    expect(await screen.findByText(/Eliminare la regione «Lombardia»\? Non si può annullare\./)).toBeInTheDocument();
    expect(richiesteDelete()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(richiesteDelete()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Elimina Lombardia" }));
    await user.click(await screen.findByRole("button", { name: "Elimina" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/config/regioni/7", expect.objectContaining({ method: "DELETE" }));
    });
  });
});
