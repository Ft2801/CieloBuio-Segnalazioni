/**
 * Link a una vista dell'app. È un vero elemento `<a href>`: il clic normale
 * naviga in-app senza ricaricare la pagina, mentre apertura in nuova scheda,
 * clic con modificatori e menu contestuale usano l'indirizzo reale.
 *
 * Autore: Fabio Tempera (2026)
 */

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { hrefDaVista, type Vista } from "@/lib/rotta";

type LinkVistaProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  vista: Vista;
  onNavigate: (vista: Vista) => void;
  children: ReactNode;
};

export function LinkVista({ vista, onNavigate, children, ...resto }: LinkVistaProps) {
  function gestisciClic(e: MouseEvent<HTMLAnchorElement>) {
    // Lascia al browser i clic con modificatori o col tasto centrale (nuova scheda).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(vista);
  }

  return (
    <a {...resto} href={hrefDaVista(vista)} onClick={gestisciClic}>
      {children}
    </a>
  );
}
