/**
 * Test per layout.tsx, page.tsx, toaster.tsx.
 * Copre: rendering root layout, metadata, viewport, pagina home, toaster.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock del service worker registration (non disponibile in jsdom)
vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="toaster-mock" />,
}));

// Mock di use-session per evitare che AppShell faccia fetch reali
vi.mock("@/components/app/use-session", () => ({
  useSession: () => ({ user: null, loading: false, error: null, login: vi.fn(), logout: vi.fn() }),
}));

import RootLayout, { metadata, viewport } from "@/app/layout";
import Home from "@/app/page";

describe("RootLayout", () => {
  it("renderizza children con lang=it", () => {
    render(
      <RootLayout>
        <div data-testid="child">Content</div>
      </RootLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("it");
  });

  it("include il Toaster", () => {
    render(
      <RootLayout>
        <div>Test</div>
      </RootLayout>
    );
    expect(screen.getByTestId("toaster-mock")).toBeInTheDocument();
  });

  it("include lo script di service worker registration", () => {
    const { container } = render(
      <RootLayout>
        <div>Test</div>
      </RootLayout>
    );
    const script = container.querySelector("script[src='/sw-register.js']");
    expect(script).toBeInTheDocument();
    expect(script?.getAttribute("defer")).toBe("");
  });

  it("ha body con classi antialiased e bg-background", () => {
    render(
      <RootLayout>
        <div>Test</div>
      </RootLayout>
    );
    const body = document.body;
    expect(body.className).toContain("antialiased");
    expect(body.className).toContain("bg-background");
  });
});

describe("metadata export", () => {
  it("ha il titolo corretto", () => {
    expect(metadata.title).toBe("CieloBuio, segnalazioni impianti non conformi");
  });

  it("ha la descrizione", () => {
    expect(metadata.description).toContain("Sistema di segnalazione PEC");
    expect(metadata.description).toContain("inquinamento luminoso");
  });

  it("ha il manifest PWA", () => {
    expect(metadata.manifest).toBe("/manifest.json");
  });

  it("ha le keywords", () => {
    expect(metadata.keywords).toContain("CieloBuio");
    expect(metadata.keywords).toContain("PEC");
    expect(metadata.keywords).toContain("inquinamento luminoso");
  });

  it("ha l'autore", () => {
    const authors = metadata.authors as unknown as Array<{ name: string; url: string }>;
    expect(authors?.[0]?.name).toBe("Fabio Tempera");
    expect(authors?.[0]?.url).toBe("https://ft2801.github.io/Portfolio");
  });

  it("ha le icone PWA", () => {
    // icons.icon può essere string | array; castiamo per testare
    const icons = metadata.icons as unknown as {
      icon?: Array<{ url: string; sizes: string; type: string }>;
    };
    expect(icons.icon?.[0]?.url).toBe("/icon-192.png");
    expect(icons.icon?.[1]?.url).toBe("/icon-512.png");
  });

  it("ha appleWebApp configurato", () => {
    // appleWebApp può essere boolean | object; verifichiamo che non sia false
    expect(metadata.appleWebApp).not.toBe(false);
    expect(metadata.appleWebApp).not.toBe(true);
    const awa = metadata.appleWebApp as { capable?: boolean; title?: string };
    expect(awa.capable).toBe(true);
    expect(awa.title).toBe("CieloBuio");
  });
});

describe("viewport export", () => {
  it("ha themeColor", () => {
    expect(viewport.themeColor).toBe("#f4f4f5");
  });

  it("ha width device-width", () => {
    expect(viewport.width).toBe("device-width");
  });

  it("ha initialScale 1", () => {
    expect(viewport.initialScale).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Home (page.tsx)
// -----------------------------------------------------------------------------

describe("Home (page.tsx)", () => {
  it("renderizza AppShell (mostra LoginScreen quando non autenticato)", () => {
    render(<Home />);
    // AppShell con user=null mostra il LoginScreen
    expect(screen.getByText("CieloBuio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accedi/i })).toBeInTheDocument();
  });
});
