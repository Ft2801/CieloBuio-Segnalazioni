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
        "Sistema di segnalazione PEC di impianti di illuminazione non conformi alle leggi regionali italiane. Il nome del cookie di sessione è '__Host-cb_session' in produzione (NODE_ENV=production) e 'cb_session' in sviluppo. Le richieste che modificano dati (POST, PUT, PATCH, DELETE) verificano gli header Origin o Referer: se mancano o non corrispondono all'origine del sito, rispondono 403 (protezione CSRF).",
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
    servers: [{ url: "/api", description: "Server corrente" }],
    security: [{ sessionCookie: [] }],
    components: {
      parameters: {
        VersionePratica: {
          name: "If-Match",
          in: "header",
          required: false,
          description:
            "Tag forte della versione visualizzata: updatedAt ISO completo racchiuso tra virgolette. Uno snapshot non corrente produce HTTP 409 senza applicare l'operazione.",
          schema: { type: "string", example: '"2026-01-01T00:00:00.123Z"' },
        },
      },
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
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Token statico METRICS_TOKEN, usato solo per l'endpoint /metrics.",
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
              enum: [
                "bozza",
                "in_revisione",
                "approvata",
                "inviata",
                "in_attesa",
                "chiusa_positiva",
                "chiusa_negativa",
              ],
            },
            indirizzoVia: { type: "string" },
            cap: { type: "string", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
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
            provinciaId: { type: "integer", nullable: true },
            regioneId: { type: "integer", nullable: true },
            pec: { type: "string", nullable: true },
            emailOrdinaria: { type: "string", nullable: true },
            indirizzo: { type: "string", nullable: true },
            firma: { type: "string", nullable: true },
            inizialiProtocollo: { type: "string", nullable: true },
            attivo: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            provincia: {
              type: "object",
              nullable: true,
              properties: { sigla: { type: "string" }, nome: { type: "string" } },
            },
            regione: {
              type: "object",
              nullable: true,
              properties: { regione: { type: "string" } },
            },
          },
        },
        ErroreLogin: {
          type: "object",
          properties: {
            error: { type: "string" },
            requiresTotp: {
              type: "boolean",
              description:
                "Presente e uguale a true quando l'account ha il 2FA attivo e il codice TOTP manca o non è valido",
            },
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
      "/allegati": {
        delete: {
          operationId: "deleteAllegati",
          summary: "Elimina allegato (query id)",
          responses: {
            "409": { description: "La pratica è cambiata. Ricaricare lo snapshot prima di procedere." },
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["updatedAt"],
                    properties: {
                      updatedAt: {
                        type: "string",
                        format: "date-time",
                        description: "Versione della pratica dopo la gestione dell'allegato",
                      },
                    },
                  },
                },
              },
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "query",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
      },
      "/allegati/{id}/download": {
        get: {
          operationId: "getAllegatiIdDownload",
          summary: "Download allegato",
          responses: {
            "200": {
              description: "File dell'allegato",
              content: {
                "application/octet-stream": {},
              },
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
      },
      "/allegati/{id}/preview": {
        get: {
          operationId: "getAllegatiIdPreview",
          summary: "Anteprima allegato inline",
          responses: {
            "200": {
              description: "Anteprima inline dell'allegato",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
      },
      "/auth/2fa": {
        post: {
          operationId: "postAuth2fa",
          summary: "Setup, verifica, rotazione o disattivazione del 2FA TOTP",
          description:
            "Durante la rotazione il vecchio fattore resta obbligatorio al login fino alla verifica del nuovo. " +
            "Il codice corrente è necessario per iniziare la rotazione o disattivare un fattore attivo.",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Configurazione 2FA cambiata durante l'operazione",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: {
                      type: "string",
                      enum: ["setup", "verify", "disable"],
                    },
                    currentToken: {
                      type: "string",
                      pattern: "^\\d{6}$",
                      description: "Richiesto per setup se il 2FA è già attivo",
                    },
                    token: {
                      type: "string",
                      pattern: "^\\d{6}$",
                      description: "Richiesto per verify, e per disable se il 2FA è attivo",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/auth/login": {
        post: {
          operationId: "postAuthLogin",
          summary: "Login con email e password (codice TOTP se richiesto)",
          responses: {
            "200": {
              description: "Login riuscito: il cookie di sessione viene impostato nella risposta",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "user"],
                    properties: {
                      ok: { type: "boolean" },
                      user: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Credenziali non valide, codice TOTP mancante o non valido",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErroreLogin",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: {
                      type: "string",
                      format: "email",
                    },
                    password: {
                      type: "string",
                    },
                    totpToken: {
                      type: "string",
                      pattern: "^\\d{6}$",
                      description: "Codice TOTP a 6 cifre, richiesto se il 2FA è attivo",
                    },
                  },
                },
              },
            },
          },
          security: [],
        },
      },
      "/auth/logout": {
        post: {
          operationId: "postAuthLogout",
          summary: "Logout: chiude la sessione corrente",
          responses: {
            "403": {
              description: "Origine non valida per una richiesta mutante",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
            },
            "200": {
              description: "Operazione riuscita",
            },
          },
          security: [],
        },
      },
      "/auth/me": {
        get: {
          operationId: "getAuthMe",
          summary: "Dati utente corrente",
          responses: {
            "200": {
              description: "Operazione riuscita",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["user"],
                    properties: {
                      user: {
                        allOf: [{ $ref: "#/components/schemas/User" }],
                        nullable: true,
                        description: "Utente della sessione, oppure null se la richiesta non è autenticata",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/config/comuni": {
        get: {
          operationId: "getConfigComuni",
          summary: "Lista comuni",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postConfigComuni",
          summary: "Crea comune (admin)",
          responses: {
            "201": {
              description: "Risorsa creata",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/comuni/{id}": {
        delete: {
          operationId: "deleteConfigComuniId",
          summary: "Elimina comune (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        put: {
          operationId: "putConfigComuniId",
          summary: "Modifica comune (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/province": {
        get: {
          operationId: "getConfigProvince",
          summary: "Lista province",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postConfigProvince",
          summary: "Crea provincia (admin)",
          responses: {
            "201": {
              description: "Risorsa creata",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/province/{id}": {
        delete: {
          operationId: "deleteConfigProvinceId",
          summary: "Elimina provincia (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        put: {
          operationId: "putConfigProvinceId",
          summary: "Modifica provincia (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/regioni": {
        get: {
          operationId: "getConfigRegioni",
          summary: "Lista regioni",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postConfigRegioni",
          summary: "Crea regione (admin)",
          responses: {
            "201": {
              description: "Risorsa creata",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/regioni/{id}": {
        delete: {
          operationId: "deleteConfigRegioniId",
          summary: "Elimina regione (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        put: {
          operationId: "putConfigRegioniId",
          summary: "Modifica regione (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/users": {
        get: {
          operationId: "getConfigUsers",
          summary: "Lista utenti (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["users"],
                    properties: {
                      users: {
                        type: "array",
                        items: { $ref: "#/components/schemas/User" },
                      },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postConfigUsers",
          summary: "Crea utente (admin)",
          responses: {
            "201": {
              description: "Risorsa creata",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/config/users/{id}": {
        delete: {
          operationId: "deleteConfigUsersId",
          summary: "Elimina utente (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        patch: {
          operationId: "patchConfigUsersId",
          summary: "Modifica utente (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/docs": {
        get: {
          operationId: "getDocs",
          summary: "Documentazione OpenAPI",
          responses: {
            "200": {
              description: "Documento OpenAPI 3.0.3",
              content: {
                "application/json": {},
              },
            },
          },
          security: [],
        },
      },
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Health check del servizio e del database",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "503": {
              description: "Servizio non disponibile",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          security: [],
        },
      },
      "/metrics": {
        get: {
          operationId: "getMetrics",
          summary: "Metriche Prometheus",
          responses: {
            "200": {
              description: "Metriche Prometheus",
              content: {
                "text/plain": {},
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          security: [
            {
              bearerAuth: [],
            },
            {
              sessionCookie: [],
            },
          ],
        },
      },
      "/reminder": {
        get: {
          operationId: "getReminder",
          summary: "Pratiche in attesa oltre soglia",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postReminder",
          summary: "Azioni di manutenzione (admin)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: {
                      type: "string",
                      enum: ["cleanup", "auto-transition", "gdpr-anonymize"],
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/segnalazioni": {
        get: {
          operationId: "getSegnalazioni",
          summary: "Lista segnalazioni visibili all'utente",
          responses: {
            "200": {
              description: "Operazione riuscita",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["segnalazioni", "pagination"],
                    properties: {
                      segnalazioni: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Segnalazione" },
                      },
                      pagination: {
                        type: "object",
                        required: ["total", "limit", "offset", "hasMore"],
                        properties: {
                          total: { type: "integer" },
                          limit: { type: "integer" },
                          offset: { type: "integer" },
                          hasMore: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "postSegnalazioni",
          summary: "Crea nuova segnalazione (bozza)",
          responses: {
            "201": {
              description: "Risorsa creata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Segnalazione",
                  },
                },
              },
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/segnalazioni/export": {
        get: {
          operationId: "getSegnalazioniExport",
          summary: "Export CSV delle segnalazioni visibili (massimo 5000 righe)",
          responses: {
            "200": {
              description: "CSV completo delle segnalazioni filtrate",
              content: {
                "text/csv": {},
              },
            },
            "422": {
              description: "Più di 5000 segnalazioni: restringere i filtri; nessun CSV parziale restituito",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "stato",
              in: "query",
              required: false,
              schema: {
                type: "string",
              },
            },
            {
              name: "search",
              in: "query",
              required: false,
              schema: {
                type: "string",
              },
            },
          ],
        },
      },
      "/segnalazioni/{id}": {
        delete: {
          operationId: "deleteSegnalazioniId",
          summary: "Elimina segnalazione (solo bozza)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        get: {
          operationId: "getSegnalazioniId",
          summary: "Dettaglio segnalazione",
          responses: {
            "200": {
              description: "Operazione riuscita",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["segnalazione"],
                    properties: {
                      segnalazione: { $ref: "#/components/schemas/Segnalazione" },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
        },
        put: {
          operationId: "putSegnalazioniId",
          summary: "Modifica segnalazione",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/segnalazioni/{id}/approva": {
        post: {
          operationId: "postSegnalazioniIdApprova",
          summary: "Approva segnalazione",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/segnalazioni/{id}/cambia-stato": {
        post: {
          operationId: "postSegnalazioniIdCambiaStato",
          summary: "Cambia stato segnalazione (admin; ?force=1 per forzare)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
            {
              name: "force",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["1"],
              },
              description: "Solo admin: forza la transizione (mai verso inviata)",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["stato"],
                  properties: {
                    stato: {
                      type: "string",
                      enum: [
                        "bozza",
                        "in_revisione",
                        "approvata",
                        "inviata",
                        "in_attesa",
                        "chiusa_positiva",
                        "chiusa_negativa",
                      ],
                    },
                    nota: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/segnalazioni/{id}/invia-pec": {
        post: {
          operationId: "postSegnalazioniIdInviaPec",
          summary: "Invia PEC reale al Comune",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "503": {
              description: "Servizio di posta non configurato: la PEC non può essere inviata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/segnalazioni/{id}/lettera": {
        get: {
          operationId: "getSegnalazioniIdLettera",
          summary: "Anteprima lettera PEC in HTML (?with_attachments=1 per includere le foto)",
          responses: {
            "200": {
              description: "HTML della lettera",
              content: {
                "text/html": {},
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
            {
              name: "with_attachments",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["1"],
              },
            },
          ],
        },
      },
      "/segnalazioni/{id}/rifiuta": {
        post: {
          operationId: "postSegnalazioniIdRifiuta",
          summary: "Rifiuta segnalazione (nota obbligatoria)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "409": {
              description: "Conflitto con lo stato corrente",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            { $ref: "#/components/parameters/VersionePratica" },
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["nota"],
                  properties: {
                    nota: {
                      type: "string",
                      minLength: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/segnalazioni/{id}/simula-pec": {
        post: {
          operationId: "postSegnalazioniIdSimulaPec",
          summary: "Simula invio PEC (anteprima al destinatario di controllo)",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Campi validati dagli schemi in src/lib/validation.ts",
                },
              },
            },
          },
        },
      },
      "/stats": {
        get: {
          operationId: "getStats",
          summary: "Statistiche dashboard",
          responses: {
            "200": {
              description: "Operazione riuscita",
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/upload": {
        post: {
          operationId: "postUpload",
          parameters: [{ $ref: "#/components/parameters/VersionePratica" }],
          summary: "Upload di un allegato (multipart)",
          responses: {
            "409": { description: "La pratica è cambiata. Ricaricare lo snapshot prima di procedere." },
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["updatedAt"],
                    properties: {
                      updatedAt: {
                        type: "string",
                        format: "date-time",
                        description: "Versione della pratica dopo la gestione dell'allegato",
                      },
                    },
                  },
                },
              },
              description: "Risorsa creata",
            },
            "400": {
              description: "Richiesta non valida",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "401": {
              description: "Non autenticato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "403": {
              description: "Non autorizzato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "404": {
              description: "Risorsa non trovata",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "413": {
              description: "Allegato troppo grande",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "429": {
              description: "Limite di richieste superato",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            "500": {
              description: "Errore interno del server",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "segnalazioneId"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "Foto (jpg, png, webp) o documento; massimo 10 MB",
                    },
                    segnalazioneId: {
                      type: "string",
                    },
                    tipo: {
                      type: "string",
                      enum: ["foto", "documento"],
                      default: "foto",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
