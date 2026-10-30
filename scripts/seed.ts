/**
 * Script di seed del database con i dati di CONFIGURAZIONE iniziali
 * (regioni e leggi, province, comuni). Non crea alcun utente: per il primo
 * account amministratore usa `scripts/create-admin.ts`, che chiede le
 * credenziali a runtime invece di scriverle in un file del repository.
 *
 * I riferimenti normativi regionali (leggi, articoli) sono informazione
 * pubblica. I comuni sono inseriti senza sindaco e senza PEC: questi dati
 * cambiano nel tempo e vanno inseriti e verificati dall'amministratore
 * dal pannello di configurazione. Finché la PEC non è inserita, l'invio
 * al Comune resta bloccato.
 *
 * Autore: Fabio Tempera (2026)
 */

import "./load-env";
import { Prisma } from "@prisma/client";
import { createPrismaClient } from "../src/lib/prisma-client";

const prisma = createPrismaClient();
const AGGIORNA_NORMATIVA = process.argv.includes("--aggiorna-normativa");

function isViolazioneUnicita(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Crea un record; se esiste già (vincolo univoco) restituisce quello presente.
 * Così il seed può essere rieseguito senza errori.
 */
async function creaOTrova<T extends { id: number }>(
  crea: () => Promise<T>,
  trova: () => Promise<T | null>,
): Promise<T> {
  try {
    return await crea();
  } catch (e) {
    if (isViolazioneUnicita(e)) {
      const esistente = await trova();
      if (esistente) return esistente;
    }
    throw e;
  }
}

/** Campi normativi di una regione: il seed li confronta con quelli già presenti. */
const CAMPI_NORMATIVI = [
  "riferimentoLegge",
  "titoloLegge",
  "testoProgettoIlluminotecnico",
  "testoDeroghe",
  "testoDatiFotometrici",
  "testoApprovazione",
  "testoInstallazione",
  "testoControllo",
  "testoSanzioni",
  "pecArpaRegionale",
] as const;

type DatiRegione = {
  regione: string;
  riferimentoLegge: string;
  titoloLegge: string;
  testoProgettoIlluminotecnico: string;
  testoDeroghe: string;
  testoDatiFotometrici: string;
  testoApprovazione: string;
  testoInstallazione: string;
  testoControllo: string;
  testoSanzioni: string;
  pecArpaRegionale: string;
};

/**
 * Crea la regione se manca. Se esiste, confronta i campi normativi: con il
 * flag --aggiorna-normativa li allinea ai dati del seed; senza il flag lascia
 * il record invariato (le modifiche fatte dal pannello admin non vengono
 * sovrascritte) e segnala le differenze.
 */
async function regioneConDati(dati: DatiRegione): Promise<{ id: number }> {
  const esistente = await prisma.regioneLegge.findUnique({ where: { regione: dati.regione } });
  if (!esistente) {
    return prisma.regioneLegge.create({ data: dati });
  }
  const differenze = CAMPI_NORMATIVI.filter((campo) => esistente[campo] !== dati[campo]);
  if (differenze.length === 0) return esistente;
  if (AGGIORNA_NORMATIVA) {
    console.log(`${dati.regione}: aggiornati i campi ${differenze.join(", ")}`);
    return prisma.regioneLegge.update({ where: { id: esistente.id }, data: dati });
  }
  console.warn(
    `${dati.regione}: campi diversi dal seed (${differenze.join(", ")}). ` +
      "Eseguire con --aggiorna-normativa per allinearli.",
  );
  return esistente;
}

/** Per i comuni: un duplicato già presente viene saltato, ogni altro errore si propaga. */
function ignoraSeDuplicato(e: unknown): void {
  if (!isViolazioneUnicita(e)) throw e;
}

/** Restituisce l'id di una provincia già caricata; errore esplicito se manca. */
async function provinciaIdPerSigla(sigla: string): Promise<number> {
  const provincia = await prisma.provincia.findUnique({ where: { sigla } });
  if (!provincia) {
    throw new Error(`Provincia ${sigla} non trovata: caricare prima le province di riferimento`);
  }
  return provincia.id;
}

async function main() {
  console.log("Inizio seed del database...");

  // -----------------------------------------------------------------------
  // Regioni con le relative leggi di riferimento
  // -----------------------------------------------------------------------
  const lombardia = await regioneConDati({
    regione: "LOMBARDIA",
    riferimentoLegge:
      "Legge Regionale della Lombardia n.31/2015 (art. 11, comma 2: disposizioni transitorie della L.R. 17/2000)",
    titoloLegge:
      "Misure di efficientamento dei sistemi di illuminazione esterna con finalità di risparmio energetico e di riduzione dell'inquinamento luminoso",
    testoProgettoIlluminotecnico: "art. 4, comma 2, del regolamento regionale",
    testoDeroghe: "art. 3, comma 1, lettere b e c",
    testoDatiFotometrici: "art. 4, comma 2, del regolamento regionale",
    testoApprovazione: "art. 6, comma 1",
    testoInstallazione: "art. 4, comma 2, del regolamento regionale",
    testoControllo: "art. 6, comma 3",
    testoSanzioni: "art. 10",
    pecArpaRegionale: "arpa@pec.regione.lombardia.it",
  });

  const veneto = await regioneConDati({
    regione: "VENETO",
    riferimentoLegge: "Legge Regionale del Veneto n.17/09",
    titoloLegge:
      "Nuove norme per il contenimento dell'inquinamento luminoso, il risparmio energetico nell'illuminazione per esterni e per la tutela dell'ambiente e dell'attività svolta dagli osservatori astronomici",
    testoProgettoIlluminotecnico: "art. 7",
    testoDeroghe: "art. 9, comma 4",
    testoDatiFotometrici: "art. 7, comma 4",
    testoApprovazione: "art. 5, comma 1, lettera c",
    testoInstallazione: "art. 9, comma 2",
    testoControllo: "art. 5, comma 1, lettera d",
    testoSanzioni: "art. 11",
    pecArpaRegionale: "protocollo@pec.arpav.it",
  });

  const piemonte = await regioneConDati({
    regione: "PIEMONTE",
    riferimentoLegge: "Legge Regionale del Piemonte n.31/00, modificata dalla L.R. n.3/18",
    titoloLegge:
      "Disposizioni per la prevenzione e lotta all'inquinamento luminoso e per il corretto impiego delle risorse energetiche",
    testoProgettoIlluminotecnico: "art. 3, comma 2",
    testoDeroghe: "art. 7, comma 1",
    testoDatiFotometrici: "art. 3, comma 1 e allegato A",
    testoApprovazione: "art. 6, comma 2",
    testoInstallazione: "art. 3, comma 2",
    testoControllo: "art. 6, comma 3",
    testoSanzioni: "art. 9, comma 3",
    pecArpaRegionale: "protocollo@pec.arpa.piemonte.it",
  });

  const trentino = await regioneConDati({
    regione: "TRENTINO",
    riferimentoLegge: "Legge Provinciale di Trento n.16/07",
    titoloLegge: "Disposizioni in materia di risparmio energetico e inquinamento luminoso",
    testoProgettoIlluminotecnico: "art. 4, comma 2, lettera f",
    testoDeroghe: "art. 4, comma 2, lettera f",
    testoDatiFotometrici: "art. 4, comma 3, lettera b",
    testoApprovazione: "art. 2, comma 1, lettera d",
    testoInstallazione: "art. 4, comma 2, lettera f",
    testoControllo: "art. 3, comma 1, lettera f",
    testoSanzioni: "art. 6",
    pecArpaRegionale: "appa@pec.provincia.tn.it",
  });

  // -----------------------------------------------------------------------
  // Province
  // -----------------------------------------------------------------------
  const provinciaBG = await creaOTrova(
    () =>
      prisma.provincia.create({
        data: {
          sigla: "BG",
          nome: "Bergamo",
          regioneId: lombardia.id,
          pecArpaProvinciale: "dipartimentobergamo.arpa@pec.regione.lombardia.it",
        },
      }),
    async () => {
      // La sigla è l'unica chiave univoca di province: un record esistente con
      // la stessa sigla ma collegato ad altra regione non va riutilizzato in silenzio.
      const esistente = await prisma.provincia.findUnique({ where: { sigla: "BG" } });
      if (esistente && esistente.regioneId !== lombardia.id) {
        throw new Error(
          `Provincia BG già presente ma collegata alla regione ${esistente.regioneId} (attesa ${lombardia.id}): verificare il database.`,
        );
      }
      return esistente;
    },
  );

  await prisma.provincia
    .create({
      data: {
        sigla: "MI",
        nome: "Milano",
        regioneId: lombardia.id,
      },
    })
    .catch(ignoraSeDuplicato);

  await prisma.provincia
    .create({
      data: {
        sigla: "BS",
        nome: "Brescia",
        regioneId: lombardia.id,
      },
    })
    .catch(ignoraSeDuplicato);

  await prisma.provincia
    .create({
      data: {
        sigla: "TV",
        nome: "Treviso",
        regioneId: veneto.id,
      },
    })
    .catch(ignoraSeDuplicato);

  await prisma.provincia
    .create({
      data: {
        sigla: "TO",
        nome: "Torino",
        regioneId: piemonte.id,
      },
    })
    .catch(ignoraSeDuplicato);

  await prisma.provincia
    .create({
      data: {
        sigla: "TN",
        nome: "Trento",
        regioneId: trentino.id,
      },
    })
    .catch(ignoraSeDuplicato);

  // -----------------------------------------------------------------------
  // Comuni
  //
  // Sindaco e PEC non sono inseriti: sono dati reali che
  // l'amministratore completa dal pannello di configurazione. Fino ad allora
  // il comune risulta "da verificare" e l'invio della PEC non parte.
  // -----------------------------------------------------------------------
  const comuni = [
    {
      nome: "Verdello",
      provinciaId: provinciaBG.id,
      cap: "24049",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Bergamo",
      provinciaId: provinciaBG.id,
      cap: "24121",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Milano",
      provinciaId: await provinciaIdPerSigla("MI"),
      cap: "20121",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Brescia",
      provinciaId: await provinciaIdPerSigla("BS"),
      cap: "25121",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Treviso",
      provinciaId: await provinciaIdPerSigla("TV"),
      cap: "31100",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Torino",
      provinciaId: await provinciaIdPerSigla("TO"),
      cap: "10121",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
    {
      nome: "Trento",
      provinciaId: await provinciaIdPerSigla("TN"),
      cap: "38121",
      pecComune: "",
      nomeSindaco: null,
      noteAggiornamento: null,
    },
  ];

  for (const c of comuni) {
    await prisma.comune.create({ data: c }).catch(ignoraSeDuplicato);
  }

  console.log("Seed dei dati di configurazione completato.");
  console.log("");
  console.log("Nota: questo script NON crea alcun utente. Per creare il primo");
  console.log("account amministratore reale esegui:");
  console.log("");
  console.log("    npm run db:create-admin");
  console.log("");
  console.log("(oppure npx tsx scripts/create-admin.ts). Lo script");
  console.log("chiede email, nome e password a runtime: nessuna credenziale reale");
  console.log("resta scritta nei file del repository.");
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error("Errore durante il seed:", e);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

run();
