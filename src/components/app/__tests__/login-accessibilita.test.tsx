// @vitest-environment jsdom
/**
 * Schermata di accesso: l'errore del server è collegato ai campi e il tema
 * è presente senza sovrapporsi agli altri elementi.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "@/components/app/login-screen";

describe("LoginScreen - errori e contesto", () => {
  it("un errore di accesso è annunciato e collegato ai campi", async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error("Credenziali non valide"));
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);
    await user.type(screen.getByLabelText("Email"), "a@b.it");
    await user.type(screen.getByLabelText("Password"), "segreta");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    const avviso = await screen.findByRole("alert");
    expect(avviso).toHaveTextContent("Credenziali non valide");
    expect(avviso).toHaveAttribute("id", "errore-login");
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", "errore-login");
  });

  it("un errore imprevisto usa il messaggio generico", async () => {
    const onLogin = vi.fn().mockRejectedValue("non un errore");
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);
    await user.type(screen.getByLabelText("Email"), "a@b.it");
    await user.type(screen.getByLabelText("Password"), "segreta");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Si è verificato un errore imprevisto. Riprova.");
  });

  it("spiega come ottenere un account e offre il selettore del tema", () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByText(/rivolgiti al referente del tuo territorio/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tema/i })).toBeInTheDocument();
  });
});
