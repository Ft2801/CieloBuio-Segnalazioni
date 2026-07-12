/**
 * Test di rendering per i componenti app semplici:
 * AutoreLink, LoginScreen.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutoreLink } from "@/components/app/autore-link";
import { LoginScreen } from "@/components/app/login-screen";

describe("AutoreLink", () => {
  it("renderizza un link al portfolio", () => {
    render(<AutoreLink />);
    const link = screen.getByRole("link", { name: /Fabio Tempera/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("https://ft2801.github.io/Portfolio");
  });

  it("apre in nuova scheda con rel noopener noreferrer", () => {
    render(<AutoreLink />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("accetta className personalizzata", () => {
    render(<AutoreLink className="custom-class" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("custom-class");
  });

  it("usa className vuota di default", () => {
    render(<AutoreLink />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("text-primary");
  });
});

describe("LoginScreen", () => {
  it("renderizza il form di login con email e password", () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByText("CieloBuio")).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accedi/i })).toBeInTheDocument();
  });

  it("mostra errore se onLogin lancia un'eccezione", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockRejectedValue(new Error("Credenziali non valide"));
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toContain("Credenziali non valide");
  });

  it("mostra errore generico se onLogin lancia non-Error", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockRejectedValue("string error");
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toContain("Errore sconosciuto");
  });

  it("chiama onLogin con email e password al submit", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue({ ok: true });
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    expect(onLogin).toHaveBeenCalledWith("test@test.it", "password123", undefined);
  });

  it("mostra 'Accesso in corso...' durante il caricamento", async () => {
    const user = userEvent.setup();
    let resolveLogin: (v: unknown) => void;
    const onLogin = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    expect(screen.getByRole("button", { name: /Accesso in corso/i })).toBeDisabled();
    resolveLogin!({ ok: true });
  });

  it("mostra il link al portfolio in fondo", () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Fabio Tempera/i })).toBeInTheDocument();
  });

  it("mostra il riferimento a SETUP.md per le credenziali demo", () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByText(/SETUP.md/i)).toBeInTheDocument();
  });

  it("mostra campo TOTP quando il server richiede 2FA (requiresTotp=true)", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue({ ok: false, requiresTotp: true, error: "2FA richiesto" });
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    // Dopo la risposta requiresTotp, il campo TOTP deve apparire
    expect(await screen.findByLabelText(/Codice TOTP/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
    expect(screen.getByText(/Inserisci il codice a 6 cifre/i)).toBeInTheDocument();
  });

  it("invia totpToken al secondo submit quando 2FA è attivo", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn()
      .mockResolvedValueOnce({ ok: false, requiresTotp: true, error: "2FA richiesto" })
      .mockResolvedValueOnce({ ok: true });
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    // Attendi che il campo TOTP appaia
    const totpInput = await screen.findByLabelText(/Codice TOTP/i);
    await user.type(totpInput, "123456");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    // Seconda chiamata deve includere il totpToken
    expect(onLogin).toHaveBeenNthCalledWith(2, "test@test.it", "password123", "123456");
  });

  it("sanitizza input TOTP: solo cifre, max 6 caratteri", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue({ ok: false, requiresTotp: true, error: "2FA richiesto" });
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByLabelText(/Email/i), "test@test.it");
    await user.type(screen.getByLabelText(/Password/i), "password123");
    await user.click(screen.getByRole("button", { name: /Accedi/i }));

    const totpInput = await screen.findByLabelText(/Codice TOTP/i);
    // Prova a digitare lettere e più di 6 cifre
    await user.type(totpInput, "abc123456789");
    // Solo cifre devono passare, e massimo 6
    expect((totpInput as HTMLInputElement).value).toBe("123456");
  });
});
