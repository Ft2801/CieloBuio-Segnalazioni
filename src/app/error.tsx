"use client";

/**
 * Error boundary del segmento di pagina: cattura gli errori runtime non
 * gestiti che si verificano durante il rendering della pagina, evitando la
 * pagina bianca di default di Next.js. L'utente può riprovare senza fare
 * refresh manuale del browser. Gli errori del layout radice non passano da
 * qui.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log lato client per diagnostica nella console del browser.
    console.error("[ErrorBoundary] Errore runtime non gestito:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full border-rose-500/40 bg-rose-500/5 dark:bg-rose-950/30">
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <AlertTriangle className="w-12 h-12 text-rose-500 dark:text-rose-400" aria-hidden="true" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-rose-700 dark:text-rose-300">Si è verificato un errore</h1>
            <p className="text-sm text-muted-foreground">
              La pagina non può essere caricata a causa di un errore imprevisto. Riprova: se il problema persiste,
              contatta l&apos;amministrazione.
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
