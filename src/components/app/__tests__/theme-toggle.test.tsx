/**
 * Test per ThemeToggle: pulsante Tema scuro in variante icona (barre superiori)
 * ed estesa (barra laterale). Verifica nome accessibile, aria-pressed e persistenza.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { CHIAVE_TEMA } from "@/lib/tema";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle - variante icona", () => {
  it("ha nome accessibile Tema scuro e stato non premuto in tema chiaro", () => {
    render(<ThemeToggle />);
    const pulsante = screen.getByRole("button", { name: "Tema scuro" });
    expect(pulsante).toHaveAttribute("aria-pressed", "false");
  });

  it("passa al tema scuro, lo salva e aggiorna aria-pressed", () => {
    render(<ThemeToggle />);
    const pulsante = screen.getByRole("button", { name: "Tema scuro" });
    fireEvent.click(pulsante);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(CHIAVE_TEMA)).toBe("scuro");
    expect(pulsante).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tema scuro" })).toBeInTheDocument();
  });

  it("torna al tema chiaro al secondo click", () => {
    render(<ThemeToggle />);
    const pulsante = screen.getByRole("button", { name: "Tema scuro" });
    fireEvent.click(pulsante);
    fireEvent.click(pulsante);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(CHIAVE_TEMA)).toBe("chiaro");
    expect(pulsante).toHaveAttribute("aria-pressed", "false");
  });

  it("riflette un tema già attivo al montaggio", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle className="extra" />);
    const pulsante = screen.getByRole("button", { name: "Tema scuro" });
    expect(pulsante).toHaveAttribute("aria-pressed", "true");
    expect(pulsante).toHaveClass("extra");
  });

  it("si rende sul server senza tema scuro (stato iniziale chiaro)", () => {
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Tema scuro"');
  });
});

describe("ThemeToggle - variante estesa", () => {
  it("mostra l'etichetta visibile Tema scuro con stato aria-pressed", () => {
    render(<ThemeToggle variant="estesa" className="extra" />);
    const pulsante = screen.getByRole("button", { name: "Tema scuro" });
    expect(pulsante).toHaveAttribute("aria-pressed", "false");
    expect(pulsante).toHaveClass("extra");
    fireEvent.click(pulsante);
    expect(pulsante).toHaveAttribute("aria-pressed", "true");
  });
});
