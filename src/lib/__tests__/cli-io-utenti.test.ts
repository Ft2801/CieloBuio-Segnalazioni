/**
 * Copertura di cli-io (password nascosta, scelta della modalità di input) e
 * di cli-utenti (procedura di creazione utente con dipendenze finte).
 */
import { describe, it, expect, vi } from "vitest";
import { leggiPasswordNascosta, chiediPassword, InterruzioneUtente, type FlussoTerminale } from "@/lib/cli-io";
import { creaUtente, MAX_TENTATIVI_PASSWORD, type IoCreazione } from "@/lib/cli-utenti";

// -----------------------------------------------------------------------------
// Terminale finto: i blocchi di input si inviano con emit().
// -----------------------------------------------------------------------------
function terminaleFinto(opzioni: { conRawMode?: boolean } = {}) {
  const ascoltatori: ((blocco: string) => void)[] = [];
  const terminale: FlussoTerminale & { emit: (blocco: string) => void; ascoltatori: typeof ascoltatori } = {
    isTTY: true,
    setRawMode: opzioni.conRawMode === false ? undefined : vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    setEncoding: vi.fn(),
    on: vi.fn((_evento: "data", ascolto: (blocco: string) => void) => {
      ascoltatori.push(ascolto);
    }),
    removeListener: vi.fn((_evento: "data", ascolto: (blocco: string) => void) => {
      const indice = ascoltatori.indexOf(ascolto);
      if (indice >= 0) ascoltatori.splice(indice, 1);
    }),
    emit: (blocco: string) => {
      [...ascoltatori].forEach((a) => a(blocco));
    },
    ascoltatori,
  };
  return terminale;
}

function uscitaFinta() {
  const scritti: string[] = [];
  return { scritti, write: (testo: string) => scritti.push(testo) };
}

describe("leggiPasswordNascosta", () => {
  it("un invio conserva gli spazi della password e ripristina il terminale", async () => {
    const term = terminaleFinto();
    const out = uscitaFinta();
    const attesa = leggiPasswordNascosta(term, out, "Password: ");
    term.emit("  CieloBuio!2026  \n");
    await expect(attesa).resolves.toBe("  CieloBuio!2026  ");
    expect(out.scritti).toEqual(["Password: ", "\n"]);
    expect(term.setRawMode).toHaveBeenLastCalledWith(false);
    expect(term.pause).toHaveBeenCalled();
    expect(term.ascoltatori).toHaveLength(0);
  });

  it("il ritorno a capo di Windows (\\r) conferma allo stesso modo", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("ab\r");
    await expect(attesa).resolves.toBe("ab");
  });

  it("Ctrl+D conferma la password inserita", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("abc\x04");
    await expect(attesa).resolves.toBe("abc");
  });

  it("Backspace (DEL e BS) cancella l'ultimo carattere", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("ab\x7fc\x08d\n");
    await expect(attesa).resolves.toBe("ad");
  });

  it("Backspace su input vuoto non produce errori", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("\x7f\x08x\n");
    await expect(attesa).resolves.toBe("x");
  });

  it("un blocco con più caratteri elabora solo fino al primo invio", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("pw\nignorato");
    await expect(attesa).resolves.toBe("pw");
  });

  it("Ctrl+C annulla la lettura e ripristina il terminale", async () => {
    const term = terminaleFinto();
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("ab\x03");
    await expect(attesa).rejects.toBeInstanceOf(InterruzioneUtente);
    expect(term.setRawMode).toHaveBeenLastCalledWith(false);
    expect(term.ascoltatori).toHaveLength(0);
  });

  it("funziona anche senza setRawMode (flusso non TTY reale)", async () => {
    const term = terminaleFinto({ conRawMode: false });
    const attesa = leggiPasswordNascosta(term, uscitaFinta(), "P: ");
    term.emit("xy\n");
    await expect(attesa).resolves.toBe("xy");
  });
});

describe("InterruzioneUtente", () => {
  it("ha un messaggio e un nome riconoscibili", () => {
    const errore = new InterruzioneUtente();
    expect(errore.name).toBe("InterruzioneUtente");
    expect(errore.message).toContain("annullata");
  });
});

describe("chiediPassword", () => {
  it("con terminale usa la lettura nascosta", async () => {
    const term = terminaleFinto();
    const attesa = chiediPassword({
      domanda: "Password: ",
      input: term,
      output: uscitaFinta(),
      env: {},
      leggiRiga: vi.fn(),
    });
    term.emit("segreta\n");
    await expect(attesa).resolves.toBe("segreta");
  });

  it("senza terminale usa ADMIN_PASSWORD per le domande sulla password", async () => {
    const leggiRiga = vi.fn();
    await expect(
      chiediPassword({
        domanda: "Conferma password: ",
        input: { isTTY: false } as FlussoTerminale,
        output: uscitaFinta(),
        env: { ADMIN_PASSWORD: "DaAmbiente1!" },
        leggiRiga,
      }),
    ).resolves.toBe("DaAmbiente1!");
    expect(leggiRiga).not.toHaveBeenCalled();
  });

  it("senza terminale ignora ADMIN_PASSWORD per domande che non riguardano la password", async () => {
    const leggiRiga = vi.fn().mockResolvedValue("  risposta  ");
    await expect(
      chiediPassword({
        domanda: "Nome: ",
        input: { isTTY: false } as FlussoTerminale,
        output: uscitaFinta(),
        env: { ADMIN_PASSWORD: "DaAmbiente1!" },
        leggiRiga,
      }),
    ).resolves.toBe("  risposta  ");
  });

  it("senza terminale e senza ADMIN_PASSWORD legge una riga normale", async () => {
    const leggiRiga = vi.fn().mockResolvedValue(" manuale ");
    await expect(
      chiediPassword({
        domanda: "Password: ",
        input: { isTTY: false } as FlussoTerminale,
        output: uscitaFinta(),
        env: {},
        leggiRiga,
      }),
    ).resolves.toBe(" manuale ");
  });
});

// -----------------------------------------------------------------------------
// creaUtente
// -----------------------------------------------------------------------------
const PASSWORD_VALIDA = "CieloBuio!2026";

function ioScriptato(risposte: string[], password: string[]) {
  const scritti: string[] = [];
  const errori: string[] = [];
  const domande: string[] = [];
  const io: IoCreazione = {
    chiedi: async (domanda: string) => {
      domande.push(domanda);
      return risposte.shift() ?? "";
    },
    chiediPassword: async (domanda: string) => {
      domande.push(domanda);
      return password.shift() ?? "";
    },
    scrivi: (m) => scritti.push(m),
    errore: (m) => errori.push(m),
  };
  return { io, scritti, errori, domande };
}

function prismaFinto(
  opzioni: {
    utenteEsistente?: { ruolo: string } | null;
    provincia?: { id: number } | null;
    regione?: { id: number } | null;
    creaRifiuta?: boolean;
  } = {},
) {
  const create = opzioni.creaRifiuta
    ? vi.fn().mockRejectedValue(new Error("vincolo violato"))
    : vi.fn().mockResolvedValue({ id: "u-nuovo", email: "mario@esempio.it", ruolo: "volontario" });
  return {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue(opzioni.utenteEsistente ?? null),
        create,
      },
      provincia: { findUnique: vi.fn().mockResolvedValue(opzioni.provincia ?? null) },
      regioneLegge: { findUnique: vi.fn().mockResolvedValue(opzioni.regione ?? null) },
    },
    create,
  };
}

const hashFinto = vi.fn(async (p: string) => `hash:${p}`);

describe("creaUtente - percorso completo", () => {
  it("crea un admin con ruolo predefinito e iniziali valide", async () => {
    const { io, scritti } = ioScriptato(
      ["mario@esempio.it", "Mario Rossi", "", "ab"],
      [PASSWORD_VALIDA, PASSWORD_VALIDA],
    );
    const { prisma, create } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(0);
    expect(hashFinto).toHaveBeenCalledWith(PASSWORD_VALIDA, 12);
    expect(create).toHaveBeenCalledWith({
      data: {
        email: "mario@esempio.it",
        nomeCognome: "Mario Rossi",
        passwordHash: `hash:${PASSWORD_VALIDA}`,
        ruolo: "admin",
        provinciaId: null,
        regioneId: null,
        inizialiProtocollo: "AB",
      },
    });
    expect(scritti.some((m) => m.includes("Utente creato"))).toBe(true);
  });

  it("le iniziali più lunghe di due caratteri vengono rifiutate, non troncate", async () => {
    const { io, scritti } = ioScriptato(["m@e.it", "M", "volontario", "xyz", "XY"], [PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma, create } = prismaFinto();
    await creaUtente(io, { prisma: prisma as never, hash: hashFinto });
    expect(scritti.some((m) => m.includes("esattamente 2 lettere"))).toBe(true);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { ruolo: "volontario", inizialiProtocollo: "XY" },
    });
  });

  it("senza iniziali il campo resta vuoto", async () => {
    const { io } = ioScriptato(["m@e.it", "M", "volontario", ""], [PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma, create } = prismaFinto();
    await creaUtente(io, { prisma: prisma as never, hash: hashFinto });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { inizialiProtocollo: null } });
  });

  it("referente provinciale: collega la provincia trovata", async () => {
    const { io } = ioScriptato(["m@e.it", "M", "referente_provinciale", "bg", ""], [PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma, create } = prismaFinto({ provincia: { id: 16 } });
    await creaUtente(io, { prisma: prisma as never, hash: hashFinto });
    expect(prisma.provincia.findUnique).toHaveBeenCalledWith({ where: { sigla: "BG" } });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { provinciaId: 16, regioneId: null } });
  });

  it("referente regionale: collega la regione trovata", async () => {
    const { io } = ioScriptato(
      ["m@e.it", "M", "referente_regionale", "lombardia", ""],
      [PASSWORD_VALIDA, PASSWORD_VALIDA],
    );
    const { prisma, create } = prismaFinto({ regione: { id: 3 } });
    await creaUtente(io, { prisma: prisma as never, hash: hashFinto });
    expect(prisma.regioneLegge.findUnique).toHaveBeenCalledWith({ where: { regione: "LOMBARDIA" } });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { regioneId: 3, provinciaId: null } });
  });

  it("le iniziali non valide vengono rifiutate finché l'input non è corretto", async () => {
    const { io, scritti } = ioScriptato(["m@e.it", "M", "volontario", "1X", "ZZ"], [PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma, create } = prismaFinto();
    await creaUtente(io, { prisma: prisma as never, hash: hashFinto });
    expect(scritti.some((m) => m.includes("esattamente 2 lettere"))).toBe(true);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { inizialiProtocollo: "ZZ" } });
  });

  it("una password non valida viene richiesta di nuovo", async () => {
    const { io, scritti } = ioScriptato(["m@e.it", "M", "volontario", ""], ["corta", PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(0);
    expect(scritti.some((m) => m.startsWith("Password non valida:"))).toBe(true);
  });
});

describe("creaUtente - errori di validazione", () => {
  it("email non valida interrompe con codice 1", async () => {
    const { io, errori } = ioScriptato(["non-una-email"], []);
    const { prisma, create } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain("Email non valida");
    expect(create).not.toHaveBeenCalled();
  });

  it("email già registrata interrompe con il ruolo attuale", async () => {
    const { io, errori } = ioScriptato(["m@e.it"], []);
    const { prisma } = prismaFinto({ utenteEsistente: { ruolo: "admin" } });
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain("ruolo attuale: admin");
  });

  it("nome vuoto interrompe", async () => {
    const { io, errori } = ioScriptato(["m@e.it", ""], []);
    const { prisma } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain("obbligatorio");
  });

  it("ruolo sconosciuto interrompe con l'elenco dei valori ammessi", async () => {
    const { io, errori } = ioScriptato(["m@e.it", "M", "superuser"], []);
    const { prisma } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain("Valori ammessi");
  });

  it("provincia inesistente interrompe", async () => {
    const { io, errori } = ioScriptato(["m@e.it", "M", "referente_provinciale", "XX"], []);
    const { prisma, create } = prismaFinto({ provincia: null });
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain('Provincia "XX" non trovata');
    expect(create).not.toHaveBeenCalled();
  });

  it("regione inesistente interrompe", async () => {
    const { io, errori } = ioScriptato(["m@e.it", "M", "referente_regionale", "Atlantide"], []);
    const { prisma } = prismaFinto({ regione: null });
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain('Regione "Atlantide" non trovata');
  });

  it("dopo il numero massimo di password non valide l'operazione è annullata", async () => {
    const tentativi = Array.from({ length: MAX_TENTATIVI_PASSWORD }, () => "corta");
    const { io, errori, domande } = ioScriptato(["m@e.it", "M", "volontario", ""], tentativi);
    const { prisma, create } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain(`dopo ${MAX_TENTATIVI_PASSWORD} tentativi`);
    expect(domande.filter((d) => d.startsWith("Password (")).length).toBe(MAX_TENTATIVI_PASSWORD);
    expect(create).not.toHaveBeenCalled();
  });

  it("password di conferma diversa interrompe senza creare l'utente", async () => {
    const { io, errori } = ioScriptato(["m@e.it", "M", "volontario", ""], [PASSWORD_VALIDA, "Altra!Password9"]);
    const { prisma, create } = prismaFinto();
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).resolves.toBe(1);
    expect(errori[0]).toContain("non coincidono");
    expect(create).not.toHaveBeenCalled();
  });

  it("un errore del database si propaga al chiamante", async () => {
    const { io } = ioScriptato(["m@e.it", "M", "volontario", ""], [PASSWORD_VALIDA, PASSWORD_VALIDA]);
    const { prisma } = prismaFinto({ creaRifiuta: true });
    await expect(creaUtente(io, { prisma: prisma as never, hash: hashFinto })).rejects.toThrow("vincolo violato");
  });
});
