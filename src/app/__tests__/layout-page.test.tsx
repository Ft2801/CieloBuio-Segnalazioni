/**
 * Test per layout.tsx e page.tsx.
 * Copre: rendering del root layout, nonce CSP, tema iniziale, metadata, viewport e pagina home.
 * Il Toaster è sostituito da un mock: il suo comportamento è testato in components/ui.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// next/font/local è trasformato dal compilatore di Next: fuori dalla build espone solo la variabile CSS.
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-inter", className: "" }),
}));

// Mock del service worker registration (non disponibile in jsdom)
vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="toaster-mock" />,
}));

// Nonce CSP letto dagli header di richiesta (impostato dal proxy in produzione).
const mockNonce = vi.hoisted(() => ({ valore: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mockNonce.valore ? { "x-nonce": mockNonce.valore } : {}),
}));

// Mock di use-session per evitare che AppShell faccia fetch reali
vi.mock("@/components/app/use-session", () => ({
  useSession: () => ({ user: null, loading: false, error: null, login: vi.fn(), logout: vi.fn() }),
}));

import RootLayout, { metadata, viewport } from "@/app/layout";
import { SCRIPT_TEMA_INIZIALE } from "@/lib/tema";
import Home from "@/app/page";

// RootLayout rende <html> e <body>: va verificato sull'HTML prodotto dal server
// renderer, senza montarlo dentro un container DOM (che produrrebbe errori di
// annidamento e di script in React).
async function renderLayout(children: React.ReactNode): Promise<string> {
  const layout = await RootLayout({ children });
  return renderToStaticMarkup(layout);
}

describe("RootLayout - font", () => {
  it("applica la variabile del font Inter alla radice del documento", async () => {
    const html = await renderLayout(<p>x</p>);
    expect(html).toContain("--font-inter");
    expect(html).toContain('<html lang="it" class="--font-inter"');
  });
});

describe("RootLayout - nonce CSP", () => {
  it("applica il nonce della richiesta allo script del service worker", async () => {
    mockNonce.valore = "nonce-di-test";
    try {
      const html = await renderLayout(<p>x</p>);
      expect(html).toContain('nonce="nonce-di-test"');
    } finally {
      mockNonce.valore = null;
    }
  });

  it("senza nonce (sviluppo) lo script del service worker non ha l'attributo", async () => {
    mockNonce.valore = null;
    const html = await renderLayout(<p>x</p>);
    expect(html).toContain("/sw-register.js");
    expect(html).not.toContain("nonce=");
  });

  it("nella build statica (CIELOBUIO_BUILD_STATICO=1) non legge gli header e non applica il nonce", async () => {
    vi.stubEnv("CIELOBUIO_BUILD_STATICO", "1");
    mockNonce.valore = "nonce-ignorato";
    try {
      const html = await renderLayout(<p>x</p>);
      expect(html).toContain("/sw-register.js");
      expect(html).not.toContain("nonce=");
    } finally {
      mockNonce.valore = null;
      vi.unstubAllEnvs();
    }
  });
});

describe("RootLayout - tema iniziale", () => {
  it("inserisce lo script del tema inline nel head, prima del body, con il nonce della richiesta", async () => {
    mockNonce.valore = "nonce-tema";
    try {
      const html = await renderLayout(<p>x</p>);
      const headBlock = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
      expect(headBlock).toContain(SCRIPT_TEMA_INIZIALE);
      expect(headBlock).toContain('nonce="nonce-tema"');
      expect(html.indexOf("cielobuio-tema")).toBeLessThan(html.indexOf("<body"));
    } finally {
      mockNonce.valore = null;
    }
  });
});

describe("RootLayout", () => {
  it("renderizza children con lang=it", async () => {
    const html = await renderLayout(<div data-testid="child">Content</div>);
    expect(html).toContain('lang="it"');
    expect(html).toContain('data-testid="child"');
  });

  it("include il Toaster", async () => {
    const html = await renderLayout(<div>Test</div>);
    expect(html).toContain('data-testid="toaster-mock"');
  });

  it("include lo script di service worker registration", async () => {
    const html = await renderLayout(<div>Test</div>);
    const tag = html.match(/<script[^>]*sw-register\.js[^>]*>/)?.[0] ?? "";
    expect(tag).not.toBe("");
    expect(tag).toContain("defer");
  });

  it("ha body con classi antialiased e bg-background", async () => {
    const html = await renderLayout(<div>Test</div>);
    const body = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(body).toContain("antialiased");
    expect(body).toContain("bg-background");
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
    expect(metadata.manifest).toBe("./manifest.json");
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
    expect(viewport.themeColor).toBe("#2a2d5f");
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
