// @vitest-environment jsdom
/**
 * La guida spiega stati e ruoli. I crediti di sviluppo stanno nel piè di pagina.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidaView } from "@/components/app/guida-view";

describe("GuidaView", () => {
  it("mostra il titolo, il glossario degli stati e i ruoli", () => {
    render(<GuidaView />);
    expect(screen.getByRole("heading", { name: "Guida", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Glossario degli stati")).toBeInTheDocument();
    expect(screen.getByText("Ruoli")).toBeInTheDocument();
  });
});
