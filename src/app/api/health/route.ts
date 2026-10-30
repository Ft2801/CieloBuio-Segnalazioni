/**
 * API: GET /api/health
 * Health check endpoint per monitoring e orchestrazione (Docker, Kubernetes, Caddy).
 * Verifica connettività al database e ritorna stato del servizio.
 *
 * Autore: Fabio Tempera (2026)
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import pkg from "../../../../package.json";

// La versione è letta da package.json: un unico punto di verità.
const SERVICE_VERSION = pkg.version;

export async function GET() {
  const start = Date.now();
  let dbConnected = false;

  try {
    // SELECT 1 invece di count(): è più leggera e non dipende dalle tabelle
    // popolate. count() su una tabella eseguirebbe una scansione ad ogni
    // health check, mentre SELECT 1 verifica solo la connettività. Il template
    // tagged di $queryRaw è parametrizzato e non interpola input utente.
    await db.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  const latencyMs = Date.now() - start;

  if (dbConnected) {
    const health = {
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      service: "cielobuio-segnalazioni",
      version: SERVICE_VERSION,
      database: "connected" as const,
      latencyMs,
    };
    logger.info({ latencyMs, status: "ok" }, "Health check passed");
    return NextResponse.json(health, { status: 200 });
  }

  logger.error({ latencyMs }, "Health check failed: database unreachable");
  return NextResponse.json(
    {
      status: "error" as const,
      timestamp: new Date().toISOString(),
      service: "cielobuio-segnalazioni",
      version: SERVICE_VERSION,
      database: "disconnected" as const,
      latencyMs,
      error: "Database connection failed",
    },
    { status: 503 },
  );
}
