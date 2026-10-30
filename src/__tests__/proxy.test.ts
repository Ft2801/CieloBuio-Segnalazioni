/**
 * Test di integrazione per src/proxy.ts
 *
 * Copre:
 * - Applicazione header di sicurezza a tutte le risposte
 * - Anti-CSRF: verifica Origin/Referer su metodi state-changing
 * - Fail-closed in produzione senza NEXT_PUBLIC_BASE_URL
 * - Comportamento in sviluppo (localhost accettato)
 * - URL malformati (fallback a match stringa)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset env tra i test
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  // Importa il proxy dinamicamente per prendere env aggiornato
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function makeReq(url: string, options: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const { method = "GET", headers = {} } = options;
  return new NextRequest(url, {
    method,
    headers,
  });
}

describe("proxy - security headers", () => {
  it("applica header di sicurezza a tutte le risposte GET in sviluppo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("http://localhost:3000/api/test"));
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("in produzione usa CSP strict senza unsafe-inline/unsafe-eval per gli script", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("https://example.com/api/test"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("in sviluppo CSP include unsafe-inline e unsafe-eval per HMR", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("http://localhost:3000/api/test"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("unsafe-inline");
    expect(csp).toContain("unsafe-eval");
    expect(csp).toContain("ws: wss:");
  });
});

describe("proxy - CSRF check su metodi state-changing", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
  });

  it("permette POST con Origin corretta", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("blocca POST con Origin diversa (403)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://evil.com" },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("origine non valida");
  });

  it("blocca POST senza Origin né Referer (403)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Origin mancante");
  });

  it("permette POST con Referer corretto se Origin assente", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { referer: "https://example.com/page" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("blocca POST con Referer malevolo ma Origin assente (403)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { referer: "https://evil.com/page" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("in produzione NON accetta localhost come Origin valida", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("in sviluppo accetta localhost come Origin valida", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("GET non subisce check CSRF (passa sempre)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("proxy - fail-closed in produzione senza NEXT_PUBLIC_BASE_URL", () => {
  it("blocca tutte le richieste mutative con 503 in produzione senza NEXT_PUBLIC_BASE_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    // Silenzia il console.error del warning one-shot
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("NEXT_PUBLIC_BASE_URL");
    errSpy.mockRestore();
  });

  it("GET passa anche senza NEXT_PUBLIC_BASE_URL in produzione", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("https://example.com/api/test", { method: "GET" }));
    expect(res.status).toBe(200);
    errSpy.mockRestore();
  });
});

describe("proxy - isOriginAllowed (unit test della funzione pura)", () => {
  // La funzione isOriginAllowed è esportata per testare direttamente i
  // rami che non sono raggiungibili tramite proxy(): in particolare
  // il caso `!val` (valore nullo) è bloccato a monte dal short-circuit
  // `origin && ...` nel proxy.
  it("ritorna false per valore nullo o stringa vuota", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed(null, "https://example.com", false)).toBe(false);
    expect(isOriginAllowed("", "https://example.com", false)).toBe(false);
    expect(isOriginAllowed(null, "https://example.com", true)).toBe(false);
  });

  it("ritorna true se u.origin corrisponde ad expected", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("https://example.com", "https://example.com", true)).toBe(true);
    expect(isOriginAllowed("https://example.com/page", "https://example.com", true)).toBe(true);
  });

  it("ritorna false in produzione se host è localhost", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", true)).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:3000", "https://example.com", true)).toBe(false);
  });

  it("ritorna true in sviluppo se host è localhost:3000", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", false)).toBe(true);
  });

  it("ritorna true in sviluppo se host è 127.0.0.1:3000", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("http://127.0.0.1:3000", "https://example.com", false)).toBe(true);
  });

  it("ritorna false per URL malformato diverso da expected (in produzione)", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("not-a-url", "https://example.com", true)).toBe(false);
  });

  it("rifiuta un valore non parsabile anche se uguale a expected (nessun fallback a confronto stringa)", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    // expected deve essere un'origine reale; un valore non URL non è mai un'origine.
    expect(isOriginAllowed("custom-expected-value", "custom-expected-value", true)).toBe(false);
  });

  it("rifiuta un host senza schema anche in sviluppo (un Origin reale include sempre lo schema)", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("localhost:3000", "https://example.com", false)).toBe(false);
    expect(isOriginAllowed("127.0.0.1:3000", "https://example.com", false)).toBe(false);
  });

  it("accetta l'origine con schema di un dev host solo in sviluppo", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", false)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", true)).toBe(false);
  });

  it("ritorna false in produzione per URL malformato senza dev hosts", async () => {
    const { isOriginAllowed } = await import("@/proxy");
    expect(isOriginAllowed("totally-malformed", "https://example.com", true)).toBe(false);
  });
});

describe("proxy - 127.0.0.1 accettato in sviluppo", () => {
  it("in sviluppo accetta 127.0.0.1:3000 come Origin valida (con NEXT_PUBLIC_BASE_URL)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("in sviluppo blocca POST con Origin malformata (catch block, fallback stringa)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    // Origin malformata: new URL() throw, fallback a match stringa.
    // "evil-malformed" non contiene dev hosts né corrisponde a expected.
    const res = await proxy(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "evil-malformed" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("in sviluppo blocca POST con Origin malformata che contiene dev host come substring (fallback stringa)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    // "://localhost:3000" non corrisponde esattamente, quindi deve essere bloccata
    const res = await proxy(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "://localhost:3000" },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("proxy - NEXT_PUBLIC_BASE_URL non valida in produzione", () => {
  it("blocca le richieste mutative (fail-closed) se NEXT_PUBLIC_BASE_URL non è un URL valido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "non-un-url";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    );
    // Configurazione mancante: il proxy risponde 503 e non elabora la richiesta.
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("proxy - nonce CSP in produzione", () => {
  function estraiNonce(csp: string): string {
    const m = /'nonce-([^']+)'/.exec(csp);
    return m?.[1] ?? "";
  }

  it("la CSP di produzione contiene un nonce e strict-dynamic", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("https://example.com/"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(estraiNonce(csp)).not.toBe("");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("unsafe-inline'; script");
  });

  it("il nonce cambia a ogni richiesta", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const primo = estraiNonce(
      (await proxy(makeReq("https://example.com/"))).headers.get("Content-Security-Policy") ?? "",
    );
    const secondo = estraiNonce(
      (await proxy(makeReq("https://example.com/"))).headers.get("Content-Security-Policy") ?? "",
    );
    expect(primo).not.toBe("");
    expect(secondo).not.toBe(primo);
  });

  it("il nonce viene passato a Next.js nell'header di richiesta", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(makeReq("https://example.com/"));
    const nonce = estraiNonce(res.headers.get("Content-Security-Policy") ?? "");
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("le risposte di blocco JSON usano una CSP senza nonce", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const res = await proxy(
      makeReq("https://example.com/api/x", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(estraiNonce(csp)).toBe("");
    expect(csp).toContain("script-src 'self'");
  });
});

describe("matcher del proxy", () => {
  // Next.js applica il pattern come regex ancorata all'intero percorso.
  async function corrisponde(percorso: string): Promise<boolean> {
    const { config } = await import("@/proxy");
    const pattern = config.matcher[0];
    // Il pattern viene dalla configurazione del modulo, non da input utente.
    // eslint-disable-next-line security/detect-non-literal-regexp
    return new RegExp(`^${pattern}$`).test(percorso);
  }

  it.each(["/", "/api/health", "/dashboard", "/segnalazioni/12"])("applica il proxy a %s", async (percorso) => {
    expect(await corrisponde(percorso)).toBe(true);
  });

  it.each(["/_next/static/chunk.js", "/_next/image", "/sw.js", "/sw-register.js", "/manifest.json", "/robots.txt"])(
    "esclude l'asset statico %s",
    async (percorso) => {
      expect(await corrisponde(percorso)).toBe(false);
    },
  );

  it.each(["/.well-known/security.txt", "/.well-known/change-password"])(
    "esclude i file well-known %s",
    async (percorso) => {
      expect(await corrisponde(percorso)).toBe(false);
    },
  );

  it("non esclude percorsi che solo iniziano come un'eccezione", async () => {
    expect(await corrisponde("/robots.txt.bak")).toBe(true);
    expect(await corrisponde("/sw.json")).toBe(true);
  });
});
