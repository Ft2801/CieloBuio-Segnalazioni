import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { MAX_ALLEGATO_BYTE } from "@/lib/types";

// Next.js esegue il proxy prima della route: se il suo limite fosse 10 MiB,
// troncherebbe un allegato valido da 10 MiB più l'involucro multipart.
describe("limite del proxy per gli upload", () => {
  it("inoltra l'intero corpo prima che la route applichi il proprio limite", () => {
    const configurato = nextConfig.experimental?.proxyClientMaxBodySize;
    expect(configurato).toBeDefined();
    const megabyte = typeof configurato === "string" ? configurato.match(/^(\d+)mb$/i) : null;
    const limite = typeof configurato === "number" ? configurato : Number(megabyte?.[1]) * 1024 * 1024;
    expect(limite).toBeGreaterThan(MAX_ALLEGATO_BYTE + 64 * 1024);
    expect(limite).toBeLessThanOrEqual(12 * 1024 * 1024);
  });
});
