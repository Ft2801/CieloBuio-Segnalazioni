/**
 * Motore di generazione della lettera PEC da template con segnaposto.
 *
 * Il testo normativo NON è mai hard-coded qui: viene letto dalle tabelle
 * regioni_leggi / comuni / province (sezione 10 specifiche).
 *
 * Il template segue la struttura della lettera reale già in uso
 * (file MODULO.docx / MODULO-ARPA.docx), con i segnaposto tra parentesi quadre.
 *
 * Autore: Fabio Tempera (2026)
 */

import { db } from "@/lib/db";

export type LetteraContext = {
  // Mittente
  mittenteNome: string;
  mittenteIndirizzo: string;
  mittenteEmail: string;
  // Destinatario
  destinatarioNome: string;
  comuneNome: string;
  pecComune: string;
  // Luogo segnalazione
  indirizzoVia: string;
  cap: string;
  provinciaSigla: string;
  // Dati regione/legge
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
  pecArpaRegionale?: string;
  // Protocollo
  numeroProtocollo: string;
  // PEC
  oggettoPec: string;
  testoIntroduttivoPec?: string;
  // Tipologia non conformità
  chkVetroPianoInclinato: boolean;
  chkVetroCurvo: boolean;
  chkAltroTipologia: boolean;
  notaAltroTipologia?: string;
  // Problemi
  chkLuceVersoAlto: boolean;
  chkAbbagliamento: boolean;
  chkLuceIntrusiva: boolean;
  chkAltroProblema: boolean;
  notaAltroProblema?: string;
  // Altro
  descrizioneLibera?: string;
  // ARPA
  includiArpa: boolean;
  // Data e luogo
  luogoData: string;
};

export function checkbox(checked: boolean): string {
  return checked ? "[X]" : "[ ]";
}

/**
 * Genera il testo della lettera nel formato plain-text usato nei moduli originali.
 */
export function generaTestoLettera(ctx: LetteraContext): string {
  const tipologiaNonConf: string[] = [];
  if (ctx.chkVetroPianoInclinato)
    tipologiaNonConf.push(
      `${checkbox(ctx.chkVetroPianoInclinato)} Apparecchi a chiusura (vetro di protezione) piana inclinata rispetto all'orizzontale`
    );
  if (ctx.chkVetroCurvo)
    tipologiaNonConf.push(
      `${checkbox(ctx.chkVetroCurvo)} Apparecchi a dispersione libera o a chiusura sporgente (vetro curvo o vetri laterali)`
    );
  if (ctx.chkAltroTipologia && ctx.notaAltroTipologia)
    tipologiaNonConf.push(`Altro: ${ctx.notaAltroTipologia}`);

  const problemi: string[] = [];
  if (ctx.chkLuceVersoAlto)
    problemi.push(`${checkbox(ctx.chkLuceVersoAlto)} Emissione di luce verso l'alto`);
  if (ctx.chkAbbagliamento)
    problemi.push(
      `${checkbox(ctx.chkAbbagliamento)} Elevati fenomeni di abbagliamento e pericolo per il traffico pedonale e stradale (vietati anche ai sensi dell'art. 23 del Codice della Strada)`
    );
  if (ctx.chkLuceIntrusiva)
    problemi.push(
      `${checkbox(ctx.chkLuceIntrusiva)} Luce intrusiva nei fondi e aree private (non ammessa ai sensi del Codice Civile ex art. 844 in tema di immissioni, come ribadito anche da numerose sentenze)`
    );
  if (ctx.chkAltroProblema && ctx.notaAltroProblema)
    problemi.push(`Altro: ${ctx.notaAltroProblema}`);

  const lines: string[] = [];
  lines.push(`Mittente: ${ctx.mittenteNome}`);
  lines.push(`Indirizzo: ${ctx.mittenteIndirizzo}`);
  lines.push(`Email/PEC: ${ctx.mittenteEmail}`);
  lines.push("");
  lines.push(`Ill.mo ${ctx.destinatarioNome}`);
  lines.push(`del Comune di ${ctx.comuneNome}`);
  lines.push(`PEC: ${ctx.pecComune}`);
  lines.push(`${ctx.luogoData}`);
  lines.push("");
  lines.push(`Oggetto: ${ctx.oggettoPec}`);
  lines.push("");
  lines.push(`Protocollo n. ${ctx.numeroProtocollo}`);
  lines.push("");
  // Testo introduttivo del volontario (opzionale): inserito prima del corpo
  // formale della lettera. Includerlo qui garantisce che l'anteprima (PDF
  // via browser) e l'invio PEC siano coerenti.
  if (ctx.testoIntroduttivoPec && ctx.testoIntroduttivoPec.trim()) {
    lines.push(ctx.testoIntroduttivoPec.trim());
    lines.push("");
  }
  lines.push(`Egregio ${ctx.destinatarioNome},`);
  lines.push("");
  lines.push(
    `la Legge ${ctx.riferimentoLegge} "${ctx.titoloLegge}" prescrive che tutti gli impianti d'illuminazione pubblici e privati realizzati e modificati dopo la sua entrata in vigore debbano essere realizzati conformemente alle disposizioni tecniche della legge medesima.`
  );
  lines.push("");
  lines.push("Nello specifico si ricorda che tutti gli impianti d'illuminazione sono soggetti:");
  lines.push("");
  lines.push(
    `- a progetto illuminotecnico (${ctx.testoProgettoIlluminotecnico}) ad esclusione di quelli di modesta entità (${ctx.testoDeroghe}) corredati dai dati fotometrici firmati dal responsabile tecnico del laboratorio che li ha emessi circa la loro veridicità (${ctx.testoDatiFotometrici});`
  );
  lines.push("");
  lines.push(`- ad approvazione (${ctx.testoApprovazione});`);
  lines.push("");
  lines.push(
    `- a conclusione lavori, al rilascio della dichiarazione di conformità da parte dell'impresa esecutrice relativa all'installazione conforme al progetto ed alla Legge di cui sopra (${ctx.testoInstallazione});`
  );
  lines.push("");
  lines.push(
    `- al controllo e la verifica, da parte dei Comuni, del rispetto dei contenuti della legge (${ctx.testoControllo}), anche avvalendosi delle competenze degli enti territoriali preposti;`
  );
  lines.push("");
  lines.push(
    "Purtroppo, abbiamo rilevato che la nuova illuminazione di seguito descritta non è stata realizzata conformemente alla legge suddetta:"
  );
  lines.push("");
  lines.push(`Riferimenti e Indirizzo: ${ctx.indirizzoVia} - ${ctx.cap} ${ctx.comuneNome} (${ctx.provinciaSigla})`);
  lines.push("");
  lines.push("Tipologia di non conformità:");
  if (tipologiaNonConf.length > 0) {
    lines.push(...tipologiaNonConf);
  } else {
    lines.push("(nessuna tipologia specificata)");
  }
  lines.push("");
  lines.push("Problemi/anomalie riscontrate:");
  if (problemi.length > 0) {
    lines.push(...problemi);
  } else {
    lines.push("(nessun problema specificato)");
  }
  lines.push("");
  lines.push(
    `Ricordiamo che nel caso del mancato rispetto della legge in oggetto è d'obbligo provvedere all'immediato adeguamento degli impianti e all'applicazione delle sanzioni amministrative, ove previste (${ctx.testoSanzioni});`
  );
  lines.push("");
  if (ctx.descrizioneLibera && ctx.descrizioneLibera.trim()) {
    lines.push(ctx.descrizioneLibera);
    lines.push("");
  }
  lines.push(
    "Tutto ciò premesso, con la presente si invita l'Amministrazione in indirizzo a porre in essere tutte le iniziative necessarie per garantire l'assolvimento tempestivo degli obblighi di legge e, in specie, ad attivare gli accertamenti istruttori necessari allo scopo entro 30 (trenta) giorni dal ricevimento della presente affinché vengano adeguati gli impianti d'illuminazione."
  );
  lines.push("");
  lines.push(
    "Lo scrivente, ai sensi degli artt. 9 e 10 della legge 241 del 1990, chiede di partecipare ad ogni procedimento amministrativo connesso alla presente segnalazione, nonché di essere tempestivamente informato di ogni atto e documento anche istruttorio, adottato dall'Amministrazione in indirizzo."
  );
  lines.push("");
  lines.push(
    "Comunichiamo formalmente che la divulgazione del nome del segnalante va fatta solo dopo richiesta scritta di accesso agli atti del segnalato all'ufficio competente e in ogni caso dopo l'avvenuto assenso, anche per via telematica entro 30 giorni dalla richiesta."
  );
  lines.push("");
  lines.push(
    "Auspicando che le richieste/segnalazioni di irregolarità ivi presenti saranno prontamente prese in considerazione dandone attuazione e che non siano necessari ulteriori interventi, vi invitiamo in riferimento alla Legge " +
      ctx.riferimentoLegge +
      ", a consultare:"
  );
  lines.push("");
  lines.push("- il pieghevole di formazione sull'illuminazione eco-sostenibile");
  lines.push("  https://cielobuio.org/articolo-1110/");
  lines.push(
    "- i documenti legislativi e formativi messi a disposizione dall'associazione CieloBuio, Coordinamento per la protezione del cielo notturno (cielobuio.org), all'indirizzo:"
  );
  lines.push("  https://cielobuio.org/articolo-874/");
  lines.push("");
  lines.push("Restando a disposizione per ogni approfondimento, si porgono cordiali saluti");
  lines.push("");
  lines.push("In Fede");
  lines.push(ctx.mittenteNome);

  return lines.join("\n");
}

/**
 * Genera l'HTML della lettera per la visualizzazione e la stampa via browser (window.print()).
 */
export function generaHtmlLettera(ctx: LetteraContext): string {
  const testo = generaTestoLettera(ctx);
  const testoEscaped = testo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Escaping obbligatorio dei campi interpolati fuori dal <pre> principale
  // (arpaNote, title). Questi campi derivano da input utente (nome regione,
  // nomeCognome, indirizzo PEC) che non sono vincolati a un charset
  // ristretto, quindi l'escaping HTML è necessario per prevenire XSS.
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const arpaNote =
    ctx.includiArpa && ctx.pecArpaRegionale
      ? `<p class="arpa-note"><strong>Per conoscenza:</strong> ARPA regionale (${escapeHtml(
          ctx.pecArpaRegionale
        )})</p>`
      : "";

  const protocolloEscaped = escapeHtml(ctx.numeroProtocollo);

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Lettera PEC - Protocollo ${protocolloEscaped}</title>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  body {
    font-family: 'Times New Roman', Georgia, serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    margin: 0;
    padding: 24px;
    background: #fff;
  }
  .lettera {
    max-width: 700px;
    margin: 0 auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .intestazione {
    border-bottom: 1px solid #000;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  .intestazione h1 {
    font-size: 14pt;
    margin: 0;
  }
  .arpa-note {
    background: #fef9c3;
    border: 1px solid #ca8a04;
    padding: 8px 12px;
    margin: 12px 0;
    font-size: 10pt;
    border-radius: 4px;
  }
  .allegati-section {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 2px solid #000;
  }
  .allegati-section h2 {
    font-size: 14pt;
    margin: 0 0 16px 0;
  }
  .allegati-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  .allegato {
    break-inside: avoid;
  }
  .allegato img {
    width: 100%;
    max-height: 250px;
    object-fit: contain;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  .allegato .caption {
    font-size: 9pt;
    color: #555;
    margin: 4px 0 0 0;
    text-align: center;
  }
  @media print {
    .no-print { display: none; }
    body { padding: 0; }
    .allegati-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <div class="intestazione">
    <h1>CieloBuio, Coordinamento per la protezione del cielo notturno</h1>
    <p style="margin:4px 0;font-size:10pt;">Lettera di segnalazione impianto di illuminazione non conforme</p>
  </div>
  ${arpaNote}
  <pre class="lettera">${testoEscaped}</pre>
</body>
</html>`;
}

/**
 * Costruisce il context della lettera a partire da una segnalazione dal DB.
 */
export async function buildLetteraContextFromSegnalazione(
  segnalazioneId: string
): Promise<LetteraContext> {
  const s = await db.segnalazione.findUnique({
    where: { id: segnalazioneId },
    include: {
      volontario: true,
      comune: true,
      provincia: { include: { regione: true } },
      regione: true,
    },
  });
  if (!s) throw new Error("Segnalazione non trovata");

  const regione = s.regione ?? s.provincia?.regione;
  if (!regione) throw new Error("Regione non determinabile");

  // Dopo l'anonimizzazione GDPR (vedi cron-jobs.ts), il volontario può
  // essere null. In quel caso usiamo i placeholder "ANONIMIZZATA".
  const vol = s.volontario;
  const mittenteNome = s.mittenteVisibile
    ? (vol?.nomeCognome ?? "[ANONIMIZZATA]")
    : "Referente CieloBuio";
  const mittenteIndirizzo = s.mittenteVisibile
    ? (vol?.indirizzo ?? "non disponibile")
    : "CieloBuio, Coordinamento per la protezione del cielo notturno";
  // Quando il mittente non è visibile, usiamo un placeholder esplicito
  // invece di un indirizzo fittizio che sembrerebbe reale.
  const mittenteEmail = s.mittenteVisibile
    ? (vol?.pec ?? vol?.emailOrdinaria ?? vol?.email ?? "[ANONIMIZZATA]")
    : "(PEC dell'associazione CieloBuio - da configurare nel pannello amministrazione)";

  const luogo = s.comune?.nome ?? "";
  const dataFmt = s.dataSegnalazione.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return {
    mittenteNome,
    mittenteIndirizzo,
    mittenteEmail,
    destinatarioNome: s.destinatarioNome ?? (s.comune?.nomeSindaco ? `Sindaco ${s.comune.nomeSindaco}` : "Sindaco"),
    comuneNome: s.comune?.nome ?? "",
    pecComune: s.comune?.pecComune ?? "",
    indirizzoVia: s.indirizzoVia,
    cap: s.cap ?? "",
    provinciaSigla: s.provincia?.sigla ?? "",
    regione: regione.regione,
    riferimentoLegge: regione.riferimentoLegge,
    titoloLegge: regione.titoloLegge,
    testoProgettoIlluminotecnico: regione.testoProgettoIlluminotecnico,
    testoDeroghe: regione.testoDeroghe,
    testoDatiFotometrici: regione.testoDatiFotometrici,
    testoApprovazione: regione.testoApprovazione,
    testoInstallazione: regione.testoInstallazione,
    testoControllo: regione.testoControllo,
    testoSanzioni: regione.testoSanzioni,
    pecArpaRegionale: regione.pecArpaRegionale,
    numeroProtocollo: s.numeroProtocollo ?? "(da assegnare)",
    oggettoPec: s.oggettoPec ?? "Segnalazione impianto di illuminazione non conforme",
    testoIntroduttivoPec: s.testoIntroduttivoPec ?? undefined,
    chkVetroPianoInclinato: s.chkVetroPianoInclinato,
    chkVetroCurvo: s.chkVetroCurvo,
    chkAltroTipologia: s.chkAltroTipologia,
    notaAltroTipologia: s.notaAltroTipologia ?? undefined,
    chkLuceVersoAlto: s.chkLuceVersoAlto,
    chkAbbagliamento: s.chkAbbagliamento,
    chkLuceIntrusiva: s.chkLuceIntrusiva,
    chkAltroProblema: s.chkAltroProblema,
    notaAltroProblema: s.notaAltroProblema ?? undefined,
    descrizioneLibera: s.descrizioneLibera ?? undefined,
    includiArpa: s.includiArpa,
    luogoData: `${luogo}, ${dataFmt}`,
  };
}
