"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { applicaTema, ascoltaTema, salvaTema, temaCorrenteScuro } from "@/lib/tema";

interface ThemeToggleProps {
  /** "icona": pulsante quadrato per barre superiori. "estesa": pulsante con etichetta per la barra laterale. */
  variant?: "icona" | "estesa";
  className?: string;
}

/**
 * Pulsante a due stati (aria-pressed) per il tema scuro. Il nome accessibile
 * resta "Tema scuro" in entrambi gli stati: cambia solo lo stato premuto.
 */
export function ThemeToggle({ variant = "icona", className }: ThemeToggleProps) {
  const scuro = useSyncExternalStore(ascoltaTema, temaCorrenteScuro, () => false);

  function alterna() {
    const prossimo = scuro ? "chiaro" : "scuro";
    applicaTema(prossimo);
    salvaTema(prossimo);
  }

  const Icona = scuro ? Sun : Moon;

  if (variant === "estesa") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("w-full justify-start gap-2", className)}
        aria-pressed={scuro}
        onClick={alterna}
      >
        <Icona className="w-4 h-4" aria-hidden="true" />
        Tema scuro
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={alterna}
      aria-label="Tema scuro"
      aria-pressed={scuro}
      title="Tema scuro"
      className={cn(
        "inline-flex items-center justify-center size-10 rounded-md hover:bg-accent transition-colors",
        className,
      )}
    >
      <Icona className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}
