// @vitest-environment jsdom
/**
 * Copertura dei rami residui di path-guard, della pagina di errore globale,
 * del componente ToastAction e del listener di use-toast.
 */
import path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";
import { risolviPathAllegatoSicuro } from "@/lib/path-guard";
import ErrorBoundary from "@/app/error";
import { ToastProvider, Toast, ToastAction, ToastViewport } from "@/components/ui/toast";
import { useToast, toast, __resetToastStateForTests } from "@/hooks/use-toast";

const ID_VALIDO = "cabcdefghijklmnopqrstuvwx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("risolviPathAllegatoSicuro - difesa in profondità", () => {
  it("restituisce null se il path risolto esce dalla radice upload", () => {
    vi.spyOn(path, "resolve").mockReturnValueOnce("/etc/passwd");
    expect(risolviPathAllegatoSicuro(ID_VALIDO, "file.pdf")).toBeNull();
  });

  it("restituisce il path quando resta dentro la radice upload", () => {
    const risultato = risolviPathAllegatoSicuro(ID_VALIDO, "file.pdf");
    expect(risultato).toContain(ID_VALIDO);
    expect(risultato?.endsWith("file.pdf")).toBe(true);
  });
});

describe("ErrorBoundary (app/error.tsx)", () => {
  it("mostra il messaggio di errore e registra l'errore in console", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const errore = new Error("boom");
    render(<ErrorBoundary error={errore} reset={() => {}} />);
    expect(screen.getByText("Si è verificato un errore")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith("[ErrorBoundary] Errore runtime non gestito:", errore);
  });

  it("il pulsante Riprova richiama reset", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /Riprova/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("ToastAction", () => {
  it("renderizza il pulsante azione con il testo e la classe forniti", () => {
    render(
      <ToastProvider>
        <Toast open>
          <ToastAction altText="Annulla azione" className="classe-extra">
            Annulla
          </ToastAction>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    const bottone = screen.getByRole("button", { name: "Annulla" });
    expect(bottone).toHaveClass("classe-extra");
  });
});

describe("use-toast - smontaggio di un hook", () => {
  // Il listener viene rimosso nel cleanup di useEffect. React non espone i listener
  // registrati, quindi il test verifica l'effetto osservabile: dopo lo smontaggio di
  // un hook, gli hook ancora montati continuano a ricevere i toast.
  it("dopo lo smontaggio di un hook, un nuovo toast aggiorna quelli ancora montati", () => {
    __resetToastStateForTests();
    const primo = renderHook(() => useToast());
    const secondo = renderHook(() => useToast());
    act(() => {
      primo.unmount();
    });
    act(() => {
      toast({ title: "Attivo" });
    });
    expect(secondo.result.current.toasts.some((t) => t.title === "Attivo")).toBe(true);
    secondo.unmount();
    __resetToastStateForTests();
  });
});
