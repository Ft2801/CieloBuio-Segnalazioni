# Versione 1.0.0

Versione iniziale

## Segnalazioni

- Gestione delle pratiche da bozza a revisione, approvazione, invio PEC, attesa ed esito. Le transizioni sono registrate nello storico; il Comune è obbligatorio e determina il territorio competente.
- Ruoli di volontario, referente provinciale, referente regionale e amministratore, con autorizzazioni territoriali e protezione delle pratiche altrui.
- Form a passi con ricerca del Comune, geolocalizzazione facoltativa, salvataggio della bozza, recidive e allegati JPEG, PNG, WebP e PDF. Sono ammessi fino a quattro allegati da 10 MB ciascuno.
- Dashboard, elenco con filtri e ricerca, dettaglio, anteprima della lettera PEC, promemoria, esportazione CSV con limite esplicito di 5000 righe per file e pannello di amministrazione.
- Interfaccia in italiano, tema chiaro o scuro, PWA con cache isolate per percorso applicativo e modalità dimostrativa riservata alla build statica.

## Comunicazioni

- Protocollo univoco assegnato prima dell'invio PEC e riutilizzato se l'invio non si conclude.
- Invio tramite SMTP configurato, con verifica degli allegati e dell'accettazione di tutti i destinatari da parte del server. L'accettazione SMTP non equivale alla ricevuta di consegna PEC, che va controllata nella casella.
- Registrazione persistente del tentativo prima di SMTP. I tentativi in corso, incerti o già accettati impediscono un secondo invio automatico. La riconciliazione richiede una verifica operativa della casella PEC.
- Notifiche email sugli eventi della pratica e simulazione PEC per il controllo del contenuto.

## Sicurezza e dati

- Risposte dinamiche e API con `Cache-Control: private, no-store` per impedire la memorizzazione di dati personali e nonce CSP.
- Sessioni HTTP-only, password con hash bcrypt, autenticazione a due fattori TOTP con rotazione senza disattivazione temporanea, rate limit, controllo CSRF, header di sicurezza e validazione dei dati in ingresso. La verifica TOTP e la registrazione anti-replay condividono lo stesso istante; le sessioni non sono valide all'istante di scadenza.
- Cambio di password o privilegi e invalidazione delle sessioni nella stessa transazione. La creazione della sessione verifica sotto lock che password e configurazione 2FA corrispondano alle credenziali appena controllate. Le operazioni che riducono il numero di amministratori attivi usano una transazione serializzabile.
- Upload e cancellazione degli allegati con controlli di stato e competenza ripetuti sotto lock della pratica. I salvataggi del form trasmettono la versione caricata per rilevare modifiche da altre schede; la versione temporale cresce anche nello stesso millisecondo. Un errore sospende l'autosalvataggio fino a un tentativo manuale. Le decisioni di revisione verificano atomicamente anche la versione e il territorio letti.
- Directory degli allegati e dei backup private (`0700`), file creati con permessi `0600` e limite sul corpo degli upload anche in assenza di `Content-Length`.
- Anonimizzazione delle pratiche chiuse oltre la soglia di conservazione configurabile, calcolata dalla data di chiusura. La procedura protegge da riaperture concorrenti e rimuove dati liberi, collegamento al volontario, allegati, note e oggetti dei log PEC.
- Pulizia periodica di sessioni scadute e file orfani, con protezione contro collegamenti simbolici nelle directory esaminate.

## Continuità operativa

- Backup cifrato AES-256-GCM delle tabelle, dei metadati e degli allegati fisici. Un archivio incompleto non viene pubblicato; la conservazione automatica degli archivi è di 30 giorni.
- Ripristino con verifica di cifratura e integrità prima di sostituire lo storage. Database e file sono recuperati insieme; in caso di errore nella transazione, i file attivi vengono ripristinati. Le recidive e le sequenze PostgreSQL sono riallineate nella transazione. Dopo il commit un errore di output non ripristina soltanto i file precedenti.
- Durante backup e ripristino l'applicazione deve essere fermata per ottenere un insieme coerente di database e file. La chiave di cifratura deve essere conservata separatamente dagli archivi.
- Script per configurazione, seed, amministrazione e manutenzione; deploy tramite container o servizio gestito; specifica OpenAPI e suite di test con soglia di copertura del 100%.

Per requisiti, procedure e limiti operativi consultare [README.md](README.md), [SETUP.md](SETUP.md), [SECURITY.md](SECURITY.md) e [PRIVACY.md](PRIVACY.md).
