/**
 * Test dedicati per src/lib/path-guard.ts - copertura 100% dei rami
 * difensivi (type-check runtime, segmenti vuoti, edge cases).
 */
import { describe, it, expect } from "vitest";
import {
  UPLOADS_ROOT,
  isValidCuid,
  isSafePathSegment,
  parseUrlStorageSicuro,
  risolviPathAllegatoSicuro,
} from "@/lib/path-guard";
import path from "path";

describe("isValidCuid", () => {
  it("accetta CUID valido (c + 20+ char alfanumerici)", () => {
    expect(isValidCuid("cabcdefghij1234567890")).toBe(true);
    expect(isValidCuid("c" + "x".repeat(30))).toBe(true);
  });

  it("respinge stringhe che non iniziano per 'c'", () => {
    expect(isValidCuid("xabcdefghij1234567890")).toBe(false);
  });

  it("respinge stringhe troppo corte (< 21 char)", () => {
    expect(isValidCuid("c")).toBe(false);
    expect(isValidCuid("cshort")).toBe(false);
  });

  it("respinge stringhe troppo lunghe (> 31 char)", () => {
    // Il regex è c[a-z0-9]{20,30} = lunghezza totale 21-31
    expect(isValidCuid("c" + "x".repeat(30))).toBe(true);  // 31 char totali, ok
    expect(isValidCuid("c" + "x".repeat(31))).toBe(false);  // 32 char, troppo lungo
    expect(isValidCuid("c" + "x".repeat(50))).toBe(false);  // 51 char, troppo lungo
  });

  it("respinge caratteri non alfanumerici", () => {
    expect(isValidCuid("c../../etc/passwd")).toBe(false);
    expect(isValidCuid("cabc-def-ghi")).toBe(false);
  });

  it("respinge stringa vuota", () => {
    expect(isValidCuid("")).toBe(false);
  });
});

describe("isSafePathSegment", () => {
  it("accetta segmento sicuro (no caratteri pericolosi)", () => {
    expect(isSafePathSegment("file.jpg")).toBe(true);
    expect(isSafePathSegment("cabcdefghij1234567890")).toBe(true);
    expect(isSafePathSegment("abc-def_123.txt")).toBe(true);
  });

  it("respinge stringa vuota (ramo !value)", () => {
    expect(isSafePathSegment("")).toBe(false);
  });

  it("respinge null/undefined passati come any (ramo typeof)", () => {
    expect(isSafePathSegment(null as unknown as string)).toBe(false);
    expect(isSafePathSegment(undefined as unknown as string)).toBe(false);
    expect(isSafePathSegment(42 as unknown as string)).toBe(false);
  });

  it("respinge .. (path traversal classico)", () => {
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("../etc")).toBe(false);
    expect(isSafePathSegment("a..b")).toBe(false);  // contains ..
  });

  it("respinge / (separatore Unix)", () => {
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("/etc")).toBe(false);
  });

  it("respinge \\ (separatore Windows)", () => {
    expect(isSafePathSegment("a\\b")).toBe(false);
    expect(isSafePathSegment("\\etc")).toBe(false);
  });

  it("respinge null byte", () => {
    expect(isSafePathSegment("a\0b")).toBe(false);
    expect(isSafePathSegment("\0")).toBe(false);
  });
});

describe("parseUrlStorageSicuro", () => {
  it("accetta formato attuale <segnalazioneId>/<filename>", () => {
    expect(parseUrlStorageSicuro("cabcdefghij1234567890/file.jpg")).toEqual({
      segnalazioneId: "cabcdefghij1234567890",
      filename: "file.jpg",
    });
  });

  it("accetta formato legacy api/allegatiplaceholder/<id>/<filename>", () => {
    expect(parseUrlStorageSicuro("api/allegatiplaceholder/cabcdefghij1234567890/file.jpg")).toEqual({
      segnalazioneId: "cabcdefghij1234567890",
      filename: "file.jpg",
    });
  });

  it("respinge null/undefined passati come any (ramo typeof)", () => {
    expect(parseUrlStorageSicuro(null as unknown as string)).toBe(null);
    expect(parseUrlStorageSicuro(undefined as unknown as string)).toBe(null);
    expect(parseUrlStorageSicuro(42 as unknown as string)).toBe(null);
  });

  it("respinge stringa vuota", () => {
    expect(parseUrlStorageSicuro("")).toBe(null);
  });

  it("respinge formato con numero errato di segmenti", () => {
    expect(parseUrlStorageSicuro("only-one-segment")).toBe(null);
    expect(parseUrlStorageSicuro("a/b/c")).toBe(null);
    expect(parseUrlStorageSicuro("a/b/c/d/e")).toBe(null);
  });

  it("respinge formato legacy con prefisso errato", () => {
    expect(parseUrlStorageSicuro("api/wrongprefix/cid/file.jpg")).toBe(null);
    expect(parseUrlStorageSicuro("other/allegatiplaceholder/cid/file.jpg")).toBe(null);
  });

  it("respinge segmenti con path traversal (..)", () => {
    expect(parseUrlStorageSicuro("../etc/passwd")).toBe(null);
    expect(parseUrlStorageSicuro("api/allegatiplaceholder/../../etc/passwd")).toBe(null);
    expect(parseUrlStorageSicuro("cabcdefghij1234567890/..")).toBe(null);
  });

  it("respinge segmenti con separatori (filename con /)", () => {
    expect(parseUrlStorageSicuro("segid/etc/passwd")).toBe(null);
    expect(parseUrlStorageSicuro("api/allegatiplaceholder/segid/etc/passwd")).toBe(null);
  });
});

describe("risolviPathAllegatoSicuro", () => {
  it("risolve path valido dentro uploadsRoot", () => {
    const result = risolviPathAllegatoSicuro("cabcdefghij1234567890", "file.jpg");
    expect(result).not.toBeNull();
    expect(result?.startsWith(UPLOADS_ROOT + path.sep)).toBe(true);
    expect(result?.endsWith("cabcdefghij1234567890/file.jpg")).toBe(true);
  });

  it("respinge segnalazioneId non sicuro (path traversal)", () => {
    expect(risolviPathAllegatoSicuro("..", "file.jpg")).toBeNull();
    expect(risolviPathAllegatoSicuro("a/b", "file.jpg")).toBeNull();
    expect(risolviPathAllegatoSicuro("", "file.jpg")).toBeNull();
  });

  it("respinge filename non sicuro (path traversal)", () => {
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "..")).toBeNull();
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "a/b")).toBeNull();
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "")).toBeNull();
  });

  it("respinge filename con path assoluto (es. /etc/passwd)", () => {
    // path.resolve con un path assoluto come 2° arg ignore il primo, ma
    // isSafePathSegment blocca "/" prima ancora di arrivare al resolve.
    expect(risolviPathAllegatoSicuro("cabcdefghij1234567890", "/etc/passwd")).toBeNull();
  });

  it("respinge segnalazioneId con backslash Windows", () => {
    expect(risolviPathAllegatoSicuro("a\\b", "file.jpg")).toBeNull();
  });

  it("UPLOADS_ROOT è un path assoluto sotto <cwd>/storage/uploads", () => {
    expect(path.isAbsolute(UPLOADS_ROOT)).toBe(true);
    expect(UPLOADS_ROOT).toContain("storage");
    expect(UPLOADS_ROOT).toContain("uploads");
  });
});
