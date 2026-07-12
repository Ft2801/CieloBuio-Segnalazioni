/**
 * Test di integrazione per /api/upload (POST upload allegato).
 *
 * Copre:
 * - 401 per utente non autenticato
 * - 429 per rate limit (20 upload/minuto)
 * - 400 per body non multipart, file/segnalazioneId mancanti, tipo non ammesso,
 *   file troppo grande, estensione non ammessa, magic bytes mismatch
 *   (JPG/PNG/WebP/PDF), stato segnalazione non modificabile, limite 4 allegati
 * - 404 per segnalazione non trovata
 * - 403 per utente non autorizzato (volontario su segnalazione altrui)
 * - 201 per caso successo (JPG, PNG, WebP, PDF, tipo default, admin)
 * - 500 per errore interno DB
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => {
  const allegatoCount = vi.fn();
  const allegatoCreate = vi.fn();
  return {
    db: {
      segnalazione: {
        findUnique: vi.fn(),
      },
      allegato: {
        count: allegatoCount,
        create: allegatoCreate,
      },
      sessione: {
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      // $transaction esegue la callback passandogli un "tx" che ha la
      // stessa forma di db. Per i test, passiamo lo stesso oggetto db
      // così i mock di count/create sono gli stessi.
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({
        allegato: { count: allegatoCount, create: allegatoCreate },
      })),
    },
  };
});

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { __resetRateLimitStoreForTests } from "@/lib/rate-limit";
import { POST, verificaMagicBytes } from "@/app/api/upload/route";

const VOL_SESSION = {
  id: "cabcdefghij1234567890", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-vol", email: "vol@t.it", nomeCognome: "Volontario", ruolo: "volontario",
    provinciaId: null, regioneId: null, inizialiProtocollo: "VL",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};
const ADMIN_SESSION = {
  id: "s2", token: "tok", scadenza: new Date(Date.now() + 10000),
  user: {
    id: "u-admin", email: "admin@t.it", nomeCognome: "Admin", ruolo: "admin",
    provinciaId: null, regioneId: null, inizialiProtocollo: "AD",
    pec: null, emailOrdinaria: null, indirizzo: null, firma: null, attivo: true,
  },
};

function mockSession(user: typeof VOL_SESSION | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => (user ? { value: "tok" } : undefined),
  } as any);
  vi.mocked(db.sessione.findUnique).mockResolvedValue((user ?? null) as any);
}

// Magic bytes per i tipi ammessi (lunghezza sufficiente per i check della route)
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x00, 0x00, 0x00, 0x00, // size (irrilevante per il check)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x56, 0x50, 0x38, 0x4c, // "VP8L" (chunk type, oltre il magic)
]);
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);

function makeFile(name: string, content: Buffer, type: string): File {
  // Converte Buffer a Uint8Array per compatibilità con BlobPart:
  // in TypeScript 5.7+ Buffer è Buffer<ArrayBufferLike> che può includere
  // SharedArrayBuffer, non assegnabile a BlobPart (che richiede ArrayBuffer).
  return new File([new Uint8Array(content)], name, { type });
}

function makeUploadRequest(opts: {
  file?: File | null;
  segnalazioneId?: string | null;
  tipo?: string | null;
}): NextRequest {
  const fd = new FormData();
  if (opts.file !== undefined && opts.file !== null) fd.append("file", opts.file);
  if (opts.segnalazioneId !== undefined && opts.segnalazioneId !== null) {
    fd.append("segnalazioneId", opts.segnalazioneId);
  }
  if (opts.tipo !== undefined && opts.tipo !== null) fd.append("tipo", opts.tipo);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: fd,
  });
}

function mockSegnalazione(overrides: Record<string, unknown> = {}) {
  return {
    id: "cabcdefghij1234567890",
    stato: "bozza",
    volontarioId: "u-vol",
    provinciaId: 1,
    regioneId: 1,
    ...overrides,
  };
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTests();
  });
  afterEach(() => __resetRateLimitStoreForTests());

  it("ritorna 401 se non autenticato", async () => {
    mockSession(null);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(401);
  });

  it("ritorna 400 se body non è multipart/form-data", async () => {
    mockSession(VOL_SESSION);
    const req = new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: "non è multipart",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("multipart");
  });

  it("ritorna 400 se file mancante", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({ segnalazioneId: "cabcdefghij1234567890" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("obbligatori");
  });

  it("ritorna 400 se segnalazioneId mancante", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("obbligatori");
  });

  it("ritorna 400 se segnalazioneId non è un CUID valido (path traversal)", async () => {
    // Difesa in profondità: il formato CUID è verificato prima della lookup DB.
    // "../../etc/passwd" non è un CUID valido e non è un segmento di path sicuro.
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "../../etc/passwd",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazioneId non valido");
  });

  it("ritorna 400 se segnalazioneId contiene separatori (non CUID)", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890/file.jpg",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazioneId non valido");
  });

  it("ritorna 400 se segnalazioneId è troppo corto (non CUID)", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "short",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("segnalazioneId non valido");
  });

  it("ritorna 400 se tipo non ammesso", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
      tipo: "malware",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Tipo non valido");
  });

  it("ritorna 400 se file troppo grande (> 10 MB)", async () => {
    mockSession(VOL_SESSION);
    // Alloca un buffer reale di 10 MB + 1 byte con magic bytes JPG all'inizio.
    // L'override di size via defineProperty non sopravvive al round-trip
    // di FormData (il file viene serializzato e deserializzato), quindi
    // è necessario usare un buffer reale.
    const bigContent = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    bigContent[0] = 0xff;
    bigContent[1] = 0xd8;
    bigContent[2] = 0xff;
    const res = await POST(makeUploadRequest({
      file: makeFile("big.jpg", bigContent, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("troppo grande");
  });

  it("ritorna 400 se estensione non ammessa", async () => {
    mockSession(VOL_SESSION);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.exe", JPG_BYTES, "application/octet-stream"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non ammesso");
  });

  it("ritorna 404 se segnalazione non trovata", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(null);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "czzzzzzzzzzzzzzzzzzzzz",
    }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("non trovata");
  });

  it("ritorna 403 se volontario non proprietario", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazione({ volontarioId: "altro-utente" }) as any
    );
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Non autorizzato");
  });

  it("ritorna 400 se segnalazione in stato approvata", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazione({ stato: "approvata" }) as any
    );
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("allegati dopo");
  });

  it("ritorna 400 se volontario carica allegati in stato in_revisione (pacchetto congelato)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazione({ stato: "in_revisione" }) as any
    );
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("solo in stato bozza");
  });

  it("ritorna 400 se segnalazione in stato inviata", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazione({ stato: "inviata" }) as any
    );
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se limite 4 allegati raggiunto", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(4);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Limite massimo di 4 allegati");
  });

  it("ritorna 400 se magic bytes JPG non corrispondono (contenuto PNG)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    const res = await POST(makeUploadRequest({
      file: makeFile("fake.jpg", PNG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non corrisponde");
  });

  it("ritorna 400 se magic bytes PDF non corrispondono (contenuto JPG)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    const res = await POST(makeUploadRequest({
      file: makeFile("fake.pdf", JPG_BYTES, "application/pdf"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
  });

  it("ritorna 400 se WebP ha RIFF ma non WEBP (es. WAV)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    // RIFF header ma con "WAVE" invece di "WEBP" ai byte 8-11
    const wavBytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // size
      0x57, 0x41, 0x56, 0x45, // "WAVE" (non "WEBP")
      0x66, 0x6d, 0x74, 0x20, // "fmt " chunk
    ]);
    const res = await POST(makeUploadRequest({
      file: makeFile("fake.webp", wavBytes, "image/webp"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non corrisponde");
  });

  it("ritorna 400 se WebP troppo corto (< 12 byte)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    const shortBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]); // "RIFF\0"
    const res = await POST(makeUploadRequest({
      file: makeFile("short.webp", shortBytes, "image/webp"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
  });

  it("upload JPG con successo ritorna 201", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a1", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.jpg", nomeOriginale: "test.jpg",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
      tipo: "foto",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.allegato.id).toBe("a1");
    expect(json.mime).toBe("image/jpeg");
    // Verifica che create sia stato chiamato con i dati attesi
    expect(db.allegato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        segnalazioneId: "cabcdefghij1234567890",
        tipo: "foto",
        nomeOriginale: "test.jpg",
      }),
    }));
  });

  it("upload PNG con successo ritorna 201 con mime image/png", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a2", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.png", nomeOriginale: "test.png",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.png", PNG_BYTES, "image/png"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.mime).toBe("image/png");
  });

  it("upload WebP con successo ritorna 201 con mime image/webp", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a3", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.webp", nomeOriginale: "test.webp",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.webp", WEBP_BYTES, "image/webp"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.mime).toBe("image/webp");
  });

  it("upload PDF con successo ritorna 201 con mime application/pdf", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a4", segnalazioneId: "cabcdefghij1234567890", tipo: "documento",
      urlStorage: "s1/uuid.pdf", nomeOriginale: "doc.pdf",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("doc.pdf", PDF_BYTES, "application/pdf"),
      segnalazioneId: "cabcdefghij1234567890",
      tipo: "documento",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.mime).toBe("application/pdf");
    expect(json.allegato.tipo).toBe("documento");
  });

  it("upload senza tipo usa default 'foto'", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a5", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.jpg", nomeOriginale: "test.jpg",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
      // tipo non specificato: default "foto"
    }));
    expect(res.status).toBe(201);
    expect(db.allegato.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipo: "foto" }),
    }));
  });

  it("upload admin su segnalazione altrui ritorna 201", async () => {
    mockSession(ADMIN_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(
      mockSegnalazione({ volontarioId: "altro-utente" }) as any
    );
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a6", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.jpg", nomeOriginale: "test.jpg",
    } as any);
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(201);
  });

  it("ritorna 500 se allegato.create solleva errore", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockRejectedValue(new Error("DB error"));
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Errore interno");
  });

  it("rate limit: blocca al 21esimo upload (429)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    vi.mocked(db.allegato.create).mockResolvedValue({
      id: "a", segnalazioneId: "cabcdefghij1234567890", tipo: "foto",
      urlStorage: "s1/uuid.jpg", nomeOriginale: "test.jpg",
    } as any);
    // 20 upload permessi, al 21° scatta il blocco
    for (let i = 0; i < 20; i++) {
      const res = await POST(makeUploadRequest({
        file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
        segnalazioneId: "cabcdefghij1234567890",
      }));
      expect(res.status).toBe(201);
    }
    // 21° upload: bloccato dal rate limit
    const res = await POST(makeUploadRequest({
      file: makeFile("test.jpg", JPG_BYTES, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Troppi upload");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("ritorna 400 se JPG troppo corto (< 3 byte, verificaMagicBytes short)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    const shortBytes = Buffer.from([0xff, 0xd8]); // 2 byte, meno dei 3 attesi per JPG
    const res = await POST(makeUploadRequest({
      file: makeFile("short.jpg", shortBytes, "image/jpeg"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non corrisponde");
  });

  it("ritorna 400 se WebP con primi 4 byte non RIFF (verificaWebPMagicBytes)", async () => {
    mockSession(VOL_SESSION);
    vi.mocked(db.segnalazione.findUnique).mockResolvedValue(mockSegnalazione() as any);
    vi.mocked(db.allegato.count).mockResolvedValue(0);
    // 12 byte ma primi 4 non sono "RIFF"
    const nonRiffBytes = Buffer.from([
      0x00, 0x00, 0x00, 0x00, // non RIFF
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);
    const res = await POST(makeUploadRequest({
      file: makeFile("fake.webp", nonRiffBytes, "image/webp"),
      segnalazioneId: "cabcdefghij1234567890",
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("non corrisponde");
  });
});

// -----------------------------------------------------------------------------
// Test diretti su verificaMagicBytes (per coprire il ramo `return false`
// finale, irraggiungibile tramite l'API POST perché questa filtra ext
// contro EXT_AMMESSE prima di chiamare la funzione).
// -----------------------------------------------------------------------------

describe("verificaMagicBytes (test diretto)", () => {
  it("ritorna false per estensione non riconosciuta (ramo finale return false)", () => {
    // L'API non permette mai di arrivare qui con un'estensione non ammessa,
    // ma la funzione difensivamente ritorna false. Si verifica direttamente.
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(verificaMagicBytes(buffer, ".gif")).toBe(false);
    expect(verificaMagicBytes(buffer, ".exe")).toBe(false);
    expect(verificaMagicBytes(buffer, ".unknown")).toBe(false);
  });

  it("ritorna false per estensione vuota o non standard", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff]);
    expect(verificaMagicBytes(buffer, "")).toBe(false);
    expect(verificaMagicBytes(buffer, ".bmp")).toBe(false);
    expect(verificaMagicBytes(buffer, ".tiff")).toBe(false);
  });
});
