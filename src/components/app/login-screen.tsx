"use client";

/**
 * Schermata di accesso alla piattaforma.
 *
 * Nota di sicurezza: la schermata non contiene credenziali, né pulsanti che
 * precompilano email o password. Il controllo delle credenziali avviene nel
 * browser (vedi src/lib/demo-mode.ts) prima di qualsiasi richiesta di rete.
 *
 * onLogin viene passato da AppShell, che detiene l'unica istanza di
 * useSession(): così lo stato di sessione resta in un'unica fonte di verità.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PiePagina } from "./pie-pagina";
import { ThemeToggle } from "./theme-toggle";

export function LoginScreen({
  onLogin,
}: {
  onLogin: (
    email: string,
    password: string,
    totpToken?: string,
  ) => Promise<{ ok?: boolean; user?: unknown; requiresTotp?: boolean; error?: string }>;
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
      // Se il server richiede il secondo fattore, mostra il campo TOTP senza errore.
      if (result && typeof result === "object" && "requiresTotp" in result && result.requiresTotp) {
        setRequiresTotp(true);
        setErrore(null);
        setTotpToken("");
      }
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Si è verificato un errore imprevisto. Riprova.");
    } finally {
      setCaricamento(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="./logo.png" alt="Logo CieloBuio Odv" className="w-16 h-16 rounded-lg shadow-sm" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">CieloBuio</h1>
            <p className="text-sm text-muted-foreground mt-2">Coordinamento per la protezione del cielo notturno</p>
            <p className="text-sm text-muted-foreground mt-4 max-w-sm mx-auto">
              Ti permette di segnalare alla PEC del Comune gli impianti di illuminazione non conformi alle leggi
              regionali sull&apos;inquinamento luminoso.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <h2 className="text-lg font-semibold leading-none">Accedi</h2>
              </CardTitle>
              <CardDescription>
                Inserisci le tue credenziali per continuare. Gli account sono creati dal coordinamento: per ottenerne
                uno rivolgiti al referente del tuo territorio.
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
                    aria-invalid={errore ? true : undefined}
                    aria-describedby={errore ? "errore-login" : undefined}
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
                    aria-invalid={errore ? true : undefined}
                    aria-describedby={errore ? "errore-login" : undefined}
                  />
                </div>
                {requiresTotp && (
                  <div className="space-y-2">
                    <Label htmlFor="totpToken">Codice di verifica (2FA)</Label>
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
                      Inserisci il codice a 6 cifre generato dalla tua app di autenticazione.
                    </p>
                  </div>
                )}
                {errore && (
                  <div
                    id="errore-login"
                    role="alert"
                    className="text-sm text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/30"
                  >
                    {errore}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={caricamento}>
                  {caricamento ? "Accesso in corso…" : "Accedi"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex justify-center mt-6">
            <ThemeToggle variant="estesa" />
          </div>
        </div>
      </main>
      <footer className="py-3 px-4 text-center text-sm text-muted-foreground border-t border-border">
        <PiePagina />
      </footer>
    </div>
  );
}
