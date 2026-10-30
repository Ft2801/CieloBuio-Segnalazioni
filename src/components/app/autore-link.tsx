/**
 * Componente riutilizzabile per il link al portfolio di Fabio Tempera.
 * Stile: accento di colore (indaco) + sottolineatura, apre in nuova scheda.
 *
 * Autore: Fabio Tempera (2026)
 */

export function AutoreLink({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://ft2801.github.io/Portfolio"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-6 items-center text-primary underline underline-offset-2 decoration-2 hover:decoration-4 transition-all font-medium ${className}`}
    >
      Fabio Tempera
    </a>
  );
}
