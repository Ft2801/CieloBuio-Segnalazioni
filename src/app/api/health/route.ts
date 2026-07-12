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

export async function GET() {
  const start = Date.now();
  let dbConnected = false;

  try {
    await db.user.count();
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
      version: "1.0.0",
      database: "connected" as const,
      latencyMs,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV ?? "development",
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
      version: "1.0.0",
      database: "disconnected" as const,
      latencyMs,
      error: "Database connection failed",
    },
    { status: 503 }
  );
}
