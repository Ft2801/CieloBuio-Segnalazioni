/**
 * API: GET /api/docs
 * Documentazione OpenAPI 3.0.3 dell'API REST.
 * Ritorna uno schema OpenAPI JSON con tutti gli endpoint, i modelli dati
 * e i codici di risposta. Utilizzabile con Swagger UI o Redoc.
 *
 * Autore: Fabio Tempera (2026)
 */
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/auth";

export async function GET() {
  // Il nome del cookie di sessione è dinamico in base a NODE_ENV:
  // - produzione: __Host-cb_session (prefisso __Host- per security)
  // - sviluppo: cb_session (il prefisso __Host- richiede Secure,
  //   non compatibile con http://localhost)
  const spec = buildOpenApiSpec(getSessionCookieName());
  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function buildOpenApiSpec(sessionCookieName: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "CieloBuio Segnalazioni API",
      description:
        "Sistema di segnalazione PEC di impianti di illuminazione non conformi alle leggi regionali italiane. Il nome del cookie di sessione è '__Host-cb_session' in produzione (NODE_ENV=production) e 'cb_session' in sviluppo.",
      version: "1.0.0",
      contact: {
        name: "Fabio Tempera",
        email: "fabiot2801@gmail.com",
        url: "https://ft2801.github.io/Portfolio",
      },
      license: {
        name: "AGPL-3.0-or-later",
        url: "https://www.gnu.org/licenses/agpl-3.0.html",
      },
    },
    servers: [
      { url: "/api", description: "Server corrente" },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: sessionCookieName,
          description:
            "Cookie di sessione HTTP-only. In produzione usa il prefisso __Host- " +
            "(richiede Secure, Path=/, senza Domain). In sviluppo il prefisso è " +
            "omesso perché non compatibile con http://localhost.",
        },
      },
    schemas: {
      Segnalazione: {
        type: "object",
        properties: {
          id: { type: "string" },
          numeroProtocollo: { type: "string", nullable: true },
          stato: {
            type: "string",
            enum: ["bozza", "in_revisione", "approvata", "inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"],
          },
          indirizzoVia: { type: "string" },
          cap: { type: "string" },
          dataSegnalazione: { type: "string", format: "date-time" },
          dataInvio: { type: "string", format: "date-time", nullable: true },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          nomeCognome: { type: "string" },
          ruolo: {
            type: "string",
            enum: ["volontario", "referente_provinciale", "referente_regionale", "admin"],
          },
          attivo: { type: "boolean" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/auth/login": {
      post: {
        summary: "Login con email e password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Login riuscito" },
          "401": { description: "Credenziali non valide" },
          "429": { description: "Rate limit superato" },
        },
      },
    },
    "/auth/me": {
      get: {
        summary: "Dati utente corrente",
        responses: {
          "200": { description: "Dati utente" },
        },
      },
    },
    "/segnalazioni": {
      get: {
        summary: "Lista segnalazioni visibili",
        responses: { "200": { description: "Lista segnalazioni" } },
      },
      post: {
        summary: "Crea nuova segnalazione",
        responses: {
          "201": { description: "Segnalazione creata" },
          "400": { description: "Validazione fallita" },
        },
      },
    },
    "/segnalazioni/{id}": {
      get: { summary: "Dettaglio segnalazione", responses: { "200": {}, "404": {} } },
      put: { summary: "Modifica segnalazione", responses: { "200": {}, "400": {}, "403": {} } },
      delete: { summary: "Elimina bozza", responses: { "200": {}, "403": {} } },
    },
    "/segnalazioni/{id}/approva": {
      post: { summary: "Approva segnalazione", responses: { "200": {}, "403": {}, "409": {} } },
    },
    "/segnalazioni/{id}/rifiuta": {
      post: { summary: "Rifiuta segnalazione", responses: { "200": {}, "403": {}, "409": {} } },
    },
    "/segnalazioni/{id}/cambia-stato": {
      post: { summary: "Cambia stato segnalazione (admin)", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/segnalazioni/{id}/invia-pec": {
      post: { summary: "Invia PEC reale", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/segnalazioni/{id}/simula-pec": {
      post: { summary: "Simula invio PEC", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/segnalazioni/{id}/lettera": {
      get: { summary: "Anteprima lettera PEC (HTML)", responses: { "200": {}, "403": {} } },
    },
    "/segnalazioni/export": {
      get: { summary: "Export CSV segnalazioni", responses: { "200": {}, "429": {} } },
    },
    "/upload": {
      post: { summary: "Upload allegato", responses: { "201": {}, "400": {}, "429": {} } },
    },
    "/allegati": {
      delete: { summary: "Elimina allegato", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/allegati/{id}/download": {
      get: { summary: "Download allegato", responses: { "200": {}, "403": {}, "404": {} } },
    },
    "/allegati/{id}/preview": {
      get: { summary: "Anteprima allegato inline", responses: { "200": {}, "403": {}, "404": {} } },
    },
    "/config/regioni": {
      get: { summary: "Lista regioni", responses: { "200": {} } },
      post: { summary: "Crea regione (admin)", responses: { "201": {}, "403": {} } },
    },
    "/config/regioni/{id}": {
      put: { summary: "Modifica regione (admin)", responses: { "200": {}, "403": {} } },
      delete: { summary: "Elimina regione (admin)", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/config/province": {
      get: { summary: "Lista province", responses: { "200": {} } },
      post: { summary: "Crea provincia (admin)", responses: { "201": {}, "403": {} } },
    },
    "/config/province/{id}": {
      put: { summary: "Modifica provincia (admin)", responses: { "200": {}, "403": {} } },
      delete: { summary: "Elimina provincia (admin)", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/config/comuni": {
      get: { summary: "Lista comuni", responses: { "200": {} } },
      post: { summary: "Crea comune (admin)", responses: { "201": {}, "403": {} } },
    },
    "/config/comuni/{id}": {
      put: { summary: "Modifica comune (admin)", responses: { "200": {}, "403": {} } },
      delete: { summary: "Elimina comune (admin)", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/config/users": {
      get: { summary: "Lista utenti (admin)", responses: { "200": {}, "403": {} } },
      post: { summary: "Crea utente (admin)", responses: { "201": {}, "403": {} } },
    },
    "/config/users/{id}": {
      patch: { summary: "Modifica utente (admin)", responses: { "200": {}, "400": {}, "403": {} } },
      delete: { summary: "Elimina utente (admin)", responses: { "200": {}, "400": {}, "403": {} } },
    },
    "/stats": {
      get: { summary: "Statistiche dashboard", responses: { "200": {} } },
    },
    "/reminder": {
      get: { summary: "Pratiche in attesa oltre soglia", responses: { "200": {} } },
      post: { summary: "Azioni manutenzione (admin)", responses: { "200": {}, "403": {} } },
    },
    "/health": {
      get: { summary: "Health check", responses: { "200": {}, "503": {} } },
    },
    "/docs": {
      get: { summary: "Documentazione OpenAPI", responses: { "200": {} } },
    },
    "/metrics": {
      get: { summary: "Metriche Prometheus", responses: { "200": {} } },
    },
  },
  };
}
