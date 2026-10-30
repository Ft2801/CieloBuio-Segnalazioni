// @vitest-environment jsdom
/**
 * Piè di pagina: copyright con anno corrente e link all'autore, uguale in ogni schermata.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiePagina } from "@/components/app/pie-pagina";

describe("PiePagina", () => {
  it("mostra copyright con anno corrente e autore", () => {
    const { container } = render(<PiePagina />);
    expect(container.textContent).toBe(`© CieloBuio ${new Date().getFullYear()}. Sviluppo: Fabio Tempera.`);
  });

  it("collega l'autore al portfolio in una nuova scheda", () => {
    render(<PiePagina />);
    const autore = screen.getByRole("link", { name: "Fabio Tempera" });
    expect(autore).toHaveAttribute("href", "https://ft2801.github.io/Portfolio");
    expect(autore).toHaveAttribute("target", "_blank");
  });

  it("accetta una classe per il contenitore", () => {
    const { container } = render(<PiePagina className="text-xs" />);
    expect(container.querySelector("p")).toHaveClass("text-xs");
  });
});
