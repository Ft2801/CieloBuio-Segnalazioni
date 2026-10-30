"use client";

/**
 * Hook per ottenere e gestire la sessione utente lato client.
 *
 * Gestisce due tipi di sessione:
 * - Sessione reale: cookie HTTP-only verificato dal server (/api/auth/*).
 * - Sessione demo: vedi src/lib/demo-mode.ts. Attivata solo se email e
 *   password inserite a mano corrispondono esattamente a uno dei tre
 *   account dimostrativi. Non richiede alcuna richiesta di rete, quindi
 *   funziona anche se il server/database è spento o irraggiungibile.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState, useCallback } from "react";
import type { SessionUser } from "@/lib/types";
import {
  matchDemoAccount,
  activateDemoSession,
  getActiveDemoSession,
  clearDemoSession,
  type DemoSessionUser,
  DEMO_ABILITATA,
} from "@/lib/demo-mode";

export function useSession() {
  const [user, setUser] = useState<SessionUser | DemoSessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Se è attiva una sessione demo (salvata in sessionStorage), ha
    // priorità e non richiede alcuna chiamata di rete: questo è ciò che
    // permette alla demo di funzionare anche a server spento.
    const demo = getActiveDemoSession();
    if (demo) {
      setUser(demo);
      setLoading(false);
      return;
    }
    // Nell'export statico non esistono API: una richiesta assoluta a /api
    // colpirebbe la radice del dominio Pages, non questa applicazione.
    if (DEMO_ABILITATA) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json().catch(() => ({}));
      setUser(data.user ?? null);
    } catch {
      // Server irraggiungibile: nessuna sessione reale disponibile.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string, totpToken?: string) => {
      // 1. Verifica PRIMA le credenziali demo, senza toccare la rete.
      // Questo è ciò che rende la modalità demo utilizzabile anche offline
      // o a server spento: se corrispondono, non si tenta nessun fetch.
      const demoAccount = matchDemoAccount(email, password);
      if (demoAccount) {
        const demoUser = activateDemoSession(demoAccount);
        setUser(demoUser);
        return { ok: true, user: demoUser };
      }
      // Non trasmettere credenziali reali alla radice del dominio Pages:
      // l'export statico ammette soltanto gli account dimostrativi.
      if (DEMO_ABILITATA) {
        throw new Error("Questa demo statica accetta solo gli account dimostrativi.");
      }

      // 2. Altrimenti, prova il login reale contro il server.
      // Include totpToken se fornito (per utenti con 2FA attivo).
      const body: Record<string, string> = { email, password };
      if (totpToken) body.totpToken = totpToken;
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Se il server richiede 2FA, ritorna il flag invece di lanciare
        // un errore, permettendo alla UI di mostrare il campo TOTP.
        if (data.requiresTotp) {
          return { ok: false, requiresTotp: true, error: data.error };
        }
        throw new Error(data.error ?? "Errore di accesso");
      }
      await refresh();
      return data;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    if (getActiveDemoSession()) {
      clearDemoSession();
      setUser(null);
      return;
    }
    await fetch("/api/auth/logout", { method: "POST" }).catch((e: unknown) => {
      // Se il server non risponde, la sessione locale viene comunque
      // azzerata: l'utente non resta bloccato in uno stato "loggato" fantasma.
      // Logghiamo l'errore solo in development per diagnostica, senza
      // disturbare l'utente con un toast (il logout client-side è riuscito).
      if (process.env.NODE_ENV !== "production") {
        console.warn("[use-session] Logout server-side fallito (sessione locale comunque azzerata):", e);
      }
    });
    setUser(null);
  }, []);

  return { user, loading, login, logout, refresh };
}
