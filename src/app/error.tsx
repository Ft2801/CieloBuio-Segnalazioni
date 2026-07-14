"use client";

/**
 * Error boundary globale: cattura errori runtime non gestiti nei
 * server components e nei client components, evitando la pagina bianca
 * di default di Next.js. L'utente può riprovare a caricare la pagina
 * senza dover fare refresh manuale del browser.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log lato client per diagnostica: in produzione va in console,
    // in sviluppo può essere intercettato dal provider di telemetria.
    console.error("[ErrorBoundary] Errore runtime non gestito:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full border-rose-500/40 bg-rose-500/5">
        <CardContent className="pt-6 space-y-4">
          <div className="flex justify-center">
            <AlertTriangle className="w-12 h-12 text-rose-500" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-rose-700 dark:text-rose-300">
              Si è verificato un errore
            </h1>
            <p className="text-sm text-muted-foreground">
              La pagina non può essere caricata a causa di un errore imprevisto.
              Riprova: se il problema persiste, contatta l&apos;amministrazione.
            </p>
          </div>
          <div className="flex justify-center">
            <Button onClick={reset} variant="default">
              <RotateCcw className="w-4 h-4 mr-2" />
              Riprova
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
