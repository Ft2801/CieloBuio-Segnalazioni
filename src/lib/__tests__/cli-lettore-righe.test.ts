/**
 * Copertura del lettore di righe per gli script di amministrazione
 * (creaLettoreRighe in cli-io.ts). Usa stream reali, senza mock.
 */
import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { creaLettoreRighe, MESSAGGIO_INPUT_TERMINATO } from "@/lib/cli-io";

function uscitaFinta() {
  const raccolto: string[] = [];
  const uscita = new Writable({
    write(blocco, _codifica, fine) {
      raccolto.push(blocco.toString());
      fine();
    },
  });
  return { uscita, testo: () => raccolto.join("") };
}

/** Attende un giro di eventi, così readline elabora i dati già scritti sullo stream. */
const attesaEventi = () => new Promise((risolvi) => setTimeout(risolvi, 10));

describe("creaLettoreRighe", () => {
  it("restituisce in ordine tutte le righe ricevute insieme (input in pipe)", async () => {
    // Regressione: con readline/promises la seconda e la terza risposta andavano perse.
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    input.end("mario@esempio.it\nMario Rossi\nvolontario\n");
    await expect(lettore.leggiRiga("Email: ")).resolves.toBe("mario@esempio.it");
    await expect(lettore.leggiRiga("Nome: ")).resolves.toBe("Mario Rossi");
    await expect(lettore.leggiRiga("Ruolo: ")).resolves.toBe("volontario");
    lettore.chiudiInterfaccia();
  });

  it("mostra la domanda anche quando la risposta è già in coda", async () => {
    const input = new PassThrough();
    const { uscita, testo } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    input.write("uno\ndue\n");
    await expect(lettore.leggiRiga("Primo: ")).resolves.toBe("uno");
    await attesaEventi();
    await expect(lettore.leggiRiga("Secondo: ")).resolves.toBe("due");
    expect(testo()).toContain("Secondo: \n");
    lettore.chiudiInterfaccia();
  });

  it("riceve righe arrivate dopo la domanda", async () => {
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    const risposta = lettore.leggiRiga("Email: ");
    setTimeout(() => input.write("ritardo@esempio.it\n"), 5);
    await expect(risposta).resolves.toBe("ritardo@esempio.it");
    lettore.chiudiInterfaccia();
  });

  it("rifiuta con un errore esplicito quando l'input termina prima della risposta", async () => {
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    const risposta = lettore.leggiRiga("Email: ");
    input.end();
    await expect(risposta).rejects.toThrow(MESSAGGIO_INPUT_TERMINATO);
    await expect(lettore.leggiRiga("Nome: ")).rejects.toThrow(MESSAGGIO_INPUT_TERMINATO);
  });

  it("rifiuta le domande successive alla fine dell'input senza righe in coda", async () => {
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    input.end("solo\n");
    await expect(lettore.leggiRiga("Unica: ")).resolves.toBe("solo");
    await attesaEventi();
    await expect(lettore.leggiRiga("Altra: ")).rejects.toThrow(MESSAGGIO_INPUT_TERMINATO);
  });

  it("chiudere l'interfaccia non segnala la fine dell'input: la lettura riprende", async () => {
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    input.write("prima\n");
    await expect(lettore.leggiRiga("Una: ")).resolves.toBe("prima");
    lettore.chiudiInterfaccia();
    await attesaEventi();
    const seconda = lettore.leggiRiga("Due: ");
    input.write("dopo\n");
    await expect(seconda).resolves.toBe("dopo");
    lettore.chiudiInterfaccia();
  });

  it("chiudere senza interfaccia attiva non ha effetti", () => {
    const input = new PassThrough();
    const { uscita } = uscitaFinta();
    const lettore = creaLettoreRighe(input, uscita);
    expect(() => lettore.chiudiInterfaccia()).not.toThrow();
    expect(() => lettore.chiudiInterfaccia()).not.toThrow();
  });
});
