"use client";

/**
 * App shell principale: gestisce la navigazione tra le viste (single-page app),
 * la barra laterale e il logout.
 * Product register: navigazione standard, niente animazioni decorative.
 * Autore: Fabio Tempera (2026)
 */

import { useState, useEffect } from "react";
import { LogOut, LayoutDashboard, FileText, ListFilter, Settings, Bell, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./use-session";
import { LoginScreen } from "./login-screen";
import { Dashboard } from "./dashboard";
import { ListaSegnalazioni } from "./lista-segnalazioni";
import { FormSegnalazione } from "./form-segnalazione";
import { DettaglioSegnalazione } from "./dettaglio-segnalazione";
import { PannelloAdmin } from "./pannello-admin";
import { VistaReminder } from "./vista-reminder";
import { AutoreLink } from "./autore-link";
import type { StatoSegnalazione } from "@/lib/types";
import { labelRuolo } from "@/lib/types";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo-mode";

type Vista =
  | { name: "dashboard" }
  | { name: "lista"; stato?: StatoSegnalazione | "all" }
  | { name: "nuova-segnalazione"; segnalazionePrecedenteId?: string }
  | { name: "modifica-segnalazione"; id: string }
  | { name: "dettaglio"; id: string }
  | { name: "admin" }
  | { name: "reminder" };

export function AppShell() {
  const { user, loading, login, logout } = useSession();
  const [vista, setVista] = useState<Vista>({ name: "dashboard" });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Chiudi sidebar su cambio vista (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [vista]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  const isDemo = "isDemo" in user && user.isDemo === true;

  const navItems = [
    { label: "Dashboard", icon: LayoutDashboard, vista: { name: "dashboard" } as Vista, visibile: true },
    { label: "Le mie segnalazioni", icon: ListFilter, vista: { name: "lista" } as Vista, visibile: true },
    { label: "Nuova segnalazione", icon: FileText, vista: { name: "nuova-segnalazione" } as Vista, visibile: true },
    { label: "Promemoria", icon: Bell, vista: { name: "reminder" } as Vista, visibile: user.ruolo !== "volontario" },
    { label: "Amministrazione", icon: Settings, vista: { name: "admin" } as Vista, visibile: user.ruolo === "admin" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header mobile */}
      <header className="md:hidden flex items-center justify-between p-3 border-b bg-sidebar">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 rounded-md hover:bg-accent transition-colors"
          aria-label="Apri menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="font-semibold">CieloBuio</div>
        <button
          onClick={logout}
          className="p-2 -mr-2 rounded-md hover:bg-accent transition-colors"
          aria-label="Esci"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {isDemo && (
        <div
          role="status"
          className="bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 text-xs sm:text-sm px-4 py-2 text-center"
        >
          Modalità dimostrativa di sola visualizzazione ({labelRuolo(user.ruolo)}). {DEMO_READONLY_MESSAGE}
        </div>
      )}

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className={`fixed md:sticky top-0 left-0 z-40 h-screen w-64 bg-sidebar border-r flex flex-col transform transition-transform duration-200 md:transform-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          }`}
        >
          <div className="p-4 border-b border-sidebar-border">
            <div className="font-bold leading-tight">CieloBuio</div>
            <div className="text-xs text-muted-foreground mt-0.5">Segnalazioni</div>
          </div>

          <nav className="flex-1 p-2 space-y-1 overflow-y-auto" aria-label="Navigazione principale">
            {navItems
              .filter((i) => i.visibile)
              .map((item) => {
                const attivo = vista.name === item.vista.name;
                return (
                  <button
                    key={item.label}
                    onClick={() => setVista(item.vista)}
                    aria-current={attivo ? "page" : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      attivo
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent text-foreground"
                    }`}
                  >
                    <item.icon className="w-4 h-4" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
          </nav>

          <div className="p-3 border-t border-sidebar-border space-y-3">
            <div className="text-xs">
              <div className="font-medium text-foreground">{user.nomeCognome}</div>
              <div className="text-muted-foreground truncate">{user.email}</div>
              <div className="text-muted-foreground mt-1">{labelRuolo(user.ruolo)}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={logout}>
              <LogOut className="w-4 h-4 mr-1" aria-hidden="true" /> Esci
            </Button>
          </div>
        </aside>

        {/* Overlay per chiudere sidebar su mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
          {vista.name === "dashboard" && (
            <Dashboard
              user={user}
              onNavigate={(v, params) => {
                // Gestisce i parametri di navigazione: se params contiene
                // "stato", lo passa come filtroStatoIniziale alla lista.
                if (v === "lista" && params && typeof params.stato === "string") {
                  setVista({ name: "lista", stato: params.stato as StatoSegnalazione });
                } else {
                  setVista({ name: v as Vista["name"] } as Vista);
                }
              }}
            />
          )}
          {vista.name === "lista" && (
            <ListaSegnalazioni
              user={user}
              filtroStatoIniziale={vista.stato}
              onApriDettaglio={(id) => setVista({ name: "dettaglio", id })}
              onNavigate={(v) => setVista({ name: v as Vista["name"] } as Vista)}
            />
          )}
          {vista.name === "nuova-segnalazione" && (
            <FormSegnalazione
              user={user}
              segnalazionePrecedenteId={vista.segnalazionePrecedenteId}
              onBack={() => setVista({ name: "lista" })}
              onSaved={() => setVista({ name: "lista" })}
            />
          )}
          {vista.name === "modifica-segnalazione" && (
            <FormSegnalazione
              user={user}
              segnalazioneId={vista.id}
              onBack={() => setVista({ name: "dettaglio", id: vista.id })}
              onSaved={(id) => setVista({ name: "dettaglio", id })}
            />
          )}
          {vista.name === "dettaglio" && (
            <DettaglioSegnalazione
              id={vista.id}
              user={user}
              onBack={() => setVista({ name: "lista" })}
              onApriModifica={(id) => setVista({ name: "modifica-segnalazione", id })}
              onNuovaRecidiva={(idPrecedente: string) => {
                setVista({ name: "nuova-segnalazione", segnalazionePrecedenteId: idPrecedente });
              }}
              onAggiornata={() => { /* Il dettaglio si ricarica internamente, nessuna azione richiesta qui */ }}
            />
          )}
          {vista.name === "admin" && user.ruolo === "admin" && <PannelloAdmin user={user} />}
          {vista.name === "reminder" && (
            <VistaReminder
              user={user}
              onBack={() => setVista({ name: "dashboard" })}
              onApriDettaglio={(id) => setVista({ name: "dettaglio", id })}
            />
          )}
        </main>
      </div>

      <footer className="mt-auto py-4 px-4 text-center text-xs text-muted-foreground border-t border-border">
        CieloBuio, Coordinamento per la protezione del cielo notturno, 2026. Sviluppo: <AutoreLink />.
      </footer>
    </div>
  );
}
