import { AutoreLink } from "./autore-link";

/**
 * Riga di credito in fondo a ogni schermata: copyright con anno corrente e autore.
 * Stessa formulazione nella schermata di accesso, nella guida e nella barra di pagina.
 */
export function PiePagina({ className = "" }: { className?: string }) {
  return (
    <p className={className}>
      © CieloBuio {new Date().getFullYear()}. Sviluppo: <AutoreLink />.
    </p>
  );
}
