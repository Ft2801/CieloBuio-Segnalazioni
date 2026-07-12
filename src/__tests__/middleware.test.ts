/**
 * Test di integrazione per src/middleware.ts
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
  // Importa il middleware dinamicamente per prendere env aggiornato
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function makeReq(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const { method = "GET", headers = {} } = options;
  return new NextRequest(url, {
    method,
    headers,
  });
}

describe("middleware - security headers", () => {
  it("applica header di sicurezza a tutte le risposte GET in sviluppo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const res = await middleware(makeReq("http://localhost:3000/api/test"));
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("in produzione usa CSP strict senza unsafe-inline/unsafe-eval per gli script", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const res = await middleware(makeReq("https://example.com/api/test"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("in sviluppo CSP include unsafe-inline e unsafe-eval per HMR", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const res = await middleware(makeReq("http://localhost:3000/api/test"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("unsafe-inline");
    expect(csp).toContain("unsafe-eval");
    expect(csp).toContain("ws: wss:");
  });
});

describe("middleware - CSRF check su metodi state-changing", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
  });

  it("permette POST con Origin corretta", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://example.com" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("blocca POST con Origin diversa (403)", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://evil.com" },
      })
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("origine non valida");
  });

  it("blocca POST senza Origin né Referer (403)", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
      })
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Origin mancante");
  });

  it("permette POST con Referer corretto se Origin assente", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { referer: "https://example.com/page" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("blocca POST con Referer malevolo ma Origin assente (403)", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { referer: "https://evil.com/page" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("in produzione NON accetta localhost come Origin valida", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("in sviluppo accetta localhost come Origin valida", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("GET non subisce check CSRF (passa sempre)", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "GET",
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("middleware - fail-closed in produzione senza NEXT_PUBLIC_BASE_URL", () => {
  it("blocca tutte le richieste mutative con 503 in produzione senza NEXT_PUBLIC_BASE_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    vi.resetModules();
    // Silenzia il console.error del warning one-shot
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", {
        method: "POST",
        headers: { origin: "https://example.com" },
      })
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
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("https://example.com/api/test", { method: "GET" })
    );
    expect(res.status).toBe(200);
    errSpy.mockRestore();
  });
});

describe("middleware - isOriginAllowed (unit test della funzione pura)", () => {
  // La funzione isOriginAllowed è esportata per testare direttamente i
  // rami che non sono raggiungibili tramite middleware(): in particolare
  // il caso `!val` (valore nullo) è bloccato a monte dal short-circuit
  // `origin && ...` nel middleware.
  it("ritorna false per valore nullo o stringa vuota", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed(null, "https://example.com", false)).toBe(false);
    expect(isOriginAllowed("", "https://example.com", false)).toBe(false);
    expect(isOriginAllowed(null, "https://example.com", true)).toBe(false);
  });

  it("ritorna true se u.origin corrisponde ad expected", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("https://example.com", "https://example.com", true)).toBe(true);
    expect(isOriginAllowed("https://example.com/page", "https://example.com", true)).toBe(true);
  });

  it("ritorna false in produzione se host è localhost", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", true)).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:3000", "https://example.com", true)).toBe(false);
  });

  it("ritorna true in sviluppo se host è localhost:3000", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("http://localhost:3000", "https://example.com", false)).toBe(true);
  });

  it("ritorna true in sviluppo se host è 127.0.0.1:3000", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("http://127.0.0.1:3000", "https://example.com", false)).toBe(true);
  });

  it("ritorna false per URL malformato diverso da expected (in produzione)", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("not-a-url", "https://example.com", true)).toBe(false);
  });

  it("ritorna true per URL malformato uguale a expected (fallback stringa)", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    // "https://example.com" è un URL valido, quindi il try ha successo.
    // Per forzare il catch usiamo una stringa non parsabile ma uguale a expected:
    // expected stesso non è un URL parsabile → il catch scatta e val === expected.
    const expectedNonUrl = "custom-expected-value";
    expect(isOriginAllowed("custom-expected-value", expectedNonUrl, true)).toBe(true);
  });

  it("ritorna true in sviluppo per URL malformato che contiene un dev host", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    // Stringa non parsabile come URL ma contenente "localhost:3000"
    // "://localhost:3000" non ha scheme e throw, fallback a match stringa
    expect(isOriginAllowed("://localhost:3000", "https://example.com", false)).toBe(true);
    expect(isOriginAllowed("://127.0.0.1:3000", "https://example.com", false)).toBe(true);
  });

  it("ritorna false in produzione per URL malformato senza dev hosts", async () => {
    const { isOriginAllowed } = await import("@/middleware");
    expect(isOriginAllowed("totally-malformed", "https://example.com", true)).toBe(false);
  });
});

describe("middleware - 127.0.0.1 accettato in sviluppo", () => {
  it("in sviluppo accetta 127.0.0.1:3000 come Origin valida (con NEXT_PUBLIC_BASE_URL)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    const res = await middleware(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("in sviluppo blocca POST con Origin malformata (catch block, fallback stringa)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    // Origin malformata: new URL() throw, fallback a match stringa.
    // "evil-malformed" non contiene dev hosts né corrisponde a expected.
    const res = await middleware(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "evil-malformed" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("in sviluppo accetta POST con Origin malformata che contiene dev host (fallback stringa)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
    vi.resetModules();
    const { middleware } = await import("@/middleware");
    // "://localhost:3000" throw in new URL, ma catch block matcha dev host
    const res = await middleware(
      makeReq("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "://localhost:3000" },
      })
    );
    expect(res.status).toBe(200);
  });
});
