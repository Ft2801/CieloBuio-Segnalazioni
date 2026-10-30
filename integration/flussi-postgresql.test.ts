import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/types";

// Solo l'identità HTTP è iniettata. Database, transazioni e file sono reali.
const identita = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async (originale) => ({
  ...(await originale<typeof import("@/lib/auth")>()),
  getSessionUser: async () => identita.user,
}));
let tmp: string;
let db: PrismaClient;
let pratica: Awaited<ReturnType<PrismaClient["segnalazione"]["create"]>>;
let user: Awaited<ReturnType<PrismaClient["user"]["create"]>>;
let upload: typeof import("@/app/api/upload/route");
let allegati: typeof import("@/app/api/allegati/route");
let approva: typeof import("@/app/api/segnalazioni/[id]/approva/route");
let dettaglio: typeof import("@/app/api/segnalazioni/[id]/route");
let auth: typeof import("@/lib/auth");
let totp: typeof import("@/lib/totp-replay");

async function svuota() {
  await db.auditLog.deleteMany();
  await db.logInvioPec.deleteMany();
  await db.storicoStato.deleteMany();
  await db.allegato.deleteMany();
  await db.segnalazione.deleteMany();
  await db.sessione.deleteMany();
  await db.user.deleteMany();
  await db.comune.deleteMany();
  await db.provincia.deleteMany();
  await db.regioneLegge.deleteMany();
}
function richiesta(method: string, url: string, versione?: Date, body?: unknown) {
  const headers = new Headers();
  if (versione) headers.set("If-Match", JSON.stringify(versione.toISOString()));
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function carica(versione?: Date) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "foto.jpg", { type: "image/jpeg" }));
  form.append("segnalazioneId", pratica.id);
  const headers = new Headers();
  if (versione) headers.set("If-Match", JSON.stringify(versione.toISOString()));
  return upload.POST(new NextRequest("http://localhost/api/upload", { method: "POST", headers, body: form }));
}
beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "cb-integration-"));
  process.env.STORAGE_ROOT = path.join(tmp, "uploads");
  const client = await import("@/lib/prisma-client");
  db = client.createPrismaClient();
  await db.$connect();
  upload = await import("@/app/api/upload/route");
  allegati = await import("@/app/api/allegati/route");
  approva = await import("@/app/api/segnalazioni/[id]/approva/route");
  dettaglio = await import("@/app/api/segnalazioni/[id]/route");
  auth = await import("@/lib/auth");
  totp = await import("@/lib/totp-replay");
});
beforeEach(async () => {
  await svuota();
  const regione = await db.regioneLegge.create({
    data: {
      regione: "LOMBARDIA",
      riferimentoLegge: "Legge di collaudo",
      titoloLegge: "Collaudo",
      testoProgettoIlluminotecnico: "",
      testoDeroghe: "",
      testoDatiFotometrici: "",
      testoApprovazione: "",
      testoInstallazione: "",
      testoControllo: "",
      testoSanzioni: "",
      pecArpaRegionale: "arpa@example.test",
    },
  });
  const provincia = await db.provincia.create({ data: { sigla: "BG", nome: "Bergamo", regioneId: regione.id } });
  const comune = await db.comune.create({
    data: { nome: "Comune di collaudo", cap: "24000", pecComune: "comune@example.test", provinciaId: provincia.id },
  });
  user = await db.user.create({
    data: { email: "admin@example.test", nomeCognome: "Admin Collaudo", passwordHash: "hash-collaudo", ruolo: "admin" },
  });
  identita.user = { ...user, ruolo: "admin" };
  pratica = await db.segnalazione.create({
    data: {
      volontarioId: user.id,
      comuneId: comune.id,
      provinciaId: provincia.id,
      regioneId: regione.id,
      indirizzoVia: "Via Collaudo 1",
      stato: "in_revisione",
    },
  });
  const { __resetRateLimitStoreForTests } = await import("@/lib/rate-limit");
  __resetRateLimitStoreForTests();
});
afterAll(async () => {
  if (db) {
    await svuota();
    await db.$disconnect();
  }
  const { db: condiviso } = await import("@/lib/db");
  await condiviso.$disconnect();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("flussi con PostgreSQL e storage reali", () => {
  it("i vincoli territoriali bloccano ricollocazioni collegate e scritture incoerenti", async () => {
    const regione = await db.regioneLegge.findFirstOrThrow();
    const altraRegione = await db.regioneLegge.create({ data: { ...regione, id: undefined, regione: "VENETO" } });
    const altraProvincia = await db.provincia.create({
      data: { sigla: "VR", nome: "Verona", regioneId: altraRegione.id },
    });
    await expect(
      db.segnalazione.update({ where: { id: pratica.id }, data: { provinciaId: altraProvincia.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.comune.update({ where: { id: pratica.comuneId ?? 0 }, data: { provinciaId: altraProvincia.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.provincia.update({ where: { id: pratica.provinciaId ?? 0 }, data: { regioneId: altraRegione.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    expect((await db.segnalazione.findUniqueOrThrow({ where: { id: pratica.id } })).provinciaId).toBe(
      pratica.provinciaId,
    );
  });
  it("creazione di una pratica e ricollocazione del Comune non producono un territorio incoerente", async () => {
    const regione = await db.regioneLegge.findFirstOrThrow();
    const altraProvincia = await db.provincia.create({ data: { sigla: "MI", nome: "Milano", regioneId: regione.id } });
    const comune = await db.comune.create({
      data: {
        nome: "Comune concorrente",
        cap: "24000",
        pecComune: "comune2@example.test",
        provinciaId: pratica.provinciaId ?? 0,
      },
    });
    const risultati = await Promise.allSettled([
      db.segnalazione.create({ data: { ...pratica, id: undefined, comuneId: comune.id } }),
      db.comune.update({ where: { id: comune.id }, data: { provinciaId: altraProvincia.id } }),
    ]);
    expect(risultati.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(risultati.filter((r) => r.status === "rejected")).toHaveLength(1);
    const creata = await db.segnalazione.findFirst({ where: { comuneId: comune.id } });
    const aggiornato = await db.comune.findUniqueOrThrow({ where: { id: comune.id } });
    if (creata) expect(creata.provinciaId).toBe(aggiornato.provinciaId);
  });

  it("download e anteprima rifiutano collegamenti simbolici a file e cartelle", async () => {
    expect((await carica()).status).toBe(201);
    const allegato = await db.allegato.findFirstOrThrow();
    const file = path.join(tmp, "uploads", allegato.urlStorage);
    const fuori = path.join(tmp, "fuori.jpg");
    await rename(file, fuori);
    await symlink(fuori, file);
    const download = await import("@/app/api/allegati/[id]/download/route");
    const preview = await import("@/app/api/allegati/[id]/preview/route");
    for (const route of [download, preview]) {
      expect(
        (
          await route.GET(richiesta("GET", "/api/allegati/test/download"), {
            params: Promise.resolve({ id: allegato.id }),
          })
        ).status,
      ).toBe(404);
    }
    await rm(file);
    await rename(fuori, file);
    const cartella = path.dirname(file);
    const cartellaFuori = path.join(tmp, "cartella-esterna");
    await rename(cartella, cartellaFuori);
    await symlink(cartellaFuori, cartella);
    expect(
      (
        await download.GET(richiesta("GET", "/api/allegati/test/download"), {
          params: Promise.resolve({ id: allegato.id }),
        })
      ).status,
    ).toBe(404);
    await rm(cartella);
    await rename(cartellaFuori, cartella);
  });

  it("l'aggiunta di un allegato invalida la revisione precedente", async () => {
    const res = await carica(pratica.updatedAt);
    expect(res.status).toBe(201);
    const payload = await res.json();
    const corrente = await db.segnalazione.findUniqueOrThrow({ where: { id: pratica.id } });
    expect(corrente.updatedAt.getTime()).toBeGreaterThan(pratica.updatedAt.getTime());
    expect(payload.updatedAt).toBe(corrente.updatedAt.toISOString());
    const vecchia = await approva.POST(richiesta("POST", "/api/approva", pratica.updatedAt), {
      params: Promise.resolve({ id: pratica.id }),
    });
    expect(vecchia.status).toBe(409);
    expect(await db.storicoStato.count()).toBe(0);
    const valida = await approva.POST(richiesta("POST", "/api/approva", corrente.updatedAt), {
      params: Promise.resolve({ id: pratica.id }),
    });
    expect(valida.status).toBe(200);
    expect((await carica()).status).toBe(400);
  });
  it("la rimozione richiede lo snapshot giusto e avanza la versione", async () => {
    const res = await carica(pratica.updatedAt);
    const payload = await res.json();
    const url = `/api/allegati?id=${payload.allegato.id}`;
    expect((await allegati.DELETE(richiesta("DELETE", url, pratica.updatedAt))).status).toBe(409);
    expect(await db.allegato.count()).toBe(1);
    const rimossa = await allegati.DELETE(richiesta("DELETE", url, new Date(payload.updatedAt)));
    expect(rimossa.status).toBe(200);
    expect(new Date((await rimossa.json()).updatedAt).getTime()).toBeGreaterThan(Date.parse(payload.updatedAt));
    expect(await db.allegato.count()).toBe(0);
    expect(await readdir(path.join(tmp, "uploads", pratica.id))).toEqual([]);
  });
  it("sei upload concorrenti non superano quattro allegati e non lasciano file orfani", async () => {
    const risposte = await Promise.all(Array.from({ length: 6 }, () => carica()));
    expect(risposte.filter((r) => r.status === 201)).toHaveLength(4);
    expect(risposte.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await db.allegato.count()).toBe(4);
    expect(await readdir(path.join(tmp, "uploads", pratica.id))).toHaveLength(4);
  });
  it("un upload da una schermata obsoleta non crea record o file", async () => {
    await db.segnalazione.update({
      where: { id: pratica.id },
      data: { updatedAt: new Date(pratica.updatedAt.getTime() + 1) },
    });
    expect((await carica(pratica.updatedAt)).status).toBe(409);
    expect(await db.allegato.count()).toBe(0);
    expect(await readdir(path.join(tmp, "uploads", pratica.id))).toEqual([]);
  });
  it("un errore di storico annulla anche l'approvazione", async () => {
    if (!identita.user) throw new Error("Identità di collaudo assente");
    identita.user = { ...identita.user, id: "utente-non-esistente" };
    const res = await approva.POST(richiesta("POST", "/api/approva", pratica.updatedAt), {
      params: Promise.resolve({ id: pratica.id }),
    });
    expect(res.status).toBe(500);
    expect((await db.segnalazione.findUniqueOrThrow({ where: { id: pratica.id } })).stato).toBe("in_revisione");
    expect(await db.storicoStato.count()).toBe(0);
  });
  it("una PUT da una scheda obsoleta non sovrascrive la modifica presente", async () => {
    await db.segnalazione.update({
      where: { id: pratica.id },
      data: { indirizzoVia: "Via corrente", updatedAt: new Date(pratica.updatedAt.getTime() + 1) },
    });
    const res = await dettaglio.PUT(
      richiesta("PUT", "/api/pratica", pratica.updatedAt, { indirizzoVia: "Via obsoleta" }),
      { params: Promise.resolve({ id: pratica.id }) },
    );
    expect(res.status).toBe(409);
    expect((await db.segnalazione.findUniqueOrThrow({ where: { id: pratica.id } })).indirizzoVia).toBe("Via corrente");
  });
  it("lo stesso codice TOTP è consumato una sola volta con richieste concorrenti", async () => {
    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: "SEGRETO-COLLAUDO", totpVerifiedAt: new Date() },
    });
    const esiti = await Promise.all(
      Array.from({ length: 4 }, () => totp.registraTimestepTotp(user.id, 100, "SEGRETO-COLLAUDO")),
    );
    expect(esiti.filter(Boolean)).toHaveLength(1);
  });
  it("due login concorrenti conservano una sola sessione", async () => {
    const snapshot = {
      passwordHash: user.passwordHash,
      totpSecret: user.totpSecret,
      totpVerifiedAt: user.totpVerifiedAt,
    };
    await Promise.all([auth.createSession(user.id, snapshot), auth.createSession(user.id, snapshot)]);
    expect(await db.sessione.count({ where: { userId: user.id } })).toBe(1);
  });
  it("una password sostituita non autorizza una nuova sessione con lo snapshot precedente", async () => {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: "nuovo-hash" } });
    await expect(
      auth.createSession(user.id, { passwordHash: user.passwordHash, totpSecret: null, totpVerifiedAt: null }),
    ).rejects.toBeInstanceOf(auth.CredenzialiCambiate);
    expect(await db.sessione.count()).toBe(0);
  });
  it("backup e ripristino recuperano database e file, invalidando le sessioni", async () => {
    expect((await carica()).status).toBe(201);
    await auth.createSession(user.id);
    const backup = await import("@/lib/backup");
    const chiave = Buffer.alloc(32, 42);
    const { backupPath } = await backup.eseguiBackup({
      delegati: db as unknown as import("@/lib/backup").DelegatiLettura,
      backupDir: path.join(tmp, "backup"),
      uploadsDir: path.join(tmp, "uploads"),
      chiave,
      ora: new Date(),
      log: () => {},
    });
    await db.segnalazione.update({ where: { id: pratica.id }, data: { indirizzoVia: "Valore temporaneo" } });
    await backup.eseguiRipristino({
      db: db as unknown as import("@/lib/backup").ClientRipristino,
      backupPath,
      uploadsDir: path.join(tmp, "uploads"),
      chiave,
      force: true,
      log: () => {},
    });
    expect((await db.segnalazione.findUniqueOrThrow({ where: { id: pratica.id } })).indirizzoVia).toBe(
      "Via Collaudo 1",
    );
    expect(await db.sessione.count()).toBe(0);
    const file = await db.allegato.findFirstOrThrow();
    expect(await readFile(path.join(tmp, "uploads", file.urlStorage))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });
});
