// @vitest-environment node
/**
 * Renderizzazione lato server: senza `window` la shell parte dalla dashboard
 * e mostra lo stato di caricamento della sessione.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppShell } from "@/components/app/app-shell";

vi.mock("@/components/app/use-session", () => ({
  useSession: () => ({ user: null, loading: true, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}));

describe("AppShell - rendering lato server", () => {
  it("produce lo stato di caricamento senza accedere a window", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(<AppShell />);
    expect(html).toContain("Caricamento in corso");
    expect(html).toMatch(/role="status"[\s\S]*?Caricamento in corso/);
  });
});
