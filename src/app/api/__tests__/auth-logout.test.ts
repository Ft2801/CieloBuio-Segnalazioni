/**
 * Test di integrazione per /api/auth/logout
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sessione: {
      deleteMany: vi.fn(),
    },
  },
}));

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chiama deleteMany e ritorna ok se token presente", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as never);
    vi.mocked(db.sessione.deleteMany).mockResolvedValue({ count: 1 } as never);
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(db.sessione.deleteMany).toHaveBeenCalledWith({
      where: { token: createHash("sha256").update("tok").digest("hex") },
    });
  });

  it("ritorna ok anche senza token (no-op)", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(db.sessione.deleteMany).not.toHaveBeenCalled();
  });

  it("ritorna ok anche se deleteMany fallisce (catch best-effort)", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "tok" }) } as never);
    vi.mocked(db.sessione.deleteMany).mockRejectedValue(new Error("DB error"));
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
