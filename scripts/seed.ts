/**
 * Script di seed del database con dati di CONFIGURAZIONE di esempio
 * (regioni/leggi, province, comuni). Non crea alcun utente: per il primo
 * account amministratore usa `scripts/create-admin.ts`, che chiede le
 * credenziali a runtime invece di scriverle in un file del repository.
 *
 * I riferimenti normativi regionali (leggi, articoli) sono informazione
 * pubblica reale, utile come base di partenza da poi mantenere aggiornata
 * dal pannello di amministrazione. I dati dei singoli comuni (nome del
 * sindaco, PEC) sono invece PLACEHOLDER di esempio, non reali: cambiano
 * spesso e vanno inseriti e verificati dall'amministratore dell'istanza.
 *
 * Autore: Fabio Tempera (2026)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Inizio seed del database...");

  // -----------------------------------------------------------------------
  // Regioni con relative leggi (dati reali estratti dal sistema Excel)
  // -----------------------------------------------------------------------
  const lombardia = await prisma.regioneLegge.create({
    data: {
      regione: "LOMBARDIA",
      riferimentoLegge:
        "Legge Regionale della Lombardia n.31/15 (e L.R.17/00)",
      titoloLegge:
        "Disposizioni per l'adempimento degli obblighi comunitari e regionali in materia ambientale - Misure per il contenimento dell'inquinamento luminoso e per il risparmio energetico nell'illuminazione per uso pubblico e privato",
      testoProgettoIlluminotecnico: "art. 5, comma 1, lettera a)",
      testoDeroghe: "art. 5, comma 4",
      testoDatiFotometrici: "art. 5, comma 1, lettera b)",
      testoApprovazione: "art. 6",
      testoInstallazione: "art. 7",
      testoControllo: "art. 10",
      testoSanzioni: "art. 13",
      pecArpaRegionale: "arpa.lombardia@pec.regione.lombardia.it",
    },
  });

  const veneto = await prisma.regioneLegge.create({
    data: {
      regione: "VENETO",
      riferimentoLegge: "Legge Regionale del Veneto n.10/05",
      titoloLegge:
        "Disposizioni per il contenimento dell'inquinamento luminoso e per il risparmio energetico nell'illuminazione per uso pubblico e privato",
      testoProgettoIlluminotecnico: "art. 4, comma 1",
      testoDeroghe: "art. 4, comma 5",
      testoDatiFotometrici: "art. 4, comma 2",
      testoApprovazione: "art. 5",
      testoInstallazione: "art. 6",
      testoControllo: "art. 9",
      testoSanzioni: "art. 11",
      pecArpaRegionale: "arpa.veneto@pec.veneto.it",
    },
  });

  const piemonte = await prisma.regioneLegge.create({
    data: {
      regione: "PIEMONTE",
      riferimentoLegge: "Legge Regionale del Piemonte n.13/10",
      titoloLegge:
        "Disposizioni per la tutela dell'ambiente per quanto riguarda l'inquinamento luminoso e l'uso razionale dell'energia per l'illuminazione ad uso pubblico e privato",
      testoProgettoIlluminotecnico: "art. 5",
      testoDeroghe: "art. 5, comma 4",
      testoDatiFotometrici: "art. 5, comma 2",
      testoApprovazione: "art. 6",
      testoInstallazione: "art. 7",
      testoControllo: "art. 10",
      testoSanzioni: "art. 14",
      pecArpaRegionale: "arpa.piemonte@pec.piemonte.it",
    },
  });

  const trentino = await prisma.regioneLegge.create({
    data: {
      regione: "TRENTINO",
      riferimentoLegge: "Legge Provinciale di Trento n.11/06",
      titoloLegge:
        "Disposizioni per il contenimento dell'inquinamento luminoso e per il risparmio energetico nell'illuminazione per uso pubblico e privato",
      testoProgettoIlluminotecnico: "art. 4",
      testoDeroghe: "art. 4, comma 5",
      testoDatiFotometrici: "art. 4, comma 2",
      testoApprovazione: "art. 5",
      testoInstallazione: "art. 6",
      testoControllo: "art. 9",
      testoSanzioni: "art. 11",
      pecArpaRegionale: "arpa.provincia.tn@pec.provincia.tn.it",
    },
  });

  // -----------------------------------------------------------------------
  // Province
  // -----------------------------------------------------------------------
  const provinciaBG = await prisma.provincia.create({
    data: {
      sigla: "BG",
      nome: "Bergamo",
      regioneId: lombardia.id,
      pecArpaProvinciale: "arpa.bg@pec.regione.lombardia.it",
    },
  });

  await prisma.provincia.create({
    data: {
      sigla: "MI",
      nome: "Milano",
      regioneId: lombardia.id,
    },
  });

  await prisma.provincia.create({
    data: {
      sigla: "BS",
      nome: "Brescia",
      regioneId: lombardia.id,
    },
  });

  await prisma.provincia.create({
    data: {
      sigla: "TV",
      nome: "Treviso",
      regioneId: veneto.id,
    },
  });

  await prisma.provincia.create({
    data: {
      sigla: "TO",
      nome: "Torino",
      regioneId: piemonte.id,
    },
  });

  await prisma.provincia.create({
    data: {
      sigla: "TN",
      nome: "Trento",
      regioneId: trentino.id,
    },
  });

  // -----------------------------------------------------------------------
  // Comuni
  //
  // Nota produzione: i nomi dei sindaci qui sotto sono PLACEHOLDER di
  // esempio ("Nome Cognome"), non persone reali. I dati veri (sindaco in
  // carica, indirizzo PEC del Comune) cambiano nel tempo e vanno inseriti
  // e tenuti aggiornati dall'amministratore tramite il pannello di
  // configurazione dell'app, non hardcoded in uno script di seed pubblico.
  //
  // `pecComune` usa un placeholder ovviamente invalido
  // "PEC-DA-CONFIGURARE@comune-<NOME>.it" che non verrebbe mai accettato
  // da un SMTP reale, segnalando visivamente che il dato non è stato
  // configurato. `noteAggiornamento` è la data di esecuzione del seed
  // (data ISO valida), così il check "entro 6 mesi" del pannello admin
  // scatta correttamente dopo 6 mesi dal seed.
  // -----------------------------------------------------------------------
  const dataSeed = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const comuni = [
    {
      nome: "Verdello",
      provinciaId: provinciaBG.id,
      cap: "24040",
      pecComune: "PEC-DA-CONFIGURARE@comune-Verdello.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Bergamo",
      provinciaId: provinciaBG.id,
      cap: "24121",
      pecComune: "PEC-DA-CONFIGURARE@comune-Bergamo.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Milano",
      provinciaId: (await prisma.provincia.findUnique({ where: { sigla: "MI" } }))!.id,
      cap: "20121",
      pecComune: "PEC-DA-CONFIGURARE@comune-Milano.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Brescia",
      provinciaId: (await prisma.provincia.findUnique({ where: { sigla: "BS" } }))!.id,
      cap: "25121",
      pecComune: "PEC-DA-CONFIGURARE@comune-Brescia.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Treviso",
      provinciaId: (await prisma.provincia.findUnique({ where: { sigla: "TV" } }))!.id,
      cap: "31100",
      pecComune: "PEC-DA-CONFIGURARE@comune-Treviso.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Torino",
      provinciaId: (await prisma.provincia.findUnique({ where: { sigla: "TO" } }))!.id,
      cap: "10121",
      pecComune: "PEC-DA-CONFIGURARE@comune-Torino.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
    {
      nome: "Trento",
      provinciaId: (await prisma.provincia.findUnique({ where: { sigla: "TN" } }))!.id,
      cap: "38121",
      pecComune: "PEC-DA-CONFIGURARE@comune-Trento.it",
      nomeSindaco: "Nome Cognome",
      noteAggiornamento: dataSeed,
    },
  ];

  for (const c of comuni) {
    await prisma.comune.create({ data: c });
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

main()
  .catch((e) => {
    console.error("Errore durante il seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
