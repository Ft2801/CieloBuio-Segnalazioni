"use client";

/**
 * Schermata di login dell'applicazione.
 * Product register: form centrato, copy diretta, niente decorazioni superflue.
 *
 * Nota di sicurezza (repository pubblico): questa schermata non contiene
 * NESSUNA credenziale reale né alcun pulsante che precompili email/password.
 * Le tre credenziali dimostrative di sola visualizzazione (volontario,
 * referente, admin) sono documentate in SETUP.md e vanno scritte a mano:
 * non sono suggerite né autocompletabili da questa interfaccia. Il
 * controllo di queste credenziali avviene interamente nel browser (vedi
 * src/lib/demo-mode.ts) e non richiede il database né il backend attivi.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AutoreLink } from "./autore-link";
import { Info } from "lucide-react";

/**
 * onLogin viene passato da AppShell (che detiene l'UNICA istanza di
 * useSession()) invece che essere ottenuto qui con un secondo useSession().
 *
 * Motivo: useSession usa useState locale, non un Context condiviso. Due
 * chiamate a useSession() in due componenti diversi creano due istanze di
 * stato indipendenti. Passando onLogin come prop, AppShell rimane
 * l'unica fonte di verità dello stato di sessione e decide in modo
 * coerente se mostrare LoginScreen o la dashboard in base al proprio
 * "user". Il login demo (che aggiorna lo stato localmente senza passare
 * da una risposta di rete/redirect) viene così riflesso correttamente
 * nella UI di AppShell.
 */
export function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string, totpToken?: string) => Promise<{ ok?: boolean; user?: unknown; requiresTotp?: boolean; error?: string }>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setCaricamento(true);
    try {
      const result = await onLogin(email, password, requiresTotp ? totpToken : undefined);
      // Se il server richiede 2FA, mostra il campo TOTP senza errore
      if (result && typeof result === "object" && "requiresTotp" in result && result.requiresTotp) {
        setRequiresTotp(true);
        setErrore(null);
        setTotpToken("");
      }
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Errore sconosciuto");
    } finally {
      setCaricamento(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">CieloBuio</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Coordinamento per la protezione del cielo notturno
          </p>
          <p className="text-xs text-muted-foreground mt-4 max-w-sm mx-auto">
            Sistema di segnalazione PEC di impianti di illuminazione non conformi alle leggi regionali italiane
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Accedi</CardTitle>
            <CardDescription>
              Inserisci le tue credenziali per accedere alla piattaforma
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">
                  La password di un account reale richiede almeno 12 caratteri, con
                  almeno una maiuscola, una minuscola, un numero e un carattere speciale.
                </p>
              </div>
              {requiresTotp && (
                <div className="space-y-2">
                  <Label htmlFor="totpToken">Codice TOTP (2FA)</Label>
                  <Input
                    id="totpToken"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={totpToken}
                    onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                  />
                  <p className="text-xs text-muted-foreground">
                    Inserisci il codice a 6 cifre dalla tua app di autenticazione.
                  </p>
                </div>
              )}
              {errore && (
                <div
                  role="alert"
                  className="text-sm text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/30"
                >
                  {errore}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={caricamento}>
                {caricamento ? "Accesso in corso..." : "Accedi"}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-border">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                  Per provare l&apos;interfaccia senza un account reale, esistono tre
                  account dimostrativi di sola visualizzazione (volontario, referente,
                  admin), funzionanti anche senza connessione al server. Le credenziali
                  non sono indicate qui: si trovano nel file{" "}
                  <code className="px-1 py-0.5 rounded bg-muted font-mono">SETUP.md</code>{" "}
                  del repository e vanno inserite manualmente in questo modulo.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground mt-6">
          CieloBuio, 2026. Sviluppo: <AutoreLink />.
        </p>
      </div>
    </div>
  );
}
