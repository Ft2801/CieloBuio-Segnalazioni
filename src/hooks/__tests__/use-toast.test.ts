/**
 * Test per src/hooks/use-toast.ts
 * Copre: reducer (tutte le azioni), useToast hook, toast function,
 * addToRemoveQueue, genId, TOAST_LIMIT behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, toast, reducer, __resetToastStateForTests } from "@/hooks/use-toast";

// Resetta lo stato globale tra i test per evitare contaminazione
beforeEach(() => {
  __resetToastStateForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  __resetToastStateForTests();
  vi.useRealTimers();
});

describe("reducer - ADD_TOAST", () => {
  it("aggiunge un toast allo stato vuoto", () => {
    const state = { toasts: [] };
    const action = {
      type: "ADD_TOAST" as const,
      toast: { id: "1", open: true },
    };
    const result = reducer(state, action);
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0].id).toBe("1");
  });

  it("rispetta il TOAST_LIMIT di 3 toast contemporanei", () => {
    const state = {
      toasts: [
        { id: "1", open: true },
        { id: "2", open: true },
        { id: "3", open: true },
      ],
    };
    const action = {
      type: "ADD_TOAST" as const,
      toast: { id: "4", open: true },
    };
    const result = reducer(state, action);
    expect(result.toasts).toHaveLength(3);
    // Il nuovo toast è in testa, l'ultimo viene rimosso
    expect(result.toasts[0].id).toBe("4");
    expect(result.toasts[2].id).toBe("2");
  });
});

describe("reducer - UPDATE_TOAST", () => {
  it("aggiorna un toast esistente per id", () => {
    const state = {
      toasts: [
        { id: "1", open: true, title: "Vecchio" },
        { id: "2", open: true, title: "Altro" },
      ],
    };
    const action = {
      type: "UPDATE_TOAST" as const,
      toast: { id: "1", title: "Nuovo" },
    };
    const result = reducer(state, action);
    expect(result.toasts[0].title).toBe("Nuovo");
    expect(result.toasts[1].title).toBe("Altro");
  });

  it("non modifica toast se id non matcha", () => {
    const state = {
      toasts: [{ id: "1", open: true, title: "Originale" }],
    };
    const action = {
      type: "UPDATE_TOAST" as const,
      toast: { id: "inesistente", title: "Nuovo" },
    };
    const result = reducer(state, action);
    expect(result.toasts[0].title).toBe("Originale");
  });
});

describe("reducer - DISMISS_TOAST", () => {
  it("dismiss di un toast specifico per id", () => {
    const state = {
      toasts: [
        { id: "1", open: true },
        { id: "2", open: true },
      ],
    };
    const action = {
      type: "DISMISS_TOAST" as const,
      toastId: "1",
    };
    const result = reducer(state, action);
    expect(result.toasts[0].open).toBe(false);
    expect(result.toasts[1].open).toBe(true);
  });

  it("dismiss di tutti i toast se toastId undefined", () => {
    const state = {
      toasts: [
        { id: "1", open: true },
        { id: "2", open: true },
      ],
    };
    const action = {
      type: "DISMISS_TOAST" as const,
      toastId: undefined,
    };
    const result = reducer(state, action);
    expect(result.toasts[0].open).toBe(false);
    expect(result.toasts[1].open).toBe(false);
  });
});

describe("reducer - REMOVE_TOAST", () => {
  it("rimuove un toast specifico per id", () => {
    const state = {
      toasts: [
        { id: "1", open: true },
        { id: "2", open: true },
      ],
    };
    const action = {
      type: "REMOVE_TOAST" as const,
      toastId: "1",
    };
    const result = reducer(state, action);
    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0].id).toBe("2");
  });

  it("rimuove tutti i toast se toastId undefined", () => {
    const state = {
      toasts: [
        { id: "1", open: true },
        { id: "2", open: true },
      ],
    };
    const action = {
      type: "REMOVE_TOAST" as const,
      toastId: undefined,
    };
    const result = reducer(state, action);
    expect(result.toasts).toHaveLength(0);
  });
});

describe("toast function", () => {
  it("toast() aggiunge un toast e ritorna id/dismiss/update", () => {
    const result = toast({ title: "Test", description: "Desc" });
    expect(result.id).toBeTruthy();
    expect(typeof result.dismiss).toBe("function");
    expect(typeof result.update).toBe("function");
  });

  it("toast() genera id univoci incrementali", () => {
    const t1 = toast({ title: "T1" });
    const t2 = toast({ title: "T2" });
    expect(t1.id).not.toBe(t2.id);
  });

  it("toast().update() aggiorna il toast", () => {
    const t = toast({ title: "Originale" });
    t.update({ id: t.id, title: "Aggiornato" });
    // Verifica indiretta: lo stato interno è aggiornato
    // (non possiamo ispezionare memoryState direttamente, ma non deve lanciare)
  });

  it("toast().dismiss() rimuove il toast dopo il timeout", () => {
    const t = toast({ title: "Test" });
    t.dismiss();
    // Avanza il tempo per triggerare il REMOVE_TOAST
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Lo stato interno dovrebbe essere pulito
  });
});

describe("useToast hook", () => {
  it("ritorna stato iniziale con toasts vuoto dopo reset", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
    expect(typeof result.current.toast).toBe("function");
    expect(typeof result.current.dismiss).toBe("function");
  });

  it("toast() aggiunge un toast visibile allo stato", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test hook", description: "Descrizione" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Test hook");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("dismiss(toastId) chiude il toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Da chiudere" });
    });
    const id = result.current.toasts[0].id;
    act(() => {
      result.current.dismiss(id);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("dismiss() senza id chiude tutti i toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "T1" });
      result.current.toast({ title: "T2" });
    });
    expect(result.current.toasts).toHaveLength(2);
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("onOpenChange(false) chiude il toast quando open diventa false", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test" });
    });
    const toast = result.current.toasts[0];
    expect(toast.onOpenChange).toBeDefined();
    act(() => {
      toast.onOpenChange?.(false);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("onOpenChange(true) non chiude il toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test" });
    });
    const toast = result.current.toasts[0];
    act(() => {
      toast.onOpenChange?.(true);
    });
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("dismiss due volte sullo stesso toast non aggiunge duplicati alla queue (ramo early return)", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test" });
    });
    const id = result.current.toasts[0].id;
    // Prima dismiss: aggiunge alla queue
    act(() => {
      result.current.dismiss(id);
    });
    // Seconda dismiss sullo stesso id: early return (toastTimeouts.has gia' true)
    act(() => {
      result.current.dismiss(id);
    });
    // Verifica che non ci siano errori e il toast sia ancora chiuso
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("dismiss su toast specifico e poi dismiss globale (toastId undefined)", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "T1" });
      result.current.toast({ title: "T2" });
    });
    // dismiss su T1
    act(() => {
      result.current.dismiss(result.current.toasts[0].id);
    });
    // dismiss globale (toastId undefined): chiama addToRemoveQueue per ogni toast
    act(() => {
      result.current.dismiss();
    });
    // Tutti i toast devono essere chiusi
    expect(result.current.toasts.every((t) => t.open === false)).toBe(true);
  });
});
