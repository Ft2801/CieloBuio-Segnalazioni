# Sicurezza

La versione iniziale di CieloBuio Segnalazioni comprende una suite di **78 test di sicurezza informatica** (`src/__tests__/security-attack-suite.test.ts`) sulle difese contro i vettori di attacco OWASP Top 10. Questa pagina descrive le misure implementate, i test di sicurezza e le responsabilità operative.

## Misure di sicurezza implementate

### Autenticazione e sessioni

- **Password hashate** con bcrypt, cost factor 12
- **Password policy rafforzata**: minimo 12 caratteri, almeno una maiuscola, una minuscola, una cifra, un carattere speciale, non più di 2 caratteri consecutivi uguali
- **Sessioni via cookie HTTP-only** con flag `HttpOnly`, `SameSite=Strict`, `Secure` (in produzione)
- **Prefisso `__Host-` sul cookie di sessione in produzione** (`__Host-cb_session`): impone `Path=/`, `Secure` e l'assenza di `Domain`, e impedisce che un sottodominio compromesso sovrascriva il cookie di sessione
- **Durata sessione**: 8 ore, per limitare la finestra di rischio di una sessione compromessa
- **Session rotation**: al login tutte le sessioni precedenti dello stesso utente vengono invalidate (prevenzione session fixation)
- **Invalidazione sessioni admin**: cambio di password, ruolo, stato attivo o competenza territoriale (provincia o regione) da parte di un admin distrugge tutte le sessioni attive dell'utente (prevenzione della persistenza dopo una compromissione)
- **Rate limiting login doppio** (per IP **e** per email), con escalation dei blocchi:
  - per IP: 20 tentativi falliti nella finestra di 15 minuti. Il limite è più alto perché più utenti possono condividere lo stesso IP pubblico (rete di un ufficio)
  - per email: 3 tentativi falliti nella finestra di 15 minuti. Il limite protegge il singolo account
  - 1° blocco: 5 minuti
  - 2° blocco (entro 1 ora): 15 minuti
  - 3° blocco (entro 1 ora): 1 ora
  - 4° e successivi: 24 ore
- L'IP del client è letto solo da `X-Real-IP`, impostato da Caddy. L'header `X-Forwarded-For` non viene considerato, quindi non può essere falsificato per aggirare il limite per IP. Il limite per email resta valido anche se l'attaccante cambia IP
- **Pulizia automatica delle sessioni scadute** via cron job

### Autorizzazione (RBAC + competenza territoriale)

- **Quattro ruoli**: volontario, referente provinciale, referente regionale, amministratore
- **Visibilità dati per ruolo**:
  - volontario: solo le proprie segnalazioni
  - referente_provinciale: segnalazioni della propria provincia (richiede `provinciaId` assegnato)
  - referente_regionale: segnalazioni della propria regione (richiede `regioneId` assegnato)
  - admin: tutte
- **Fail-closed per referenti senza territorio**: un referente con `provinciaId=null` o `regioneId=null` non vede alcuna segnalazione
- **Competenza territoriale verificata** su ogni endpoint che agisce su una segnalazione specifica
- **Helper centralizzato** `canViewSegnalazione()` e `hasTerritorialCompetence()` per evitare disallineamenti tra endpoint
- **Segnalazioni anonimizzate** (post-retention GDPR, `volontarioId=null`): non visibili al volontario, restano visibili ad admin e referenti territoriali per audit

### Prevenzione IDOR (Insecure Direct Object Reference)

Tutti gli endpoint `/api/segnalazioni/[id]/*` verificano che l'utente abbia diritto di accedere alla risorsa prima di restituirla o modificarla:
- GET dettaglio segnalazione
- PUT modifica segnalazione: bloccata dopo `approvata`; `provinciaId` e `regioneId` derivano sempre lato server dal comune
- DELETE elimina bozza
- POST approva / rifiuta / invia-pec / simula-pec / cambia-stato (tutti usano `hasTerritorialCompetence` fail-closed)
- GET lettera PEC (con e senza allegati)
- GET download allegato
- DELETE allegato: richiede diritto di modifica; il proprietario può eliminare solo in stato `bozza`; i referenti possono eliminare in `bozza` e `in_revisione`
- Upload allegato: bloccato dopo `approvata`

### Business logic: protezione del pacchetto probatorio

- **DELETE allegati**: il volontario proprietario può eliminare allegati **solo** in stato `bozza`. Una volta inviata in revisione al referente (stato `in_revisione`), il pacchetto probatorio è "congelato" e non può più essere alterato dal volontario. I referenti con competenza territoriale e gli admin mantengono l'accesso in `bozza` e `in_revisione` (per esempio per rimuovere contenuto inappropriato prima dell'approvazione). Questo previene che un volontario rimuova prove fotografiche già visionate dal referente, alterando ciò che verrà effettivamente inviato via PEC
- **Coerenza con PUT segnalazioni**: la stessa restrizione si applica alle modifiche PUT (il volontario non può modificare in `in_revisione`, solo il referente può)
- **Upload bloccato dopo approvazione**: dopo `approvata`, nessun nuovo allegato può essere caricato (previene che allegati mai revisionati dal referente vengano inclusi nella PEC)

### Protezione contro XSS

- **HTML escaping** di tutti i contenuti generati dall'utente nella lettera PEC (testo, descrizione libera, nome originale degli allegati)
- **Escaping defense-in-depth** per i campi interpolati fuori dal `<pre>` principale in `generaHtmlLettera`: `pecArpaRegionale` e `numeroProtocollo` vengono escapati con `escapeHtml`
- **Content-Security-Policy** strict su `script-src` con nonce generato per ogni richiesta e `'strict-dynamic'`: `default-src 'self'; script-src 'self' 'nonce-<casuale per richiesta>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`. Il nonce è letto da Next.js per applicarlo ai propri script di bootstrap. Con `'strict-dynamic'` gli script caricati da uno script con nonce sono ammessi, mentre gli script inline privi di nonce non vengono eseguiti. La direttiva `style-src 'self' 'unsafe-inline'` è necessaria per Next.js, che inietta stili inline per l'idratazione
- **CSP esplicita sulla route lettera HTML**: defense-in-depth oltre al proxy, con `script-src 'none'` per bloccare ogni esecuzione di script nella pagina di anteprima della lettera PEC
- **Cache-Control: private, no-store** su `/api/auth/me`, sul dettaglio segnalazione (`/api/segnalazioni/[id]`), sulle azioni di approvazione, rifiuto e cambio stato, sul download e sulla preview degli allegati, sulla lettera, sull'export CSV, sul reminder e su `/api/metrics`, per prevenire cache hit cross-user in proxy intermedi
- **X-Content-Type-Options: nosniff** su tutte le risposte
- **Validazione input** con Zod su tutti gli endpoint di creazione e modifica

### Protezione contro CSRF

- **Cookie SameSite=Strict** (blocca le richieste cross-site)
- **Verifica Origin/Referer** sui metodi che modificano stato (POST, PUT, DELETE, PATCH) nel proxy. La variabile `NEXT_PUBLIC_BASE_URL` è obbligatoria in produzione: se manca, il controllo è fail-closed (503 su tutte le richieste che modificano stato)
- **Le azioni che modificano stato non usano GET**: la route `/api/reminder` esegue le azioni (`action`) solo via POST
- **Restrizione dev hosts**: in produzione gli host `localhost:3000` e `127.0.0.1:3000` non sono accettati come Origin valide

### Protezione contro email header injection

- **Validazione Zod** di tutti i campi che finiscono nelle email (oggetto PEC, testo introduttivo, CC aggiuntive, destinatario)
- **Regex anti-CRLF** `^[^\r\n]*$` su tutti i campi header
- **Validazione formato email** di tutti gli indirizzi PEC in copia: massimo 5 indirizzi, separati da `;`. Un indirizzo non valido blocca l'invio con risposta 400
- **Nome file degli allegati** nell'invio PEC: i caratteri diversi da lettere e cifre ASCII, underscore, punto, trattino e spazio vengono sostituiti con `_`, e il nome è troncato a 100 caratteri, prima di passare i dati a nodemailer

### Protezione contro CSV/Formula Injection

L'export CSV (`/api/segnalazioni/export`) sanifica ogni campo che inizia con `=`, `+`, `-`, `@` o con uno spazio bianco (incluse tabulazioni e a capo) prefissandolo con un apostrofo. Il controllo vale anche quando il campo inizia con spazi bianchi, perché Excel e LibreOffice possono ignorarli prima di interpretare la formula. I valori numerici (per esempio le coordinate negative) non vengono prefissati. Questo previene l'esecuzione di formule malevole (es. `=HYPERLINK(...)`, `=cmd|...`) quando il CSV viene aperto in Excel o LibreOffice.

### Backup sicuro

Lo script `scripts/backup-db.ts` esporta le tabelle in JSON cifrato, secondo le regole seguenti:
- Il backup richiede `BACKUP_ENCRYPTION_KEY`: senza chiave lo script termina senza creare file. Non esistono backup in chiaro.
- Ogni file del backup (tabelle JSON, metadati e allegati) è cifrato con AES-256-GCM. Il backup include `passwordHash`, il segreto TOTP attivo e quello in attesa di conferma, necessari al ripristino degli account. Le sessioni attive non vengono esportate: il backup non contiene token di sessione, e il ripristino le invalida. Il ripristino rifiuta file alterati o cifrati con una chiave diversa.
- I file fisici degli allegati (`storage/uploads/`) vengono copiati nel backup, cifrati, per un ripristino completo
- I collegamenti simbolici e le voci speciali nello storage non vengono seguiti; `lstat` controlla le dimensioni. Se anche un solo file non viene copiato, supera 500 MB o non è compatibile con il ripristino, il backup fallisce e la directory definitiva non viene pubblicata.
- La directory di backup (`backups/`) è esclusa dal repository (`.gitignore`) e viene creata o ristretta a `0700`. Anche i file cifrati sono creati con `0600` e apertura esclusiva. Il ripristino crea directory degli allegati a `0700` e file a `0600`. La chiave in `.env` va protetta con `0600` (vedi `SETUP.md`).
- La chiave di cifratura (`BACKUP_ENCRYPTION_KEY`) è una stringa Base64 di 32 byte (256 bit), generata con `openssl rand -base64 32`. Va conservata in un password manager o in un KMS separato dal backup.
- Il ripristino verifica e decifra ogni tabella e allegato prima di modificare lo storage o il database; applica il ripristino del database in una transazione, comprese recidive, invalidazione delle sessioni e sequenze delle tabelle con ID intero. Richiede `--force` se una qualsiasi tabella del backup è già popolata nella destinazione.
- **Fermare l'applicazione e i processi che scrivono nello storage durante il backup e il ripristino**: file e database non condividono una transazione atomica. Se il processo viene interrotto durante il ripristino, controllare il database e lo storage prima di riavviare l'app. Un errore gestito nella transazione tenta di ripristinare la directory degli allegati precedente; un'interruzione forzata del processo richiede verifica manuale delle directory temporanee e dei file.
- Il backup programmato su systemd usa una copia dello script in `/usr/local/sbin/` di proprietà di root, non il file nell'albero applicativo scrivibile da `www-data`. Il log del job root resta in una directory non scrivibile dall'applicazione; l'esecuzione di `npm run db:backup` avviene dopo il passaggio all'utente `www-data`.

### File upload sicuro

- **Directory di storage privata** (`storage/uploads/`, fuori da `/public`): la radice e le directory delle pratiche vengono create o ristrette a `0700`; i file vengono creati con permessi `0600` e apertura esclusiva. In fase di installazione, applicare `chmod -R go-rwx` anche ai file e alle pratiche già presenti. I collegamenti simbolici come radice o directory di una pratica vengono rifiutati.
- **Download autenticato** via route `/api/allegati/[id]/download` con verifica di visibilità
- **Whitelist estensioni**: JPEG, PNG, WebP, PDF
- **Verifica magic bytes** anti-spoofing (il contenuto deve corrispondere all'estensione). Per WebP vengono verificati sia "RIFF" (byte 0-3) sia "WEBP" (byte 8-11)
- **Dimensione massima**: 10 MB per file. Il corpo multipart è misurato durante la lettura con un limite di 10 MB più 64 KiB di margine, anche se `Content-Length` manca o è falso; le richieste oltre il limite ricevono 413. Il reverse proxy Caddy applica inoltre un limite di 12 MB.
- **Limite di 4 allegati** per segnalazione, indipendentemente dal tipo
- **Path traversal protection** a 2 livelli (validazione dei segmenti + risoluzione normalizzata), centralizzata in `src/lib/path-guard.ts`. Download, preview, eliminazione allegati, lettera, invio PEC e pulizia dei file orfani usano `parseUrlStorageSicuro` o `risolviPathAllegatoSicuro`; upload, eliminazione segnalazione e anonimizzazione GDPR in `src/lib/gdpr.ts` usano `isSafePathSegment` e `UPLOADS_ROOT`. La validazione `isSafePathSegment` blocca `..`, `.`, `/`, `\\`, `\\0` e i caratteri di controllo ASCII in ogni segmento del path. Il controllo `startsWith(UPLOADS_ROOT + path.sep)` resta come difesa in profondità: con segmenti sicuri `path.resolve` produce già un path dentro `UPLOADS_ROOT`, e il controllo lo verifica comunque
- **Filename sanitizzato** in `Content-Disposition` (nessun carattere speciale)
- **Rate limiting**: 20 upload al minuto per utente
- **Eliminazione allegati**: richiede diritto di modifica (proprietario in `bozza`, oppure referente o admin in `bozza` e `in_revisione` con competenza territoriale)

### Header di sicurezza globali

Tutte le risposte che passano dal proxy includono:
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<casuale>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (senza `preload`, per evitare un vincolo permanente all'HTTPS)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), interest-cohort=()`

Inoltre, Caddy aggiunge una difesa a livello di reverse proxy (CSP di base, `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-Permitted-Cross-Domain-Policies`) anche per gli asset statici esclusi dal matcher del proxy, e impone un limite del corpo di 12 MB per prevenire DoS tramite upload massivi: le richieste oltre il limite ricevono `413 Request Entity Too Large`, sia con `Content-Length` sia senza.
- `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Resource-Policy: same-origin`, che isolano la finestra e le risorse dai siti di terze parti
- `X-Permitted-Cross-Domain-Policies: none`, che blocca i file di policy di Adobe Flash e PDF
- `X-Powered-By` disabilitato (`poweredByHeader: false` in `next.config.ts`)

### Rate limiting

Il rate limiting è in memoria del processo (vedi la sezione "Minimizzazione dei dati e concorrenza").

| Endpoint | Limite | Blocco |
|---|---|---|
| Login (per IP) | 20 tentativi in 15 min | 5 min, 15 min, 1 ora, 24 ore (escalation) |
| Login (per email) | 3 tentativi in 15 min | 5 min, 15 min, 1 ora, 24 ore (escalation) |
| Creazione segnalazioni (per utente) | 20/ora | 30 min |
| Generazione lettera PEC (per utente) | 30/ora | 5 min |
| Invio PEC reale (per utente) | 5/ora | 1 ora |
| Simulazione PEC (per utente) | 10/ora | 30 min |
| Upload allegati (per utente) | 20/minuto | 1 min |
| Export CSV (per utente) | 5/ora | 15 min |
| Operazioni 2FA (per utente) | 5/ora | 1 ora |
| Creazione utenti (per admin) | 30/ora | 15 min |
| Modifica utenti (per admin) | 30/ora | 15 min |

### Audit trail

- **Storico stati** con tracciatura di chi, quando e perché per ogni transizione
- **Log invii PEC** con destinatari, oggetto, esito, messaggio di errore e tipo (reale o simulato)
- **Allegati obbligatori nell'invio PEC**: se un allegato registrato non è valido o non è più disponibile sul server, la PEC non viene inviata, lo stato non cambia e il protocollo non viene consumato
- **Export CSV tracciato**: ogni export registra una voce nella tabella `AuditLog` con utente, timestamp, filtri applicati e numero di record esportati (registro GDPR art. 30). La voce non è legata a nessuna singola segnalazione
- **Transizioni forzate** dall'admin esplicitamente marcate nello storico
- **Eventi automatici** (cron job, transizioni di sistema) registrati con `userId=null`; la nota identifica l'origine (per esempio `[CRON AUTOMATICO]`)
- **Update atomiche** in `approva`, `rifiuta`, `cambia-stato` e DELETE segnalazioni, con clausola WHERE sullo stato corrente: prevengono le race condition e rispondono 409 Conflict se lo stato è cambiato nel frattempo

### Riconciliazione degli invii PEC

Un tentativo reale viene registrato come `in_corso` prima del collegamento SMTP. Un errore o una risposta parziale produce `incerto`; se la scrittura del log fallisce, resta `in_corso`. L'esito `ok` indica che il server SMTP ha accettato tutti i destinatari, non che siano arrivate le ricevute PEC. Tutti e tre gli esiti bloccano i nuovi invii automatici, anche dopo la scadenza del lease di 10 minuti. Non cancellare il log e non interpretare un timeout SMTP come prova che nulla sia stato spedito.

Procedura riservata all'amministratore e a chi gestisce la casella PEC:

1. Fermare l'applicazione e gli altri mittenti, conservare una copia dei dati e identificare la pratica, il protocollo e **tutti** i tentativi reali. Per controllare i record con `psql`, sostituire `ID_PRATICA` con l'identificativo reale:

   ```sql
   SELECT id, stato, "numeroProtocollo", "dataInvio", "invioPecLockAt"
   FROM segnalazioni WHERE id = 'ID_PRATICA';
   SELECT id, esito, destinatari, "messaggioErrore", timestamp
   FROM log_invii_pec
   WHERE "segnalazioneId" = 'ID_PRATICA' AND tipo = 'reale'
   ORDER BY timestamp;
   ```

2. Confrontare protocollo, destinatari e ora con la cartella Inviati del gestore, le ricevute di accettazione e le ricevute di consegna per ciascun destinatario. Conservare gli identificativi delle ricevute nel registro operativo. Se anche un solo destinatario ha ricevuto il messaggio o l'esito non è certo, **non autorizzare un nuovo invio integrale**: richiedere una verifica al gestore PEC.
3. Soltanto se è accertata la mancata spedizione verso **tutti** i destinatari, un amministratore di database può, con l'app ferma, contrassegnare il tentativo esaminato come `non_inviata` in una transazione. Controllare che la pratica sia ancora `approvata`, che non esistano altri tentativi reali con esito `in_corso`, `incerto` o `ok` e che l'aggiornamento riguardi esattamente una riga. Registrare in `storico_stati` il riferimento alle verifiche, senza alterare il protocollo già assegnato. Dopo il riavvio si può riprovare l'invio usando lo stesso protocollo. Se un lease è ancora attivo, attendere che scada invece di rimuoverlo durante un invio.
4. Se l'invio è confermato ma lo stato della pratica è ancora `approvata`, **non reinviare**: con l'app ferma, un amministratore di database deve registrare atomicamente l'esito `ok`, la transizione a `inviata`, `dataInvio` e una voce di `storico_stati`, verificando protocollo e stato. Se l'esito è parziale o resta incerto, non cambiare lo stato in `inviata` senza definire con il titolare come gestire i destinatari mancanti.

Non esiste un endpoint per forzare questi interventi: la verifica documentale e la registrazione manuale sono intenzionali. Conservare un backup e una traccia delle query di riconciliazione. In caso di dubbio lasciare la pratica bloccata e consultare il gestore PEC.

### GDPR: anonimizzazione automatica

- **Retention 10 anni**: in conformità con PRIVACY.md e con GDPR art. 5, paragrafo 1, lettera e ("limitazione della conservazione"), le segnalazioni chiuse da più di `RETENTION_SEGNALAZIONI_ANNI` anni (default 10) vengono anonimizzate
- **Calcolo della retention basato su `dataChiusura`**: il job usa il campo `dataChiusura` (registrato quando lo stato transita a `chiusa_positiva` o `chiusa_negativa`) per calcolare la finestra dalla chiusura, non `updatedAt`, che si aggiorna a ogni modifica. Solo per le segnalazioni con `dataChiusura=null` usa `updatedAt` come approssimazione.
- **Anonimizzazione, non cancellazione**: il record viene preservato per audit e statistica; il collegamento diretto al volontario e i campi liberi vengono rimossi: `volontarioId=null`, `indirizzoVia="[ANONIMIZZATA]"`, `cap=null`, `latitudine` e `longitudine=null`, `descrizioneLibera="[ANONIMIZZATA]"`, `notaAltroTipologia=null`, `notaAltroProblema=null`, `testoIntroduttivoPec=null`, `pecCcAggiuntive=null`, `notaRifiuto=null`, `destinatarioNome=null`, `oggettoPec=null`, `nomeEsercizio=null`. L'oggetto e gli eventuali messaggi di errore dei log PEC sono anonimizzati; i destinatari degli invii reali restano per prova dell'invio, come indicato in PRIVACY.md.
- **Allegati eliminati**: i file fisici e i record in `allegato` vengono rimossi (le immagini potrebbero contenere dati identificativi)
- **Audit trail**: ogni anonimizzazione registra una voce in `storico_stati` con nota esplicita
- **Trigger**: tramite cron job giornaliero (`scripts/cron-jobs.ts`) oppure tramite API `POST /api/reminder` con `{ action: "gdpr-anonymize" }` (solo admin)
- **Schema database**: `Segnalazione.volontarioId` è nullable per supportare l'anonimizzazione; `canViewSegnalazione()` nega la visibilità al volontario per le segnalazioni anonimizzate
- **Logica centralizzata**: la logica di anonimizzazione è in `src/lib/cron-utils.ts` (funzione `anonimizzaSegnalazioniGdpr`), condivisa tra cron job automatico e API manuale per evitare disallineamenti
- **Pulizia file orfani**: il cron job esegue anche `cleanupFileOrfani()`, che rimuove i file in `storage/uploads/` senza record corrispondente nel database (orfani da cancellazioni asincrone fallite)

### Monitoring sicuro (endpoint /api/metrics)

- **Endpoint Prometheus** in `/api/metrics` espone metriche di runtime (uptime, memoria RSS/heap/external, CPU user/system, versione Node) in formato `text/plain` compatibile con lo scrape di Prometheus
- **Autenticazione duale**: supporta due modalità mutuamente esclusive:
  - **Token statico** (raccomandato per Prometheus): se la variabile `METRICS_TOKEN` è impostata, l'endpoint accetta solo `Authorization: Bearer <token>`. Il token nell'URL (`?token=`) non è accettato, perché i parametri URL finiscono nei log dei reverse proxy e nella cronologia del browser. Il confronto è timing-safe per prevenire timing attack sul token. Credenziali assenti o errate ricevono 401 con `WWW-Authenticate: Bearer realm="metrics"`
  - **Cookie di sessione admin** (per ispezione manuale dal browser): se `METRICS_TOKEN` non è impostata, richiede il cookie di sessione di un utente admin. Sessione assente: 401; utente senza permesso: 403
- **Cache-Control: private, no-store**: le metriche non sono mai in cache, per garantire dati aggiornati a ogni scrape
- **Nessun dato personale esposto**: le metriche contengono solo dati di runtime del processo Node, mai dati utente o contenuti delle segnalazioni

### 2FA TOTP (RFC 6238)

- **Libreria**: `src/lib/totp.ts` con `otpauth` per generare e verificare codici TOTP conformi a RFC 6238
- **Setup a due passaggi** (anti-lockout): al primo setup il secret viene salvato in `User.totpSecret`; il login richiede il 2FA solo dopo che `User.totpVerifiedAt` è valorizzato. Un setup iniziale non completato può essere annullato senza codice.
- **Rotazione senza interruzioni**: con il 2FA attivo, `setup` richiede `currentToken` del fattore attuale e salva il nuovo secret in `User.totpPendingSecret`. Il vecchio fattore rimane obbligatorio al login finché `verify` non conferma il nuovo codice e sostituisce atomicamente il secret attivo. Un setup abbandonato non disattiva il 2FA.
- **Endpoint dedicato**: `POST /api/auth/2fa` con azioni `setup`, `verify` e `disable`. `disable` richiede un codice del fattore corrente se già attivo. La risposta di `setup`, che contiene il nuovo secret, usa `Cache-Control: private, no-store`.
- **Gate nel login**: `POST /api/auth/login` richiede il codice TOTP solo se `totpSecret` e `totpVerifiedAt` sono entrambi valorizzati, con risposta `requiresTotp: true` per guidare il client.
- **Anti-replay e concorrenza**: ogni codice accettato viene registrato insieme al secret verificato con una UPDATE condizionata; dopo la rotazione il codice del nuovo fattore usato per `verify` non può essere riutilizzato al login. Se il secret cambia durante l'operazione, il vecchio codice viene rifiutato.
- **Rate limiting**: 5 operazioni 2FA all'ora per utente, per contrastare il brute force sul token di 6 cifre.
- **Segreti redatti nei log**: `totpSecret` e `totpPendingSecret` sono nella lista di redazione di Pino (`src/lib/logger.ts`).

### Account demo (solo build GitHub Pages)

La modalità demo (account dimostrativi di sola visualizzazione, descritti in
`SETUP.md`, sezione 4) è attiva solo quando la variabile pubblica
`NEXT_PUBLIC_CIELOBUIO_DEMO` vale `1` al momento della build. Il flag è
impostato soltanto da `next.config.pages.ts`, la configurazione della build
statica per GitHub Pages.

Nelle altre build (server Docker o installazione manuale) la costante
`DEMO_ABILITATA` vale `false`: `matchDemoAccount` e `getActiveDemoSession`
non riconoscono le credenziali demo né ripristinano una sessione demo salvata
nel browser, e il login accetta solo gli account reali. Il comportamento è
verificato dai test in `src/lib/__tests__/demo-mode-disabilitata.test.ts`.

### Configurazione deploy sicura

- **Firewall obbligatorio**: `ufw deny 3000/tcp` e `HOSTNAME=127.0.0.1` nel servizio systemd, per impedire l'accesso diretto a Node bypassando Caddy (vedi SETUP.md, sezione 8.8.1)
- **Binding a loopback**: con `HOSTNAME=127.0.0.1` il server Node ascolta su `127.0.0.1:3000`, raggiungibile solo tramite Caddy (reverse proxy)
- **HTTPS terminato da Caddy** con certificato Let's Encrypt automatico
- **Caddy imposta `X-Real-IP`** con `{remote_host}`, sovrascrivendo l'header inviato dal client: il rate limiting per IP usa solo questo valore. `X-Forwarded-For` non viene mai letto dall'applicazione, perché il client può falsificarlo

### Informazioni di produzione

In produzione verificare:
- `NODE_ENV=production` nell'ambiente del servizio (disabilita il logging delle query Prisma: restano attivi solo i log di errore e di avviso)
- `npm run start`, che esegue `node .next/standalone/server.js` (non `next dev`); la variabile `NODE_ENV=production` va impostata nell'ambiente, non dal comando
- `NEXT_PUBLIC_BASE_URL` configurato (per la verifica Origin anti-CSRF, fail-closed se manca)
- `PEC_SMTP_*` configurati (per l'invio PEC e le notifiche reali)
- HTTPS terminato dal reverse proxy (Caddy) con certificato valido
- Firewall configurato (`ufw deny 3000/tcp`)
- `HOSTNAME=127.0.0.1` nel servizio systemd
- Backup automatici giornalieri (`scripts/backup-db.ts`) schedulati via cron
- Cron job di manutenzione giornaliero (`scripts/cron-jobs.ts`) per la pulizia delle sessioni, le transizioni automatiche e l'anonimizzazione GDPR

## Test di sicurezza informatica (OWASP Top 10)

Il progetto include una suite di **78 test di sicurezza** in `src/__tests__/security-attack-suite.test.ts` che verificano l'efficacia delle difese contro i principali vettori di attacco. Ogni test esegue verifiche reali (ispezione del sorgente o test comportamentale), non placeholder documentali:

| Categoria OWASP | Test | Ambito |
|---|---|---|
| A01: Broken Access Control | 5 | visibilità per ruolo, fail-closed per referenti senza territorio, sentinella `__NEVER_MATCH__`, accesso admin totale |
| A02: Cryptographic Failures | 4 | bcrypt cost 12, rifiuto di hash errati, prefisso `__Host-` del cookie, flag `HttpOnly`/`SameSite=Strict`/`Secure` |
| A03: Injection | 10 | SQL injection (3: validazione Zod, nessun `$queryRawUnsafe`), email header injection (5: CRLF, limite di 5 CC, formato email), CSV formula injection (2) |
| A04: Insecure Design | 6 | race condition (2: retry su collisioni P2002, `updateMany` con clausola WHERE sullo stato), pacchetto probatorio e upload solo in bozza (4) |
| A05: Security Misconfiguration | 8 | security headers (5: CSP strict, HSTS, `X-Frame-Options`, `nosniff`, `poweredByHeader`), CSRF Origin/Referer e fail-closed senza `NEXT_PUBLIC_BASE_URL` (3) |
| A07: Authentication Failures | 7 | escalation dei blocchi e doppio rate limit IP+email (2), session rotation, invalidazione da admin, timing side-channel, gate TOTP nel login (5) |
| A08: Software and Data Integrity | 10 | path traversal e `path-guard` (6), magic bytes JPEG e WebP (2), limiti di 4 allegati e 10 MB (2) |
| A09: Logging and Monitoring | 4 | storico stati, export CSV con autenticazione e filtro territoriale, eventi automatici con `userId=null`, logger Pino al posto di `console.*` nelle route API |
| A10: SSRF | 2 | nessuna route o libreria server usa `fetch` verso URL forniti dall'utente; l'unico collegamento in uscita è verso il server SMTP configurato (`PEC_SMTP_HOST`) |
| XSS | 2 | HTML escaping in `generaHtmlLettera`, nessun `dangerouslySetInnerHTML` nei componenti (l'unico uso è lo script inline del tema in `src/app/layout.tsx`, autorizzato dal nonce CSP) |
| Demo Mode | 2 | blocco delle azioni mutative in demo, riconoscimento delle sessioni demo |
| GDPR | 5 | retention configurabile, anonimizzazione PII e cancellazione dei file fisici, retention basata su `dataChiusura`, campo `dataChiusura` nello schema, `segnalazionePrecedenteId` come foreign key con `onDelete: SetNull` |
| TOTP 2FA | 7 | generazione del secret in Base32, URI `otpauth://`, casi limite di `verifyTotp`, round-trip TOTP, route `/api/auth/2fa`, gate TOTP nel login |
| Backup encryption | 2 | cifratura di DB e allegati fisici, AES-256-GCM con IV casuale e auth tag |
| Metrics auth | 1 | `/api/metrics` accetta il token statico via `Authorization: Bearer` con confronto timing-safe |

Esecuzione della suite:

```bash
npm run test -- src/__tests__/security-attack-suite.test.ts
```

## Segnalazione vulnerabilità

Se scopri una vulnerabilità di sicurezza, segnalala in privato a:

**fabiot2801@gmail.com**

Non aprire una issue pubblica su GitHub per vulnerabilità di sicurezza. L'obiettivo è rispondere entro 48 ore con:
- conferma di ricezione
- valutazione iniziale del rischio
- piano di risoluzione e tempistiche

In alternativa alla posta elettronica si può usare la segnalazione privata di GitHub: https://github.com/Ft2801/CieloBuio-Segnalazioni/security/advisories/new

Il sito pubblica anche `/.well-known/security.txt` (RFC 9116), con i contatti e la data di scadenza del documento, che viene rinnovata ogni anno.

## Script di installazione delle dipendenze

Gli script di installazione dei pacchetti di terze parti (`preinstall`, `install`, `postinstall`) eseguono codice sulla macchina durante `npm ci`. Il progetto li autorizza in modo esplicito tramite il campo `allowScripts` di `package.json`: uno script non approvato non viene eseguito. Le scelte attuali sono:

| Pacchetto | Stato | Motivo |
|---|---|---|
| `@prisma/engines@7.10.1` | approvato | scarica lo schema engine necessario a `prisma migrate deploy` |
| `prisma@7.10.1` | approvato | lo script di preinstallazione verifica la compatibilità con la versione di Node.js in uso |
| `esbuild@0.28.2` | approvato | verifica e collega il binario nativo della piattaforma, usato da `tsx` per eseguire gli script TypeScript |
| `unrs-resolver` | rifiutato | lo script (`napi-postinstall`) scarica un binding nativo dal registry solo se il pacchetto opzionale della piattaforma manca. Su Linux x64 (glibc e musl) il pacchetto è installato come dipendenza opzionale, quindi lo script non compie alcuna azione: rifiutarlo riduce la superficie di esecuzione senza effetti sul funzionamento |

Quando un aggiornamento introduce un nuovo script, npm lo segnala. Prima di approvarlo (`npm approve-scripts`) o rifiutarlo (`npm deny-scripts`) si legge il codice dello script, si verifica se scarica risorse dalla rete e si aggiorna questa tabella.

## Catena di fornitura del software

- **Lockfile completo**: `package-lock.json` registra ogni pacchetto (1006 voci) con il relativo hash `integrity`. L'installazione avviene con `npm ci`, che usa esattamente le versioni del lockfile e verifica gli hash prima di eseguire qualsiasi script.
- **Firme dei pacchetti**: la CI esegue `npm audit signatures`, che verifica le firme dei pacchetti installati rispetto al registry npm.
- **Versioni pinnate per le dipendenze transitive critiche**: il campo `overrides` di `package.json` fissa `browserslist`, `fast-copy` e `baseline-browser-mapping` a versioni precise, e allinea i plugin ESLint alla stessa istanza di `eslint`.
- **Pin dei runtime WASM di Tailwind**: `@emnapi/core`, `@emnapi/runtime` e `@emnapi/wasi-threads` sono dichiarati come devDependencies con la stessa versione del lockfile, così il binding WASM opzionale di Tailwind (`@tailwindcss/oxide-wasm32-wasi`) usa le copie di primo livello invece di copie annidate duplicate. Su Linux x64 quel binding non viene caricato.
- **Licenze**: `npm run licenze` (eseguito in CI e in `npm run check`) blocca le dipendenze di produzione con licenze non ammesse. Le tre eccezioni (libvips LGPL, dati caniuse CC-BY e elkjs EPL) sono elencate in CONTRIBUTING.md.
- **Runtime dichiarato**: `engines` richiede Node.js `>=24.0.0`, `.nvmrc` indica la versione 24 e `.npmrc` abilita `engine-strict`, così npm rifiuta le installazioni con versioni incompatibili.
- **Immagini Docker fissate a digest**: `node:24-alpine` (Dockerfile), `postgres:16-alpine` e `caddy:2-alpine` (docker-compose) sono referenziate per digest `sha256`, non per tag mutabili. Le immagini usate dai job CI (actionlint e Caddy) seguono la stessa regola.
- **Action GitHub fissate a SHA**: ogni action dei workflow è referenziata con lo SHA del commit e il tag come commento. Ogni workflow dichiara permessi minimi a livello di workflow (`contents: read`), con permessi aggiuntivi solo dove servono, come il deploy su GitHub Pages. Il checkout non conserva le credenziali (`persist-credentials: false`).
- **Audit e scansioni**: la CI esegue `npm audit --audit-level=low` a ogni push e pull request; Trivy analizza l'immagine Docker (CRITICAL e HIGH).
- **Analisi statica**: ESLint con eslint-plugin-security; hadolint sul Dockerfile, shellcheck sugli script e actionlint sui workflow.
- **Immagine minimale**: la build Docker è multi-stage. Lo stage finale contiene solo l'output di `next build` e le dipendenze di produzione (`npm prune --omit=dev`), ed esegue il processo con l'utente non privilegiato `nextjs` (UID 1001). L'npm incluso nell'immagine base è sostituito dalla versione 11.21.1, con undici 6.29.1 e brace-expansion 5.0.12: npm esegue i comandi di manutenzione (`db:migrate`, `db:seed`, `cron:reminder`), e il build verifica le versioni minime.
- **Script di terze parti**: solo gli script elencati in `allowScripts` vengono eseguiti, secondo la tabella sopra.

## Responsabilità operativa

### Variabili d'ambiente di sicurezza

Le seguenti variabili d'ambiente controllano funzionalità di sicurezza avanzate:

| Variabile | Descrizione | Default |
|---|---|---|
| `METRICS_TOKEN` | Token statico per l'endpoint `/api/metrics` (compatibile con Prometheus via `Authorization: Bearer <token>`). Se non impostata, l'endpoint richiede il cookie di sessione admin (non compatibile con Prometheus). **In produzione: generare con `openssl rand -hex 32`**. | non impostata (fallback al cookie admin) |
| `BACKUP_ENCRYPTION_KEY` | Chiave Base64 di 32 byte. **Obbligatoria** per creare e ripristinare i backup: ogni file è cifrato con AES-256-GCM. Conservarla separata dai backup. | nessuno (senza chiave il backup non viene creato) |

### Responsabilità dell'amministratore di sistema

1. **Backup giornalieri**: verificare che il cron job di backup sia attivo e che i backup siano ripristinabili (testare il ripristino periodicamente)
2. **Rotazione backup**: retention automatica di 30 giorni; verificare che la directory `backups/` non cresca indefinitamente
3. **Aggiornamenti di sicurezza**: tenere aggiornati il sistema operativo, Node.js, Caddy e tutte le dipendenze npm (`npm audit` periodico)
4. **Monitoraggio log**: verificare periodicamente i log di Caddy e dell'app (`journalctl -u cielobuio-segnalazioni`)
5. **Gestione account admin**: creare e rimuovere admin secondo il principio del minimo privilegio, monitorando gli accessi sospetti
6. **Configurazione SMTP PEC**: verificare periodicamente che le credenziali SMTP siano valide e che gli invii PEC non falliscano
7. **Conformità GDPR**: rispondere alle richieste dei diritti dell'interessato (accesso, rettifica, cancellazione, portabilità) entro 30 giorni, vedi PRIVACY.md

## Minimizzazione dei dati e concorrenza

- **Dettaglio segnalazione**: la risposta di `GET /api/segnalazioni/{id}` contiene per il volontario e per il referente approvatore solo identificativo e nome. PEC, e-mail, indirizzo, firma, `passwordHash` e segreti TOTP non vengono mai trasmessi con il dettaglio.
- **Invio PEC**: un lease persistito nel database (campi `invioPecLockToken` e `invioPecLockAt`) impedisce due invii concorrenti della stessa segnalazione, anche con più istanze dell'applicazione. Un lease più vecchio di 10 minuti è considerato orfano (crash del processo) e può essere riacquisito.
- **Rate limiting di login**: i contatori dei tentativi sono in memoria del processo. Il deploy previsto è una singola istanza dell'applicazione dietro Caddy.

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
Repository: https://github.com/Ft2801/CieloBuio-Segnalazioni
Contatto sicurezza: fabiot2801@gmail.com
