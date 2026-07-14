/**
 * Test di integrazione per /api/auth/me
 *
 * La route GET /api/auth/me NON ritorna 401 quando non autenticata:
 * ritorna 200 con `{ user: null }`. Questo perché è usata dal client
 * per verificare lo stato di autenticazione al caricamento della pagina
 * (un 401 genererebbe un errore in console per ogni visitatore non loggato).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GET } from "@/app/api/auth/me/route";

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 200 con user=null se nessun cookie di sessione", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toBeNull();
  });

  it("ritorna 200 con user=null se sessione non trovata", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toBeNull();
  });

  it("ritorna 200 con user=null se sessione scaduta", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "tok",
      scadenza: new Date(Date.now() - 1000),
      user: { id: "u1", email: "e@t.it", nomeCognome: "N", ruolo: "volontario", provinciaId: null, regioneId: null, inizialiProtocollo: null, pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
    } as any);
    vi.mocked(db.sessione.delete).mockResolvedValue({} as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toBeNull();
  });

  it("ritorna 200 con user=null se utente non attivo", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "tok",
      scadenza: new Date(Date.now() + 10000),
      user: { id: "u1", email: "e@t.it", nomeCognome: "N", ruolo: "volontario", provinciaId: null, regioneId: null, inizialiProtocollo: null, pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: false },
    } as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toBeNull();
  });

  it("ritorna i dati utente se sessione valida", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as any);
    vi.mocked(db.sessione.findUnique).mockResolvedValue({
      id: "s1",
      token: "tok",
      scadenza: new Date(Date.now() + 10000),
      user: { id: "u1", email: "admin@test.it", nomeCognome: "Admin", ruolo: "admin", provinciaId: null, regioneId: null, inizialiProtocollo: "AD", pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true },
    } as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("admin@test.it");
    expect(json.user.ruolo).toBe("admin");
  });
});
