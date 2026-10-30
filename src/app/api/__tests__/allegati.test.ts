/**
 * Test di integrazione per le route allegati:
 * - DELETE /api/allegati?id=<allegatoId>
 * - GET    /api/allegati/[id]/download
 * - GET    /api/allegati/[id]/preview
 *
 * Copre:
 * - 401/403/404/400/200 per ciascuna route
 * - Proprietario può eliminare SOLO in stato "bozza" (NON in
 *   "in_revisione"); referenti/admin possono eliminare in entrambi gli stati
 * - Path traversal protection (id malformato, "..", segnalazioneId mismatch)
 * - Content-Disposition: attachment (download) vs inline (preview)
 * - Content-Type basato su estensione, sanitizzazione filename
 * - urlStorage fuori dal formato <segnalazioneId>/<file>
 * - unlink error ignorato (file non presente su disco)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("fs/promises", () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn().mockResolvedValue({ isSymbolicLink: () => false }),
}));

vi.mock("@/lib/db", () => {
  const mockDb = {
    segnalazione: { update: vi.fn().mockResolvedValue({}) },
    allegato: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    sessione: {
      findUnique: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  };
  mockDb.$transaction.mockImplementation(async (cb) => {
    if (typeof cb === "function") return cb(mockDb);
    return Promise.all(cb);
  });
  return { db: mockDb };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { unlink, readFile, stat } from "fs/promises";
import { DELETE } from "@/app/api/allegati/route";
import { GET as DOWNLOAD } from "@/app/api/allegati/[id]/download/route";
import { GET as PREVIEW } from "@/app/api/allegati/[id]/preview/route";

// ---------------------------------------------------------------------------
// Sessioni mock
// ---------------------------------------------------------------------------
// Tipo comune per tutte le sessioni: permette di passare qualsiasi sessione
// a mockSession senza errori di tipo dovuti ai letterali null/number su
// provinciaId/regioneId.
type MockSession = {
  id: string;
  token: string;
  scadenza: Date;
  user: {
    id: string;
    email: string;
    nomeCognome: string;
    ruolo: string;
    provinciaId: number | null;
    regioneId: number | null;
    inizialiProtocollo: string;
    pec: string | null;
    emailOrdinaria: string | null;
    indirizzo: string | null;
    firma: string | null;
    attivo: boolean;
  };
};

const VOL_SESSION: MockSession = {
  id: "s1",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-vol",
    email: "vol@t.it",
    nomeCognome: "Volontario",
    ruolo: "volontario",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "VL",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
const ADMIN_SESSION: MockSession = {
  id: "s2",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-admin",
    email: "admin@t.it",
    nomeCognome: "Admin",
    ruolo: "admin",
    provinciaId: null,
    regioneId: null,
    inizialiProtocollo: "AD",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
const REF_PROV_SESSION: MockSession = {
  id: "s3",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref-prov",
    email: "refprov@t.it",
    nomeCognome: "Ref Prov",
    ruolo: "referente_provinciale",
    provinciaId: 5,
    regioneId: null,
    inizialiProtocollo: "RP",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};
const REF_REG_SESSION: MockSession = {
  id: "s4",
  token: "tok",
  scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-ref-reg",
    email: "refreg@t.it",
    nomeCognome: "Ref Reg",
    ruolo: "referente_regionale",
    provinciaId: null,
    regioneId: 3,
    inizialiProtocollo: "RR",
    pec: null,
    emailOrdinaria: null,
    indirizzo: null,
    firma: null,
    attivo: true,
  },
};

function mockSession(user: MockSession | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as never);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as never);
}

// Costruisce un allegato mock con segnalazione inclusa
function mockAllegato(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    segnalazioneId: "s1",
    tipo: "foto",
    urlStorage: "s1/uuid-filename.jpg",
    nomeOriginale: "foto.jpg",
    segnalazione: {
      id: "s1",
      stato: "bozza",
      volontarioId: "u-vol",
      provinciaId: 5,
      regioneId: 3,
    },
    ...overrides,
  };
}

function makeDeleteReq(id?: string | null): NextRequest {
  const url = id ? `http://localhost/api/allegati?id=${encodeURIComponent(id)}` : "http://localhost/api/allegati";
  return new NextRequest(url, { method: "DELETE" });
}

function makeGetReq(id: string, sub: "download" | "preview"): NextRequest {
  return new NextRequest(`http://localhost/api/allegati/${id}/${sub}`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/allegati
// ---------------------------------------------------------------------------
describe("DELETE /api/allegati", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 1 });
  });

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(401);
  });

  it("ritorna 400 se id mancante", async () => {
    mockSession(VOL_SESSION);
    const res = await DELETE(makeDeleteReq(null));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ID obbligatorio");
  });

  it("ritorna 404 se allegato non trovato", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeDeleteReq("a-mancante"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Non trovato");
  });

  it("ritorna 400 se segnalazione non in stato modificabile (approvata)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "approvata", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("dopo l'invio");
  });

  it("ritorna 403 se non proprietario né referente con competenza", async () => {
    // Volontario che tenta di eliminare allegato di un altro utente in bozza
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro-utente", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato");
  });

  it("ritorna 403 se proprietario in stato in_revisione (pacchetto congelato)", async () => {
    // Il proprietario può eliminare SOLO in bozza, NON in in_revisione:
    // il pacchetto probatorio è congelato dopo l'invio in revisione.
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "in_revisione", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(403);
  });

  it("ritorna 200 se proprietario elimina in stato bozza", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // Verifica che unlink sia stato chiamato (file eliminato da disco)
    expect(unlink).toHaveBeenCalledTimes(1);
    // Verifica che delete DB sia stato chiamato
    expect(db.allegato.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "a1" }) }),
    );
  });

  it("ritorna 200 se admin elimina in stato in_revisione", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "in_revisione", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
  });

  it("ritorna 200 se referente_provinciale con provincia corrispondente", async () => {
    mockSession(REF_PROV_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "in_revisione", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
  });

  it("ritorna 403 se referente_provinciale con provincia non corrispondente", async () => {
    mockSession(REF_PROV_SESSION); // provinciaId = 5
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro", provinciaId: 99, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(403);
  });

  it("ritorna 403 se referente_provinciale con provinciaId null (fail-closed)", async () => {
    // Referente mal configurato senza provincia: fail-closed blocca l'azione
    const REF_NO_PROV = {
      ...REF_PROV_SESSION,
      user: { ...REF_PROV_SESSION.user, provinciaId: null },
    };
    mockSession(REF_NO_PROV);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(403);
  });

  it("ritorna 200 se referente_regionale con regione corrispondente", async () => {
    mockSession(REF_REG_SESSION); // regioneId = 3
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "in_revisione", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
  });

  it("ritorna 403 se referente_regionale con regione non corrispondente", async () => {
    mockSession(REF_REG_SESSION); // regioneId = 3
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro", provinciaId: 5, regioneId: 99 },
      }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(403);
  });

  it("ignora errore unlink se file non esiste su disco", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(unlink).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await DELETE(makeDeleteReq("a1"));
    // L'errore unlink è ignorato: il record DB viene comunque eliminato
    expect(res.status).toBe(200);
    expect(db.allegato.deleteMany).toHaveBeenCalled();
  });

  it("skip unlink se urlStorage malformato, ma elimina record DB", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "formato-malformato-senza-slash" }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    // unlink non viene chiamato perché il parsing del path fallisce
    expect(unlink).not.toHaveBeenCalled();
    // ma delete DB viene comunque chiamato
    expect(db.allegato.deleteMany).toHaveBeenCalled();
  });

  it("urlStorage fuori formato: il record viene eliminato senza rimuovere file", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "formato/non/valido/s1/old-file.jpg" }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    expect(db.allegato.deleteMany).toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it("non elimina l'allegato se la pratica è approvata mentre acquisisce il lock", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique)
      .mockResolvedValueOnce(mockAllegato() as never)
      .mockResolvedValueOnce(
        mockAllegato({
          segnalazione: { id: "s1", stato: "approvata", volontarioId: "u-vol", provinciaId: 5, regioneId: 3 },
        }) as never,
      );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(404);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it("non elimina l'allegato se il proprietario cambia dopo il controllo iniziale", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique)
      .mockResolvedValueOnce(mockAllegato() as never)
      .mockResolvedValueOnce(
        mockAllegato({
          segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro", provinciaId: 5, regioneId: 3 },
        }) as never,
      );
    expect((await DELETE(makeDeleteReq("a1"))).status).toBe(404);
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
  });

  it("non elimina se l'allegato non esiste più o cambia pratica", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.allegato.findUnique)
      .mockResolvedValueOnce(mockAllegato() as never)
      .mockResolvedValueOnce(null);
    expect((await DELETE(makeDeleteReq("a1"))).status).toBe(404);
    vi.mocked(db.allegato.findUnique).mockReset();
    vi.mocked(db.allegato.findUnique)
      .mockResolvedValueOnce(mockAllegato() as never)
      .mockResolvedValueOnce(mockAllegato({ segnalazioneId: "altra" }) as never);
    expect((await DELETE(makeDeleteReq("a1"))).status).toBe(404);
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
  });

  it("skip unlink se segnalazioneId in urlStorage non corrisponde", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "s1-different/uuid-filename.jpg" }) as never,
    );
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    // unlink non viene chiamato: segnalazioneId mismatch (defense-in-depth)
    expect(unlink).not.toHaveBeenCalled();
    expect(db.allegato.deleteMany).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/allegati/[id]/download
// ---------------------------------------------------------------------------
describe("GET /api/allegati/[id]/download", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se allegato non trovato", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(null);
    const res = await DOWNLOAD(makeGetReq("a-mancante", "download"), {
      params: Promise.resolve({ id: "a-mancante" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Allegato non trovato");
  });

  it("ritorna 403 se non autorizzato (volontario su segnalazione altrui)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se urlStorage con formato non valido", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "formato-malformato" }) as never);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Path non valido");
  });

  it("ritorna 400 se filename contiene '..' (path traversal)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "s1/.." }) as never);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Path non valido");
  });

  it("ritorna 400 se segnalazioneId in urlStorage non corrisponde", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "s1-different/file.jpg" }) as never);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Path non valido");
  });

  it("ritorna 404 se file non trovato su disco (stat throw)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("File non trovato");
  });

  it("ritorna 404 se path è una directory (isFile false)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(stat).mockResolvedValue({ isFile: () => false } as never);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
  });

  it("download JPG con successo ritorna 200 con header corretti", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/uuid-filename.jpg",
        nomeOriginale: "foto.jpg",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("foto.jpg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // Verifica che il body sia il buffer
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array(fileBuffer));
  });

  it("download PDF ritorna 200 con Content-Type application/pdf", async () => {
    mockSession(VOL_SESSION);
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/doc.pdf",
        nomeOriginale: "documento.pdf",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(pdfBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("documento.pdf");
  });

  it("download con urlStorage fuori formato ritorna 400", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "formato/non/valido/s1/old-photo.png",
        nomeOriginale: "old-photo.png",
      }) as never,
    );
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Path non valido");
  });

  it("sanitizza Content-Disposition per filename con caratteri speciali", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/uuid.jpg",
        nomeOriginale: 'foto"<evil>.jpg',
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    // I caratteri fuori da [\w.\- ] (virgolette, parentesi angolari) diventano "_"
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="foto__evil_.jpg"');
  });

  it("admin può scaricare allegato di segnalazione altrui", async () => {
    mockSession(ADMIN_SESSION);
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro-utente", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/allegati/[id]/preview
// ---------------------------------------------------------------------------
describe("GET /api/allegati/[id]/preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("ritorna 404 se allegato non trovato", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(null);
    const res = await PREVIEW(makeGetReq("a-mancante", "preview"), {
      params: Promise.resolve({ id: "a-mancante" }),
    });
    expect(res.status).toBe(404);
  });

  it("ritorna 403 se non autorizzato", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        segnalazione: { id: "s1", stato: "bozza", volontarioId: "altro", provinciaId: 5, regioneId: 3 },
      }) as never,
    );
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(403);
  });

  it("ritorna 400 se path traversal (filename con '..')", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "s1/.." }) as never);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("preview con successo ritorna 200 con Content-Disposition inline (immagini)", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/uuid-filename.jpg",
        nomeOriginale: "foto.jpg",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    // Le immagini usano "inline" per permettere il rendering <img>
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(res.headers.get("Content-Disposition")).toContain("foto.jpg");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("preview PDF ritorna 200 con Content-Disposition attachment (no inline per sicurezza)", async () => {
    mockSession(VOL_SESSION);
    const pdfBuffer = Buffer.from("%PDF-1.4\ntest");
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/uuid-doc.pdf",
        nomeOriginale: "documento.pdf",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(pdfBuffer);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    // I PDF usano "attachment" per prevenire XSS via JavaScript embedded
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("documento.pdf");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("preview PNG con Content-Type image/png", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/image.png",
        nomeOriginale: "image.png",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("ritorna 404 se file non trovato su disco (stat throw)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
  });

  it("ritorna 400 se urlStorage con formato non valido", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "malformato" }) as never);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("preview con urlStorage fuori formato ritorna 400", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "formato/non/valido/s1/old-photo.jpg",
        nomeOriginale: "old-photo.jpg",
      }) as never,
    );
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se segnalazioneId in urlStorage non corrisponde (preview)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato({ urlStorage: "s1-different/file.jpg" }) as never);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("ritorna 404 se path è una directory (isFile false, preview)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(stat).mockResolvedValue({ isFile: () => false } as never);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(404);
  });

  it("preview con estensione non mappata ritorna application/octet-stream", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/file.txt",
        nomeOriginale: "file.txt",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

// ---------------------------------------------------------------------------
// GET /api/allegati/[id]/download - additional edge cases
// ---------------------------------------------------------------------------
describe("GET /api/allegati/[id]/download - edge cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("download con estensione non mappata ritorna application/octet-stream", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/file.txt",
        nomeOriginale: "file.txt",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("download WebP ritorna 200 con Content-Type image/webp", async () => {
    mockSession(VOL_SESSION);
    const fileBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({
        urlStorage: "s1/image.webp",
        nomeOriginale: "image.webp",
      }) as never,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(fileBuffer);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });
});

// -----------------------------------------------------------------------------
// DELETE /api/allegati - rami residui
// -----------------------------------------------------------------------------
describe("DELETE /api/allegati - rami residui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ritorna 404 se nessuna riga viene eliminata (allegato già rimosso o stato cambiato)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 0 });
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("non più modificabile");
  });

  it("elimina l'allegato senza tentare la rimozione del file se urlStorage non è riconoscibile", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "https://esterno.example/x.jpg" }) as never,
    );
    vi.mocked(db.allegato.deleteMany).mockResolvedValue({ count: 1 });
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    expect(unlink).not.toHaveBeenCalled();
    expect(db.allegato.deleteMany).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// download e preview di file senza estensione (ramo ext vuota)
// -----------------------------------------------------------------------------
describe("allegati download e preview - file senza estensione", () => {
  it("download di un file senza estensione risponde 200", async () => {
    const fsMock = await import("fs/promises");
    vi.mocked(fsMock.readFile).mockResolvedValue(Buffer.from("contenuto") as never);
    vi.mocked(fsMock.stat).mockResolvedValue({ isFile: () => true } as never);
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "s1/uuidsenzaestensione", nomeOriginale: "documento" }) as never,
    );
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("preview di un file senza estensione risponde con un mime generico", async () => {
    const fsMock = await import("fs/promises");
    vi.mocked(fsMock.readFile).mockResolvedValue(Buffer.from("contenuto") as never);
    vi.mocked(fsMock.stat).mockResolvedValue({ isFile: () => true } as never);
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(
      mockAllegato({ urlStorage: "s1/uuidsenzaestensione", nomeOriginale: "documento" }) as never,
    );
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

// Il percorso degli allegati è risolto da path-guard: il wrapper resta fedele
// all'implementazione reale e consente di simulare un percorso non risolvibile.
vi.mock("@/lib/path-guard", async (importOriginale) => {
  const originale = await importOriginale<typeof import("@/lib/path-guard")>();
  return { ...originale, risolviPathAllegatoSicuro: vi.fn(originale.risolviPathAllegatoSicuro) };
});

describe("allegati DELETE - percorso non risolvibile", () => {
  it("se il percorso non è risolvibile il record viene eliminato senza toccare il file", async () => {
    const pg = await import("@/lib/path-guard");
    const fsp = await import("fs/promises");
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(pg.risolviPathAllegatoSicuro).mockReturnValueOnce(null);
    const res = await DELETE(makeDeleteReq("a1"));
    expect(res.status).toBe(200);
    expect(fsp.unlink).not.toHaveBeenCalled();
  });
});

describe("allegati download e preview - percorso non risolvibile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("download ritorna 400 se il percorso del file non è risolvibile in sicurezza", async () => {
    const pg = await import("@/lib/path-guard");
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(pg.risolviPathAllegatoSicuro).mockReturnValueOnce(null);
    const res = await DOWNLOAD(makeGetReq("a1", "download"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Path non valido");
  });

  it("preview ritorna 400 se il percorso del file non è risolvibile in sicurezza", async () => {
    const pg = await import("@/lib/path-guard");
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked(pg.risolviPathAllegatoSicuro).mockReturnValueOnce(null);
    const res = await PREVIEW(makeGetReq("a1", "preview"), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Path non valido");
  });
});

describe("snapshot eliminazione allegato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(VOL_SESSION);
  });
  it("risponde 409 senza cancellare il record o il file per una versione non corrente", async () => {
    const allegato = mockAllegato();
    vi.mocked(db.allegato.findUnique).mockResolvedValue({
      ...allegato,
      segnalazione: { ...allegato.segnalazione, updatedAt: new Date() },
    } as never);
    const req = makeDeleteReq("a1");
    req.headers.set("If-Match", '"obsoleta"');
    expect((await DELETE(req)).status).toBe(409);
    expect(db.allegato.deleteMany).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
});

describe("lettura dello storage privato", () => {
  it.each([DOWNLOAD, PREVIEW])("non serve file attraverso collegamenti simbolici", async (leggi) => {
    vi.clearAllMocks();
    mockSession(VOL_SESSION);
    vi.mocked(db.allegato.findUnique).mockResolvedValue(mockAllegato() as never);
    vi.mocked((await import("fs/promises")).lstat).mockResolvedValueOnce({ isSymbolicLink: () => true } as never);
    const res = await leggi(makeGetReq("a1", "download"), { params: Promise.resolve({ id: "a1" }) });
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });
});
