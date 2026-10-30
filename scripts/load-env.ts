// I comandi npm eseguono tsx senza il caricamento automatico di .env di Next.js.
// Importare questo modulo per primo: path-guard calcola STORAGE_ROOT all'import.
import { config } from "dotenv";

config({ quiet: true });
