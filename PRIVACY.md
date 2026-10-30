# Privacy e conformità normativa

Il progetto CieloBuio Segnalazioni tratta dati personali di volontari e referenti territoriali e, limitatamente ai dati pubblici, di amministratori comunali (sindaci). Questo documento analizza la conformità al GDPR (Regolamento UE 2016/679) e alle normative italiane sulla PEC.

## Trattamento dati personale

### Dati personali trattati

| Categoria | Dati | Fonte | Base giuridica |
|---|---|---|---|
| Dati anagrafici volontari | nome, cognome, indirizzo, email, PEC | creazione dell'account da parte dell'amministratore | interesse legittimo del titolare (art. 6.1.f GDPR); il sistema non raccoglie un consenso, la cui necessità è valutata dal titolare |
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
| Segnalazioni e allegati | 10 anni dalla chiusura | termine ordinario di prescrizione civile (art. 2946 c.c.) e tutela dei diritti in sede amministrativa e legale |
| Storico stati | come la segnalazione a cui si riferisce | audit delle transizioni di stato |
| Log invii PEC | periodo indicativo di 10 anni; il sistema non cancella automaticamente questi record | prova dell'invio PEC |
| Registro export (AuditLog) | periodo indicativo di 10 anni; il sistema non cancella automaticamente questi record | tracciamento degli export CSV, art. 30 GDPR |
| Sessioni | 8 ore (scadenza automatica) | minimizzazione finestra di rischio |
| Account disattivati | conservati con `attivo=false` finché serve audit | tracciabilità storica |

**Anonimizzazione automatica GDPR (art. 5.1.e)**: superato il periodo di retention di 10 anni, le segnalazioni vengono **anonimizzate** (non cancellate) per preservare il valore statistico/audit. L'operazione rimuove i seguenti dati identificativi e campi liberi:

- `volontarioId` → `null` (rimozione del legame con l'utente)
- `indirizzoVia` → `"[ANONIMIZZATA]"`
- `cap`, `latitudine`, `longitudine` → `null`
- `descrizioneLibera` → `"[ANONIMIZZATA]"`
- `notaAltroTipologia`, `notaAltroProblema`, `testoIntroduttivoPec`, `pecCcAggiuntive`, `notaRifiuto`, `destinatarioNome`, `oggettoPec` → `null`; le note delle transizioni in `storico_stati` → `null` (date, stati e autori restano)
- `nomeEsercizio` → `null`
- Allegati fisici e record in `allegato` → eliminati (sia i record DB sia i file su disco in `storage/uploads/<id>/`)
- Nei log invii PEC (`log_invii_pec`): `destinatari` degli invii simulati → `"[ANONIMIZZATA]"`; `oggetto` → `"[ANONIMIZZATA]"` e `messaggioErrore` → `null` su tutti i log. I destinatari dei log degli invii reali restano come prova dell'invio.

Il record della segnalazione resta per statistiche storiche (stato, numeroProtocollo, dataSegnalazione, dataInvio, dataChiusura, comuneId, provinciaId, regioneId, livelloRecidiva), ma il collegamento diretto al volontario viene rimosso. Identificativi di autori e approvatori nello storico, protocollo, località e destinatari di PEC reali restano disponibili per audit e prova dell'invio: in casi particolari potrebbero permettere una reidentificazione indiretta. Il titolare deve limitarne l'accesso e valutare periodicamente la base giuridica e i tempi di conservazione, inclusi i log PEC e gli archivi di backup. L'evento di anonimizzazione viene registrato in `storico_stati` con nota esplicita.

L'anonimizzazione viene eseguita:
- **Automaticamente** dal cron job giornaliero (`scripts/cron-jobs.ts`)
- **Manualmente** dall'admin via API `POST /api/reminder` con `{ action: "gdpr-anonymize" }`

La logica di anonimizzazione è centralizzata in `src/lib/cron-utils.ts` (funzione `anonimizzaSegnalazioniGdpr`) e condivisa tra il cron job automatico e l'API manuale.

I backup cifrati possono contenere dati presenti prima dell'anonimizzazione. La rotazione locale li elimina dopo 30 giorni dal nome dell'archivio quando viene eseguito il backup successivo. Le copie esterne e i dump PostgreSQL hanno una conservazione da definire e applicare separatamente. Un ripristino di un backup antecedente all'anonimizzazione richiede di rieseguire il job GDPR e verificare la cancellazione degli allegati non più conservabili.

Il periodo di retention è configurabile via variabile d'ambiente `RETENTION_SEGNALAZIONI_ANNI` (default 10).

**Calcolo della retention**: il job di anonimizzazione usa il campo `dataChiusura` (registrato quando lo stato transita a `chiusa_positiva` o `chiusa_negativa` in `src/app/api/segnalazioni/[id]/cambia-stato/route.ts`) per calcolare la finestra di retention reale di `RETENTION_SEGNALAZIONI_ANNI` anni (10 per default) dalla chiusura. Se `dataChiusura` non è valorizzato, il calcolo usa `updatedAt` come approssimazione conservativa. Il campo `dataChiusura` viene azzerato quando una pratica chiusa viene riaperta (es. `chiusa_negativa` → `in_attesa`), così la finestra di retention riparte correttamente dalla nuova chiusura.

**Resilienza del processo**: il job di anonimizzazione è strutturato per resilienza: se l'anonimizzazione di una singola segnalazione fallisce (es. errore transiente DB, permessi filesystem), l'errore viene loggato e il job procede con la segnalazione successiva. Questo garantisce che un problema isolato su un record non blocchi l'adempimento GDPR per le restanti segnalazioni scadute. L'operazione di anonimizzazione è inoltre transazionale a livello di singolo record: deleteMany allegati + update segnalazione + create storico avvengono in un'unica transazione, garantendo che il record resti consistente anche in caso di fallimento parziale. La rimozione dei file su disco avviene dopo il commit, in modo best-effort; eventuali residui vengono rimossi dal job di pulizia dei file orfani.

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
- **Crittografia**: HTTPS in transito, hash bcrypt per password, backup cifrati con AES-256-GCM
- **Riservatezza**: RBAC con competenza territoriale, file upload in directory privata
- **Integrità**: audit trail completo delle modifiche
- **Disponibilità**: backup giornalieri con retention 30 giorni
- **Resilienza**: single VPS, non alta disponibilità (accettabile per il volume previsto)

### Misure di sicurezza organizzative

- **Titolare del trattamento**: CieloBuio, Coordinamento per la protezione del cielo notturno
- **Responsabili del trattamento (art. 28 GDPR)**: i fornitori di hosting e del servizio SMTP/PEC trattano dati per conto del titolare e vanno designati con atto scritto, prima della messa in produzione
- **Data Protection Officer (DPO)**: non obbligatorio (nessun trattamento su larga scala di categorie particolari, art. 37)
- **Registro delle attività di trattamento**: questo documento costituisce la base
- **Notifica violazione dati (art. 33)**: senza ingiustificato ritardo e, ove possibile, entro 72 ore da quando il titolare ne ha conoscenza, al Garante per la Protezione dei Dati Personali (www.garanteprivacy.it)

### Trasferimenti dati extra-UE

Il software non prevede trasferimenti di dati personali verso paesi terzi. L'ubicazione dei server dipende dall'installazione: il titolare sceglie il fornitore (nel deploy descritto in SETUP, un VPS) e deve scegliere un'infrastruttura nell'UE o in un paese con decisione di adeguatezza.

## Conformità normativa PEC

### Quadro normativo

- **DPR 68/2005** (Regolamento PEC): disciplina il servizio di posta elettronica certificata e il suo valore giuridico, anche nei rapporti con la PA
- **CAD - Codice dell'Amministrazione Digitale (D.Lgs. 82/2005)**: la PEC ha valore equivalente alla raccomandata con ricevuta di ritorno
- **L. 241/1990** (Legge sul procedimento amministrativo): quando la segnalazione è trattata come istanza, il Comune è tenuto a concludere il procedimento
- **Leggi regionali inquinamento luminoso**: ogni regione ha la propria (es. L.R. Lombardia 31/2015)

### Vincoli tecnici PEC

- **No BCC verso PEC**: i messaggi inviati da una casella PEC possono avere destinatari CC in PEC, ma non supportano il CCN (BCC) verso indirizzi PEC. Il sistema rispetta questo vincolo mettendo tutti i destinatari in TO o CC.
- **Mittente PEC valido**: l'indirizzo mittente deve essere una casella PEC (non email ordinaria). In produzione configurare `PEC_SMTP_*` con le credenziali della casella PEC intestata a CieloBuio.
- **Ricevute di consegna**: il gestore PEC invia ricevute di accettazione e consegna. Queste non sono gestite automaticamente dal sistema (la casella PEC va monitorata manualmente per le risposte).

### Validità legale della lettera PEC

La lettera PEC generata dal sistema contiene:
- **Riferimenti normativi** specifici della regione (dalla tabella `regioni_leggi`)
- **Numero di protocollo** univoco nel formato `YYYYMMGG-REG-PV-NCXX`
- **Testo della lettera** predefinito nel progetto (`src/lib/lettera.ts`); prima dell'uso ufficiale va fatto verificare da un legale
- **Firma** del mittente (volontario o referente, secondo la logica `mittenteVisibile`). Il dettaglio della segnalazione mostra al referente solo nome e cognome del volontario: PEC, e-mail, indirizzo e firma restano nel database e vengono usati solo per le comunicazioni con il Comune e per la lettera PEC.
- **Riferimenti agli artt. 9 e 10 della L. 241/1990** per partecipazione al procedimento amministrativo

La PEC ha valore legale equivalente alla raccomandata A/R. Quando la segnalazione è trattata come istanza, il termine ordinario di conclusione del procedimento è di 30 giorni (L. 241/1990, art. 2), salvo termini diversi previsti dalla normativa regionale o di settore.

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
**Conformità**: i dati richiesti sono quelli necessari alla segnalazione (art. 5 GDPR, principio di minimizzazione). L'informativa al volontario e l'eventuale consenso sono a cura del titolare.

### 2. Invio in revisione (volontario)

**Atto**: la segnalazione passa dal volontario al referente territoriale competente.
**Conformità**: il routing è basato sulla provincia/regione della segnalazione, derivata automaticamente dal comune. Il volontario non può bypassare il referente.

### 3. Approvazione o rifiuto (referente)

**Atto**: il referente verifica i dati e approva (con possibile modifica) o rifiuta con nota.
**Conformità**: l'approvazione è tracciata nello storico stati con timestamp e utente. Il rifiuto include una nota obbligatoria che spiega al volontario cosa correggere.

### 4. Simulazione invio (referente/admin)

**Atto**: invio di prova della PEC solo al destinatario di controllo (la PEC del volontario o, se il mittente non è visibile, quella dell'utente che richiede la simulazione).
**Conformità**: non produce effetti legali (non arriva al Comune). Serve come test tecnico.

### 5. Invio PEC reale (referente/admin)

**Atto**: la PEC viene inviata al Comune (e ARPA se richiesto).
**Conformità**:
- numero di protocollo univoco, garantito dal vincolo unique del database (in caso di collisione il progressivo viene ricalcolato)
- destinatari in TO e CC (mai BCC, per vincolo tecnico PEC)
- log invio con esito e timestamp (valore legale)
- transazione di stato registrata nello storico
- notifica email al volontario e al referente dell'avvenuto invio

### 6. Attesa risposta

**Atto**: la pratica resta in stato "in_attesa" finché il Comune risponde.
**Conformità**: il sistema non automatizza azioni legali. La soglia di recidiva (dopo N segnalazioni collegate) è solo un alert visivo; l'escalation resta decisione umana.

### 7. Chiusura

**Atto**: chiusura positiva (impianto adeguato) o negativa (nessun adeguamento).
**Conformità**: l'amministratore valuta manualmente l'escalation per le chiusure negative.

## Ispezioni e verifiche periodiche

Il direttivo CieloBuio è responsabile di:
- **Verifica semestrale** dei dati dei sindaci nella tabella `comuni` (il pannello admin evidenzia con uno sfondo ambra e l'etichetta "Da verificare" i comuni con verifica più vecchia di 6 mesi)
- **Verifica annuale** dei riferimenti normativi nella tabella `regioni_leggi` (le leggi regionali cambiano)
- **Backup giornaliero** del database (script `scripts/backup-db.ts`)
- **Monitoraggio log** di sicurezza (tentativi di login falliti, errori invio PEC)
- **Revisione accessi** (disattivazione volontari non più attivi)

## Aggiornamenti normativi

Questo documento va revisionato:
- al cambiamento del GDPR o della normativa italiana sulla protezione dati
- al cambiamento delle normative regionali sull'inquinamento luminoso
- al cambiamento della disciplina PEC (DPR 68/2005)
- in caso di dati di fatto nuovi (es. nuove tipologie di dati trattati)

Data del documento: 30 ottobre 2026.

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
