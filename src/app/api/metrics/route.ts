/**
 * API: GET /api/metrics
 * Endpoint Prometheus per monitoring (CPU, memoria, richieste).
 * Ritorna metriche in formato text/plain compatibile con Prometheus scrape.
 *
 * Protezione: l'endpoint supporta DUE modalità di autenticazione:
 *
 *  1. **Token statico** (raccomandato per Prometheus): se la variabile
 *     d'ambiente `METRICS_TOKEN` è impostata, l'endpoint accetta
 *     richieste con header `Authorization: Bearer <token>`.
 *     Il token non viene accettato come query param `?token=`: i parametri
 *     URL finiscono nei log dei reverse proxy (Caddy, nginx) e nella
 *     cronologia del browser, esponendo il token a chi ha accesso ai log. Se serve una modalità
 *     machine-to-machine senza header, configurare il reverse proxy
 *     per iniettare l'header Authorization dal proprio segreto.
 *
 *  2. **Cookie di sessione admin** (per ispezione manuale da browser):
 *     se `METRICS_TOKEN` NON è impostata, l'endpoint richiede il
 *     cookie di sessione di un utente admin. Questa modalità è
 *     comoda per ispezionare le metriche dal browser dopo il login,
 *     ma NON è compatibile con Prometheus (che non può inviare cookie).
 *
 * In produzione, configurare `METRICS_TOKEN` a una stringa casuale
 * lunga (es. 32 byte hex generati con `openssl rand -hex 32`) e
 * configurare Prometheus con `bearer_token` nel job di scrape.
 *
 * Esempio configurazione Prometheus:
 *   - job_name: 'cielobuio'
 *     scrape_interval: 30s
 *     metrics_path: /api/metrics
 *     bearer_token: <METRICS_TOKEN>
 *     static_configs:
 *       - targets: ['app:3000']
 *
 * Autore: Fabio Tempera (2026)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, canManageConfiguration, timingSafeEqualStrings } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // Autenticazione: due modalità mutuamente esclusive.
  const metricsToken = process.env.METRICS_TOKEN;

  if (metricsToken) {
    // Modalità 1: token statico (per Prometheus) via Bearer header.
    // Il token non viene accettato nell'URL (?token=): i parametri URL
    // vengono loggati dai reverse proxy e restano nella cronologia del
    // browser, quindi espongono il token a chiunque legga i log.
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    // Confronto a tempo costante tramite l'helper timingSafeEqualStrings di
    // auth.ts (basato su hash, senza leak sulla lunghezza del token).
    // Credenziali assenti o errate: 401 con challenge Bearer (RFC 6750).
    if (!bearerToken || !timingSafeEqualStrings(bearerToken, metricsToken)) {
      return NextResponse.json(
        { error: "Non autenticato" },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="metrics"' } },
      );
    }
  } else {
    // Modalità 2: cookie di sessione admin (per ispezione browser).
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }
    if (!canManageConfiguration(user)) {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
    }
  }

  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  const metrics = [
    "# HELP cielobuio_process_uptime_seconds Tempo di attività del processo in secondi",
    "# TYPE cielobuio_process_uptime_seconds gauge",
    `cielobuio_process_uptime_seconds ${process.uptime()}`,
    "",
    "# HELP cielobuio_process_memory_rss_bytes Memoria RSS in byte",
    "# TYPE cielobuio_process_memory_rss_bytes gauge",
    `cielobuio_process_memory_rss_bytes ${memUsage.rss}`,
    "",
    "# HELP cielobuio_process_memory_heap_used_bytes Memoria heap usata in byte",
    "# TYPE cielobuio_process_memory_heap_used_bytes gauge",
    `cielobuio_process_memory_heap_used_bytes ${memUsage.heapUsed}`,
    "",
    "# HELP cielobuio_process_memory_heap_total_bytes Memoria heap totale in byte",
    "# TYPE cielobuio_process_memory_heap_total_bytes gauge",
    `cielobuio_process_memory_heap_total_bytes ${memUsage.heapTotal}`,
    "",
    "# HELP cielobuio_process_memory_external_bytes Memoria esterna in byte",
    "# TYPE cielobuio_process_memory_external_bytes gauge",
    `cielobuio_process_memory_external_bytes ${memUsage.external}`,
    "",
    "# HELP cielobuio_process_cpu_user_microseconds CPU user time in microsecondi",
    "# TYPE cielobuio_process_cpu_user_microseconds counter",
    `cielobuio_process_cpu_user_microseconds ${cpuUsage.user}`,
    "",
    "# HELP cielobuio_process_cpu_system_microseconds CPU system time in microsecondi",
    "# TYPE cielobuio_process_cpu_system_microseconds counter",
    `cielobuio_process_cpu_system_microseconds ${cpuUsage.system}`,
    "",
    "# HELP cielobuio_node_version Node.js major version",
    "# TYPE cielobuio_node_version gauge",
    `cielobuio_node_version ${process.versions.node.split(".")[0]}`,
    "",
  ].join("\n");

  return new NextResponse(metrics, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
