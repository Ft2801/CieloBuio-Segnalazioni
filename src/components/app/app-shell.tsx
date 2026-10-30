"use client";

/**
 * App shell principale: gestisce la navigazione tra le viste, la barra laterale
 * e il logout. Ogni vista ha un indirizzo proprio (query string `?v=...`), quindi
 * il pulsante Indietro del browser e i segnalibri funzionano come ci si aspetta.
 * Autore: Fabio Tempera (2026)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { LogOut, LayoutDashboard, ListFilter, Settings, Bell, Menu, BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./use-session";
import { LoginScreen } from "./login-screen";
import { Dashboard } from "./dashboard";
import { ListaSegnalazioni } from "./lista-segnalazioni";
import { FormSegnalazione } from "./form-segnalazione";
import { DettaglioSegnalazione } from "./dettaglio-segnalazione";
import { PannelloAdmin } from "./pannello-admin";
import { VistaReminder } from "./vista-reminder";
import { GuidaView } from "./guida-view";
import { ThemeToggle } from "./theme-toggle";
import { LinkVista } from "./link-vista";
import { PiePagina } from "./pie-pagina";
import { labelRuolo } from "@/lib/types";
import { hrefDaVista, vistaConsentita, vistaDaQuery, type Vista } from "@/lib/rotta";

const VISTA_INIZIALE: Vista = { name: "dashboard" };

/** Vista della barra laterale che resta evidenziata anche nelle sottoviste. */
function vocePrincipale(vista: Vista): Vista["name"] {
  if (vista.name === "dettaglio" || vista.name === "modifica-segnalazione") return "lista";
  if (vista.name === "nuova-segnalazione") return "nuova-segnalazione";
  return vista.name;
}

export function AppShell() {
  const { user, loading, login, logout } = useSession();
  const [vista, setVista] = useState<Vista>(() =>
    typeof window === "undefined" ? VISTA_INIZIALE : vistaDaQuery(window.location.search),
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // Il focus si sposta sul contenuto solo dopo una navigazione dell'utente, non al caricamento.
  const spostaFocus = useRef(false);

  const naviga = useCallback((prossima: Vista, opzioni: { replace?: boolean } = {}) => {
    const href = hrefDaVista(prossima);
    if (new URL(href, window.location.href).href !== window.location.href) {
      if (opzioni.replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
    spostaFocus.current = true;
    setVista(prossima);
  }, []);

  // Pulsante Indietro e Avanti del browser: la vista segue l'indirizzo.
  useEffect(() => {
    function alPopstate() {
      spostaFocus.current = false;
      setVista(vistaDaQuery(window.location.search));
    }
    window.addEventListener("popstate", alPopstate);
    return () => window.removeEventListener("popstate", alPopstate);
  }, []);

  // Dopo una navigazione, il focus va all'inizio del contenuto (WCAG 2.4.3) e la pagina torna in cima.
  useEffect(() => {
    if (!spostaFocus.current) return;
    spostaFocus.current = false;
    window.scrollTo({ top: 0 });
    mainRef.current?.focus();
  }, [vista]);

  // Chiudi il menu mobile su cambio vista.
  useEffect(() => {
    setSidebarOpen(false);
  }, [vista]);

  // Il menu mobile, quando si apre, porta il focus sulla prima voce di
  // navigazione. Il focus torna al pulsante del menu quando il menu si chiude
  // con Esc o con il tocco fuori (WCAG 2.4.3 ordine del focus).
  useEffect(() => {
    if (sidebarOpen) {
      asideRef.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
    }
  }, [sidebarOpen]);

  // Esc chiude il menu mobile (WCAG 2.1.2: nessuna trappola da tastiera, uscita sempre disponibile).
  useEffect(() => {
    if (!sidebarOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">Caricamento in corso…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  async function esci() {
    await logout();
    naviga(VISTA_INIZIALE, { replace: true });
  }

  // Le viste non consentite al ruolo ricadono sulla dashboard.
  const vistaVisibile = vistaConsentita(vista, user.ruolo) ? vista : VISTA_INIZIALE;
  const principale = vocePrincipale(vistaVisibile);

  // Le voci sono raggruppate per fase del lavoro: Lavoro, Follow-up e Sistema.
  const vociPrincipali: {
    label: string;
    icon: typeof LayoutDashboard;
    vista: Vista;
    gruppo: "lavoro" | "follow-up" | "sistema";
    visibile: boolean;
  }[] = [
    { label: "Dashboard", icon: LayoutDashboard, vista: { name: "dashboard" }, gruppo: "lavoro", visibile: true },
    {
      label: "Segnalazioni",
      icon: ListFilter,
      vista: { name: "lista", stato: "all" },
      gruppo: "lavoro",
      visibile: true,
    },
    {
      label: "Nuova segnalazione",
      icon: Plus,
      vista: { name: "nuova-segnalazione" },
      gruppo: "lavoro",
      visibile: true,
    },
    {
      label: "Promemoria",
      icon: Bell,
      vista: { name: "reminder" },
      gruppo: "follow-up",
      visibile: user.ruolo !== "volontario",
    },
    {
      label: "Amministrazione",
      icon: Settings,
      vista: { name: "admin" },
      gruppo: "sistema",
      visibile: user.ruolo === "admin",
    },
  ];
  const voceGuida = { label: "Guida", icon: BookOpen, vista: { name: "guida" } as Vista };
  const gruppiNav = [
    {
      id: "lavoro",
      titolo: "Lavoro",
      voci: vociPrincipali.filter((v) => v.visibile && v.gruppo === "lavoro"),
    },
    {
      id: "follow-up",
      titolo: "Follow-up",
      voci: vociPrincipali.filter((v) => v.visibile && v.gruppo === "follow-up"),
    },
    {
      id: "sistema",
      titolo: "Sistema",
      voci: [...vociPrincipali.filter((v) => v.visibile && v.gruppo === "sistema"), voceGuida],
    },
  ].filter((g) => g.voci.length > 0);

  function voceNav(voce: { label: string; icon: typeof LayoutDashboard; vista: Vista }) {
    const attiva = principale === voce.vista.name;
    return (
      <LinkVista
        key={voce.label}
        vista={voce.vista}
        onNavigate={(v) => naviga(v)}
        aria-current={attiva ? "page" : undefined}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          attiva ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"
        }`}
      >
        <voce.icon className="w-4 h-4" aria-hidden="true" />
        {voce.label}
      </LinkVista>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <a href="#contenuto" className="skip-link">
        Vai al contenuto
      </a>

      {/* Barra mobile: menu e tema. L'uscita sta nel menu. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-3 border-b bg-sidebar">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="inline-flex items-center justify-center size-10 -ml-2 rounded-md hover:bg-accent transition-colors"
          aria-label="Apri menu"
          aria-expanded={sidebarOpen}
          aria-controls="menu-principale"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./logo.png" alt="" className="w-6 h-6 rounded" aria-hidden="true" />
          <span>CieloBuio</span>
        </div>
        <div className="-mr-2">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 min-w-0">
        {/* Barra laterale: su mobile è un menu a scomparsa, fuori schermo quando chiuso. */}
        <aside
          ref={asideRef}
          id="menu-principale"
          aria-label="Menu principale"
          className={`fixed md:sticky top-0 left-0 z-40 h-screen w-64 bg-sidebar border-r flex flex-col shrink-0 duration-200 md:translate-x-0 md:visible ${
            sidebarOpen
              ? "translate-x-0 visible transition-[translate]"
              : "-translate-x-full invisible transition-[translate,visibility]"
          }`}
        >
          <div className="p-4 border-b border-sidebar-border flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="./logo.png" alt="Logo CieloBuio Odv" className="w-9 h-9 rounded-md shrink-0" />
            <div>
              <div className="font-bold leading-tight">CieloBuio</div>
              <div className="text-sm text-muted-foreground mt-0.5">Segnalazioni</div>
            </div>
          </div>

          <nav className="flex-1 p-2 overflow-y-auto" aria-label="Navigazione principale">
            {gruppiNav.map((gruppo) => (
              <div key={gruppo.id} role="group" aria-labelledby={`gruppo-${gruppo.id}`} className="mt-3 first:mt-0">
                <p
                  id={`gruppo-${gruppo.id}`}
                  className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {gruppo.titolo}
                </p>
                <div className="space-y-1">{gruppo.voci.map(voceNav)}</div>
              </div>
            ))}
          </nav>

          <div className="p-3 border-t border-sidebar-border space-y-3">
            <div className="hidden md:block">
              <ThemeToggle variant="estesa" />
            </div>
            <div className="text-sm">
              <div className="font-medium text-foreground">{user.nomeCognome}</div>
              <div className="text-muted-foreground truncate">{user.email}</div>
              <div className="text-muted-foreground mt-1">{labelRuolo(user.ruolo)}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={esci}>
              <LogOut className="w-4 h-4" aria-hidden="true" /> Esci
            </Button>
          </div>
        </aside>

        {/* Overlay per chiudere il menu su mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => {
              setSidebarOpen(false);
              menuButtonRef.current?.focus();
            }}
            aria-hidden="true"
          />
        )}

        <div className="flex flex-1 flex-col min-w-0">
          <main
            ref={mainRef}
            id="contenuto"
            tabIndex={-1}
            className="flex-1 min-w-0 p-4 md:p-6 max-w-6xl mx-auto w-full focus:outline-none"
          >
            {/* La chiave cambia con l'indirizzo: ogni navigazione monta la vista da zero. */}
            <div key={hrefDaVista(vistaVisibile)}>
              {vistaVisibile.name === "dashboard" && <Dashboard user={user} onNavigate={naviga} />}
              {vistaVisibile.name === "lista" && (
                <ListaSegnalazioni
                  user={user}
                  filtroStatoIniziale={vistaVisibile.stato}
                  onApriDettaglio={(id) => naviga({ name: "dettaglio", id })}
                  onNuovaSegnalazione={() => naviga({ name: "nuova-segnalazione" })}
                />
              )}
              {vistaVisibile.name === "nuova-segnalazione" && (
                <FormSegnalazione
                  user={user}
                  segnalazionePrecedenteId={vistaVisibile.segnalazionePrecedenteId}
                  onBack={() => naviga({ name: "lista", stato: "all" })}
                  onSaved={() => naviga({ name: "lista", stato: "all" })}
                />
              )}
              {vistaVisibile.name === "modifica-segnalazione" && (
                <FormSegnalazione
                  user={user}
                  segnalazioneId={vistaVisibile.id}
                  onBack={() => naviga({ name: "dettaglio", id: vistaVisibile.id })}
                  onSaved={(id) => naviga({ name: "dettaglio", id })}
                />
              )}
              {vistaVisibile.name === "dettaglio" && (
                <DettaglioSegnalazione
                  id={vistaVisibile.id}
                  user={user}
                  onBack={() => naviga({ name: "lista", stato: "all" })}
                  onApriModifica={(id) => naviga({ name: "modifica-segnalazione", id })}
                  onNuovaRecidiva={(idPrecedente: string) =>
                    naviga({ name: "nuova-segnalazione", segnalazionePrecedenteId: idPrecedente })
                  }
                  onAggiornata={() => {
                    /* Il dettaglio si ricarica internamente, nessuna azione richiesta qui */
                  }}
                />
              )}
              {vistaVisibile.name === "admin" && <PannelloAdmin user={user} />}
              {vistaVisibile.name === "reminder" && (
                <VistaReminder
                  user={user}
                  onBack={() => naviga({ name: "dashboard" })}
                  onApriDettaglio={(id) => naviga({ name: "dettaglio", id })}
                />
              )}
              {vistaVisibile.name === "guida" && <GuidaView />}
            </div>
          </main>
          <footer className="mt-auto py-3 px-4 text-center text-sm text-muted-foreground border-t border-border">
            <PiePagina />
          </footer>
        </div>
      </div>
    </div>
  );
}
