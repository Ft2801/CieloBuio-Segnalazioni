/**
 * Test per i rami di produzione/development in setSessionCookie / clearSessionCookie.
 * Copre i branch `process.env.NODE_ENV === "production"` true e false,
 * inclusa la logica del prefisso __Host-.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setSessionCookie, clearSessionCookie, getSessionCookieName } from "@/lib/auth";

// vi.stubEnv(..., undefined) imposterebbe la stringa "undefined": per simulare
// NODE_ENV assente si rimuove la variabile e si ripristina al termine.
// Alias mutabile: il tipo di process.env.NODE_ENV è readonly in @types/node.
const envMutabile = process.env as Record<string, string | undefined>;

function conNodeEnvAssente<T>(fn: () => T): T {
  const originale = envMutabile.NODE_ENV;
  delete envMutabile.NODE_ENV;
  try {
    return fn();
  } finally {
    if (originale === undefined) delete envMutabile.NODE_ENV;
    else envMutabile.NODE_ENV = originale;
  }
}

describe("getSessionCookieName - NODE_ENV branches", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in produzione ritorna __Host-cb_session", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getSessionCookieName()).toBe("__Host-cb_session");
  });

  it("in development ritorna cb_session", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getSessionCookieName()).toBe("cb_session");
  });

  it("senza NODE_ENV ritorna cb_session (default sicuro)", () => {
    expect(conNodeEnvAssente(() => getSessionCookieName())).toBe("cb_session");
  });
});

describe("setSessionCookie - NODE_ENV branches", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in produzione include il flag Secure e il prefisso __Host-", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = setSessionCookie("token-prod");
    // __Host- richiede Path=/ e nessun Domain; HttpOnly e SameSite proteggono il token.
    expect(cookie).toContain("Path=/; HttpOnly; SameSite=Strict");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("__Host-cb_session=token-prod");
  });

  it("in development NON include il flag Secure e usa cb_session", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = setSessionCookie("token-dev");
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("cb_session=token-dev");
  });

  it("senza NODE_ENV definito NON include il flag Secure", () => {
    const cookie = conNodeEnvAssente(() => setSessionCookie("token-noenv"));
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("cb_session=token-noenv");
  });
});

describe("clearSessionCookie - NODE_ENV branches", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in produzione include il flag Secure e il prefisso __Host-", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = clearSessionCookie();
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("__Host-cb_session=");
    expect(cookie).toContain("Max-Age=0");
  });

  it("in development NON include il flag Secure e usa cb_session", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = clearSessionCookie();
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("cb_session=");
    expect(cookie).toContain("Max-Age=0");
  });

  it("senza NODE_ENV definito NON include il flag Secure", () => {
    const cookie = conNodeEnvAssente(() => clearSessionCookie());
    expect(cookie).not.toContain("Secure");
  });
});
