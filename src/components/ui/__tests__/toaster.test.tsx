/**
 * Test per src/components/ui/toaster.tsx
 * Copre: rendering con lista toast vuota, integrazione con useToast.
 *
 * Nota: i toast di Radix UI hanno animazioni e viewport che non funzionano
 * bene in jsdom, quindi ci limitiamo a testare il rendering del provider
 * e l'integrazione con useToast senza verificare il DOM del toast animato.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock useToast per controllare i toast renderizzati
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toasts: [], toast: vi.fn(), dismiss: vi.fn() })),
  toast: vi.fn(),
  __resetToastStateForTests: vi.fn(),
}));

import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";

describe("Toaster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderizza senza toast (lista vuota)", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    const { container } = render(<Toaster />);
    expect(container).toBeInTheDocument();
  });

  it("chiama useToast per ottenere la lista toast", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    render(<Toaster />);
    expect(useToast).toHaveBeenCalled();
  });

  it("renderizza con toast nella lista (non crasha)", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [{ id: "1", title: "Test", description: "Desc", open: true }],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    render(<Toaster />);
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("Desc")).toBeInTheDocument();
  });

  it("renderizza con toast che ha solo title (description undefined)", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [{ id: "1", title: "Solo titolo", open: true }],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    render(<Toaster />);
    expect(screen.getByText("Solo titolo")).toBeInTheDocument();
  });

  it("renderizza con toast che ha solo description (title undefined)", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [{ id: "1", description: "Solo desc", open: true }],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    render(<Toaster />);
    expect(screen.getByText("Solo desc")).toBeInTheDocument();
  });

  it("renderizza con toast che ha action", () => {
    vi.mocked(useToast).mockReturnValue({
      toasts: [
        {
          id: "1",
          title: "Con action",
          action: <button data-testid="action">Click</button>,
          open: true,
        },
      ],
      toast: vi.fn(),
      dismiss: vi.fn(),
    } as never);
    render(<Toaster />);
    expect(screen.getByText("Con action")).toBeInTheDocument();
    expect(screen.getByTestId("action")).toBeInTheDocument();
  });
});
