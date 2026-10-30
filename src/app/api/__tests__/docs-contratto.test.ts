/**
 * Coerenza tra la specifica OpenAPI (GET /api/docs) e le route reali.
 *
 * Il test confronta ogni file `route.ts` sotto src/app/api con i path e i
 * metodi dichiarati nella specifica, e verifica che le forme delle risposte
 * documentate corrispondano a quelle restituite dal codice.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/auth", () => ({
  getSessionCookieName: () => "cb_session",
}));

import { GET as docsGET } from "@/app/api/docs/route";

type Schema = Record<string, unknown>;
type SpecOperazione = {
  responses: Record<string, { content?: { "application/json": { schema: Schema } } }>;
};
type Spec = {
  openapi: string;
  paths: Record<string, Partial<Record<"get" | "post" | "put" | "patch" | "delete", SpecOperazione>>>;
  components: { schemas: Record<string, Schema> };
};

const RADICE_API = path.resolve(__dirname, "..");

// Converte un file route.ts nel path della specifica, es. allegati/[id]/download -> /allegati/{id}/download
function elencaRoute(dir: string, prefisso = ""): { path: string; metodi: string[] }[] {
  const risultato: { path: string; metodi: string[] }[] = [];
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      if (voce.name === "__tests__") continue;
      const segmento = voce.name.replace(/^\[(.+)\]$/, "{$1}");
      risultato.push(...elencaRoute(completo, `${prefisso}/${segmento}`));
    } else if (voce.name === "route.ts") {
      const sorgente = readFileSync(completo, "utf-8");
      const metodi = [...sorgente.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) =>
        (m[1] ?? "").toLowerCase(),
      );
      risultato.push({ path: prefisso || "/", metodi });
    }
  }
  return risultato;
}

async function caricaSpec(): Promise<Spec> {
  const res = await docsGET();
  return (await res.json()) as Spec;
}

function schemaRisposta(spec: Spec, pathSpec: string, metodo: "get" | "post", codice: string): Schema | undefined {
  return spec.paths[pathSpec]?.[metodo]?.responses[codice]?.content?.["application/json"]?.schema;
}

describe("contratto OpenAPI /api/docs", () => {
  it("dichiara OpenAPI 3.0.3", async () => {
    const spec = await caricaSpec();
    expect(spec.openapi).toBe("3.0.3");
  });

  it("ogni route reale ha un path nella specifica, con gli stessi metodi", async () => {
    const spec = await caricaSpec();
    const route = elencaRoute(RADICE_API);
    expect(route.length).toBeGreaterThan(0);
    const discordanze: string[] = [];
    for (const r of route) {
      const dichiarata = spec.paths[r.path];
      if (!dichiarata) {
        discordanze.push(`path mancante nello spec: ${r.path}`);
        continue;
      }
      const metodiSpec = Object.keys(dichiarata).sort();
      const metodiRoute = [...r.metodi].sort();
      if (metodiSpec.join(",") !== metodiRoute.join(",")) {
        discordanze.push(`${r.path}: spec=[${metodiSpec}] route=[${metodiRoute}]`);
      }
    }
    expect(discordanze).toEqual([]);
  });

  it("nella specifica non ci sono path senza route reale", async () => {
    const spec = await caricaSpec();
    const reali = new Set(elencaRoute(RADICE_API).map((r) => r.path));
    const orfani = Object.keys(spec.paths).filter((p) => !reali.has(p));
    expect(orfani).toEqual([]);
  });

  it("lo schema User descrive i campi restituiti dalla sessione e dal pannello admin", async () => {
    const spec = await caricaSpec();
    const proprieta = Object.keys(spec.components.schemas.User?.properties as object);
    for (const campo of [
      "id",
      "email",
      "nomeCognome",
      "ruolo",
      "provinciaId",
      "regioneId",
      "pec",
      "emailOrdinaria",
      "indirizzo",
      "firma",
      "inizialiProtocollo",
      "attivo",
      "createdAt",
      "provincia",
      "regione",
    ]) {
      expect(proprieta).toContain(campo);
    }
  });

  it("lo schema Segnalazione descrive il CAP facoltativo come nullable", async () => {
    const spec = await caricaSpec();
    const schema = spec.components.schemas.Segnalazione as {
      properties: { cap: { type: string; nullable: boolean } };
    };
    expect(schema.properties.cap).toMatchObject({ type: "string", nullable: true });
  });

  it("GET /auth/me restituisce { user } con user nullable", async () => {
    const spec = await caricaSpec();
    const schema = schemaRisposta(spec, "/auth/me", "get", "200") as {
      required: string[];
      properties: { user: { nullable: boolean } };
    };
    expect(schema.required).toEqual(["user"]);
    expect(schema.properties.user.nullable).toBe(true);
  });

  it("GET /config/users restituisce { users: [...] }", async () => {
    const spec = await caricaSpec();
    const schema = schemaRisposta(spec, "/config/users", "get", "200") as {
      required: string[];
      properties: { users: { type: string } };
    };
    expect(schema.required).toEqual(["users"]);
    expect(schema.properties.users.type).toBe("array");
  });

  it("GET /segnalazioni restituisce { segnalazioni, pagination }", async () => {
    const spec = await caricaSpec();
    const schema = schemaRisposta(spec, "/segnalazioni", "get", "200") as {
      required: string[];
      properties: { segnalazioni: { type: string }; pagination: { required: string[] } };
    };
    expect(schema.required).toEqual(["segnalazioni", "pagination"]);
    expect(schema.properties.segnalazioni.type).toBe("array");
    expect(schema.properties.pagination.required).toEqual(["total", "limit", "offset", "hasMore"]);
  });

  it("GET /segnalazioni/{id} restituisce { segnalazione }", async () => {
    const spec = await caricaSpec();
    const schema = schemaRisposta(spec, "/segnalazioni/{id}", "get", "200") as {
      required: string[];
      properties: { segnalazione: { $ref: string } };
    };
    expect(schema.required).toEqual(["segnalazione"]);
    expect(schema.properties.segnalazione.$ref).toBe("#/components/schemas/Segnalazione");
  });

  it("POST /auth/login documenta il corpo del 200 e il flag requiresTotp del 401", async () => {
    const spec = await caricaSpec();
    const ok = schemaRisposta(spec, "/auth/login", "post", "200") as {
      required: string[];
      properties: { ok: { type: string }; user: { $ref: string } };
    };
    expect(ok.required).toEqual(["ok", "user"]);
    expect(ok.properties.user.$ref).toBe("#/components/schemas/User");

    const errore = schemaRisposta(spec, "/auth/login", "post", "401") as { $ref: string };
    expect(errore.$ref).toBe("#/components/schemas/ErroreLogin");
    const schemaErrore = spec.components.schemas.ErroreLogin as {
      properties: { requiresTotp: { type: string } };
    };
    expect(schemaErrore.properties.requiresTotp.type).toBe("boolean");
  });
});
