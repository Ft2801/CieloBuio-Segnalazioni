/**
 * Punto d'ingresso del job di manutenzione (npm run cron:reminder).
 * La logica è in scripts/cron-jobs.ts, importabile senza effetti collaterali.
 */
import "./load-env";
import { run } from "./cron-jobs";

void run();
