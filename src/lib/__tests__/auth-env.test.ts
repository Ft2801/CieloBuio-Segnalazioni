/**
 * Test per i rami di produzione/development in setSessionCookie / clearSessionCookie.
 * Copre i branch `process.env.NODE_ENV === "production"` true e false,
 * inclusa la logica del prefisso __Host-.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionCookieName,
  SESSION_COOKIE,
} from "@/lib/auth";

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
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    expect(getSessionCookieName()).toBe("cb_session");
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
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    const cookie = setSessionCookie("token-noenv");
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
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    const cookie = clearSessionCookie();
    expect(cookie).not.toContain("Secure");
  });
});

describe("SESSION_COOKIE costante", () => {
  it("è coerente con getSessionCookieName() all'import", () => {
    // SESSION_COOKIE è calcolato all'import, quindi riflette il NODE_ENV
    // al momento del primo caricamento del modulo (solitamente development
    // o undefined in ambienti di test).
    expect(SESSION_COOKIE).toBe(getSessionCookieName());
  });
});
