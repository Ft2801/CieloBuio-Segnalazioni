# Privacy e conformità normativa

Il progetto CieloBuio Segnalazioni tratta dati personali di volontari, referenti e cittadini (sindaci). Questo documento analizza la conformità al GDPR (Regolamento UE 2016/679) e alle normative italiane sulla PEC.

## Trattamento dati personale

### Dati personali trattati

| Categoria | Dati | Fonte | Base giuridica |
|---|---|---|---|
| Dati anagrafici volontari | nome, cognome, indirizzo, email, PEC | registrazione volontario | consenso (art. 6.1.a GDPR) e interesse legittimo (art. 6.1.f) dell'associazione |
| Dati identificativi referenti | nome, cognome, email, PEC, provincia/regione di competenza | nomina da parte del direttivo | interesse legittimo (art. 6.1.f) |
| Dati pubblici amministratori | nome del sindaco, PEC del Comune | dati di pubblico dominio (sito Comune, Indice PA) | interesse legittimo (art. 6.1.f) |
| Dati segnalazione | indirizzo dell'impianto, coordinate GPS, foto, descrizione | inserimento volontario | interesse legittimo (art. 6.1.f) per tutela ambiente e adempimento obblighi legali |
| Dati tecnici | indirizzi IP (log accesso), user agent | raccolti automaticamente | interesse legittimo (art. 6.1.f) per sicurezza |

### Finalità del trattamento

1. **Gestione segnalazioni** di impianti di illuminazione non conformi alle leggi regionali
2. **Invio di PEC** ai Comuni competenti (e ARPA se richiesto) per diffida formale
3. **Audit trail** delle azioni compiute (chi ha approvato, rifiutato, inviato)
4. **Sicurezza** del sistema (prevenzione accessi non autorizzati, log di audit)
5. **Notifiche** ai referenti e volontari su eventi rilevanti (nuova revisione, rifiuto, invio PEC)

### Retention (periodi di conservazione)

| Tipo dato | Periodo | Motivazione |
|---|---|---|
| Segnalazioni e allegati | 10 anni dalla chiusura | termine prescrittivo per azioni amministrative e legali |
| Storico stati | 10 anni | coerenza con le segnalazioni |
| Log invii PEC | 10 anni | valore legale della PEC inviata |
| Sessioni | 8 ore (scadenza automatica) | minimizzazione finestra di rischio |
| Account disattivati | conservati con `attivo=false` finché serve audit | tracciabilità storica |

**Anonimizzazione automatica GDPR (art. 5.1.e)**: superato il periodo di retention di 10 anni, le segnalazioni vengono **anonimizzate** (non cancellate) per preservare il valore statistico/audit. L'anonimizzazione rimuove tutti i PII:

- `volontarioId` → `null` (rimozione del legame con l'utente)
- `indirizzoVia` → `"[ANONIMIZZATA]"`
- `latitudine`, `longitudine` → `null`
- `descrizioneLibera` → `"[ANONIMIZZATA per scadenza retention]"`
- `notaAltroTipologia`, `notaAltroProblema`, `testoIntroduttivoPec`, `pecCcAggiuntive` → `null`
- `nomeEsercizio` → `null`
- Allegati fisici e record in `allegato` → eliminati (sia i record DB sia i file su disco in `storage/uploads/<id>/`)

Il record della segnalazione resta per statistiche storiche (stato, numeroProtocollo, dataSegnalazione, dataInvio, dataChiusura, comuneId, provinciaId, regioneId, livelloRecidiva), ma è disassociato dall'identità del segnalante. L'evento di anonimizzazione viene registrato in `storico_stati` con nota esplicita.

L'anonimizzazione viene eseguita:
- **Automaticamente** dal cron job giornaliero (`scripts/cron-jobs.ts`)
- **Manualmente** dall'admin via API `POST /api/reminder` con `{ action: "gdpr-anonymize" }`

La logica di anonimizzazione è centralizzata in `src/lib/cron-utils.ts` (funzione `anonimizzaSegnalazioniGdpr`) e condivisa tra il cron job automatico e l'API manuale, per evitare drift tra le due implementazioni.

Il periodo di retention è configurabile via variabile d'ambiente `RETENTION_SEGNALAZIONI_ANNI` (default 10).

**Calcolo della retention**: il job di anonimizzazione usa il campo `dataChiusura` (registrato quando lo stato transita a `chiusa_positiva` o `chiusa_negativa` in `cambia-stato/route.ts`) per calcolare la finestra di retention reale di 10 anni dalla chiusura. Per le segnalazioni chiuse prima dell'introduzione del campo `dataChiusura`, viene usato un fallback su `updatedAt`. Il campo `dataChiusura` viene azzerato quando una pratica chiusa viene riaperta (es. `chiusa_negativa` → `in_attesa`), così la finestra di retention riparte correttamente dalla nuova chiusura. Questo risolve un bug logico precedente in cui la retention era basata su `updatedAt` (che si aggiorna ad ogni modifica del record, posticipando falsamente la finestra GDPR).

### Diritti dell'interessato

I volontari e i referenti possono esercitare i diritti previsti dal GDPR (artt. 15-22):
- **Accesso** (art. 15): richiedere copia dei propri dati
- **Rettifica** (art. 16): correggere dati inesatti
- **Cancellazione** (art. 17): limitata per i dati necessari ad adempiere obblighi legali (segnalazioni inviate, log PEC)
- **Limitazione** (art. 18): bloccare il trattamento in casi specifici
- **Portabilità** (art. 20): ricevere i propri dati in formato strutturato (export CSV disponibile)
- **Opposizione** (art. 21): per motivi legati alla situazione particolare

Le richieste vanno inviate a: fabiot2801@gmail.com (oppure apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues).

### Misure di sicurezza tecniche (art. 32 GDPR)

- **Pseudonimizzazione**: non applicata (i dati sono identificativi per natura)
- **Crittografia**: HTTPS in transito, hash bcrypt per password
- **Riservatezza**: RBAC con competenza territoriale, file upload in directory privata
- **Integrità**: audit trail completo delle modifiche
- **Disponibilità**: backup giornalieri con retention 30 giorni
- **Resilienza**: single VPS, non alta disponibilità (accettabile per il volume previsto)

### Misure di sicurezza organizzative

- **Titolare del trattamento**: CieloBuio, Coordinamento per la protezione del cielo notturno (ODV)
- **Responsabile del trattamento**: non designato (tutto interno all'associazione)
- **Data Protection Officer (DPO)**: non obbligatorio (nessun trattamento su larga scala di categorie particolari, art. 37)
- **Registro delle attività di trattamento**: questo documento costituisce la base
- **Notifica violazione dati (art. 33)**: entro 72 ore dal riscontro, al Garante per la Protezione dei Dati Personali (www.garanteprivacy.it)

### Trasferimenti dati extra-UE

Nessun trasferimento di dati personali a paesi terzi. Tutto il traffico resta su server ubicati in Italia/EU.

## Conformità normativa PEC

### Quadro normativo

- **DPR 160/2010** (Regolamento PEC): disciplina l'uso della PEC nei rapporti con la PA
- **CAD - Codice dell'Amministrazione Digitale (D.Lgs. 82/2005)**: la PEC ha valore equivalente alla raccomandata con ricevuta di ritorno
- **L. 241/1990** (Legge sul procedimento amministrativo): la segnalazione è un'istanza legittima, il Comune ha obbligo di risposta
- **Leggi regionali inquinamento luminoso**: ogni regione ha la propria (es. L.R. Lombardia 31/15)

### Vincoli tecnici PEC

- **No BCC verso PEC**: i messaggi inviati da una casella PEC possono avere destinatari CC in PEC, ma non supportano il CCN (BCC) verso indirizzi PEC. Il sistema rispetta questo vincolo mettendo tutti i destinatari in TO o CC.
- **Mittente PEC valido**: l'indirizzo mittente deve essere una casella PEC (non email ordinaria). In produzione configurare `PEC_SMTP_*` con le credenziali della casella PEC intestata a CieloBuio.
- **Ricevute di consegna**: il gestore PEC invia ricevute di accettazione e consegna. Queste non sono gestite automaticamente dal sistema (la casella PEC va monitorata manualmente per le risposte).

### Validità legale della lettera PEC

La lettera PEC generata dal sistema contiene:
- **Riferimenti normativi** specifici della regione (dalla tabella `regioni_leggi`)
- **Numero di protocollo** univoco nel formato `YYYYMMGG-REG-PV-NCXX`
- **Testo legale** già validato da CieloBuio in uso reale
- **Firma** del mittente (volontario o referente, secondo la logica `mittenteVisibile`)
- **Riferimenti agli artt. 9 e 10 della L. 241/1990** per partecipazione al procedimento amministrativo

La PEC ha valore legale equivalente alla raccomandata A/R. La segnalazione fa decorrere il termine di 30 giorni per la risposta dell'amministrazione (L. 241/1990 art. 2).

### Responsabilità legale

- **Segnalante (volontario)**: responsabile della veridicità dei dati inseriti (luogo, foto, descrizione). Eventuali segnalazioni false o diffamatorie possono esporre a responsabilità civile e penale.
- **Referente territoriale**: responsabile della verifica della segnalazione prima dell'invio PEC. La sua approvazione attesta che la segnalazione è coerente e formalmente corretta.
- **Direttivo CieloBuio**: responsabile della gestione della piattaforma, della nomina dei referenti, della verifica periodica dei dati di configurazione (sindaci, PEC, riferimenti normativi).
- **Escalation alla Procura della Repubblica**: NON automatizzata. Il sistema segnala solo il raggiungimento di una soglia di recidiva; la decisione di procedere è sempre umana e spetta al direttivo o a un legale.

### Limitazione di responsabilità

La piattaforma è uno strumento di supporto alla segnalazione. Non sostituisce:
- la valutazione legale caso per caso (eventualmente consultare un legale)
- la verifica della normativa regionale aggiornata (la tabella `regioni_leggi` va mantenuta aggiornata dal direttivo)
- il monitoraggio delle risposte della PA (la casella PEC va controllata manualmente)

## Audit normativo: conformità dell'iter di gestione

L'iter completo di gestione di una segnalazione, dalla creazione alla chiusura, è conforme ai seguenti requisiti normativi:

### 1. Creazione segnalazione (volontario)

**Atto**: il volontario compila il form con indirizzo, foto, tipologia di non conformità.
**Conformità**: il volontario presta il consenso al trattamento dati al momento della registrazione. I dati inseriti sono minimi e necessari (art. 5 GDPR, principio di minimizzazione).

### 2. Invio in revisione (volontario)

**Atto**: la segnalazione passa dal volontario al referente territoriale competente.
**Conformità**: il routing è basato sulla provincia/regione della segnalazione, derivata automaticamente dal comune. Il volontario non può bypassare il referente.

### 3. Approvazione o rifiuto (referente)

**Atto**: il referente verifica i dati e approva (con possibile modifica) o rifiuta con nota.
**Conformità**: l'approvazione è tracciata nello storico stati con timestamp e utente. Il rifiuto include una nota obbligatoria che spiega al volontario cosa correggere.

### 4. Simulazione invio (referente/admin)

**Atto**: invio di prova della PEC solo all'indirizzo del mittente.
**Conformità**: non produce effetti legali (non arriva al Comune). Serve come test tecnico.

### 5. Invio PEC reale (referente/admin)

**Atto**: la PEC viene inviata al Comune (e ARPA se richiesto).
**Conformità**:
- numero di protocollo univoco generato atomicamente
- destinatari in TO e CC (mai BCC, per vincolo tecnico PEC)
- log invio con esito e timestamp (valore legale)
- transazione di stato registrata nello storico
- notifica email al volontario dell'avvenuto invio

### 6. Attesa risposta

**Atto**: la pratica resta in stato "in_attesa" finché il Comune risponde.
**Conformità**: il sistema non automatizza azioni legali. La soglia di recidiva (dopo N segnalazioni collegate) è solo un alert visivo; l'escalation resta decisione umana.

### 7. Chiusura

**Atto**: chiusura positiva (impianto adeguato) o negativa (nessun adeguamento).
**Conformità**: l'amministratore valuta manualmente l'escalation per le chiusure negative.

## Ispezioni e verifiche periodiche

Il direttivo CieloBuio è responsabile di:
- **Verifica semestrale** dei dati dei sindaci nella tabella `comuni` (il pannello admin evidenzia in giallo i comuni con verifica più vecchia di 6 mesi)
- **Verifica annuale** dei riferimenti normativi nella tabella `regioni_leggi` (le leggi regionali cambiano)
- **Backup giornaliero** del database (script `scripts/backup-db.ts`)
- **Monitoraggio log** di sicurezza (tentativi di login falliti, errori invio PEC)
- **Revisione accessi** (disattivazione volontari non più attivi)

## Aggiornamenti normativi

Questo documento va revisionato:
- al cambiamento del GDPR o della normativa italiana sulla protezione dati
- al cambiamento delle normative regionali sull'inquinamento luminoso
- al cambiamento della disciplina PEC (DPR 160/2010)
- in caso di dati di fatto nuovi (es. nuove tipologie di dati trattati)

Ultima revisione: 12 luglio 2026.

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
