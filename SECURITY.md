# Sicurezza

Il progetto CieloBuio Segnalazioni è stato sottoposto a un audit di sicurezza metodico e completo sull'intero codebase. Una suite di **80 test di sicurezza informatica** (`src/__tests__/security-attack-suite.test.ts`) verifica l'efficacia delle difese contro i vettori di attacco OWASP Top 10. Questa pagina documenta le misure implementate, i test di sicurezza eseguiti e le responsabilità operative.

## Misure di sicurezza implementate

### Autenticazione e sessioni

- **Password hashate** con bcrypt cost factor 12 (raccomandazione OWASP 2025)
- **Password policy rafforzata**: minimo 12 caratteri, almeno una maiuscola, una minuscola, una cifra, un carattere speciale, non più di 2 caratteri consecutivi uguali
- **Sessioni via cookie HTTP-only** con flag `HttpOnly`, `SameSite=Strict`, `Secure` (in produzione)
- **Prefisso `__Host-` sul cookie di sessione in produzione** (`__Host-cb_session`): impone Path=/, Secure, no Domain. Previene session fixation via subdomain compromesso
- **Durata sessione**: 8 ore (ridotta da 7 giorni per minimizzare la finestra di rischio)
- **Session rotation**: al login tutte le sessioni precedenti dello stesso utente vengono invalidate (prevenzione session fixation)
- **Invalidazione sessioni admin**: cambio password/ruolo/territorio da admin distrugge tutte le sessioni attive dell'utente (prevenzione persistenza dopo compromissione)
- **Rate limiting login doppio** (per IP **e** per email): 3 tentativi falliti consecutivi per ognuno, con escalation dei blocchi:
  - 1° blocco: 5 minuti
  - 2° blocco (entro 1 ora): 15 minuti
  - 3° blocco (entro 1 ora): 1 ora
  - 4° e successivi: 24 ore
- Il limite per email previene il bypass via header `X-Forwarded-For` spoofabile
- **Pulizia automatica sessioni scadute** via cron job

### Autorizzazione (RBAC + competenza territoriale)

- **Tre ruoli**: volontario, referente territoriale (provinciale o regionale), amministratore
- **Visibilità dati per ruolo**:
  - volontario: solo le proprie segnalazioni
  - referente_provinciale: segnalazioni della propria provincia (richiede `provinciaId` assegnato)
  - referente_regionale: segnalazioni della propria regione (richiede `regioneId` assegnato)
  - admin: tutte
- **Fail-closed per referenti senza territorio**: un referente con `provinciaId=null` o `regioneId=null` non vede alcuna segnalazione
- **Competenza territoriale verificata** su ogni endpoint che agisce su una segnalazione specifica
- **Helper centralizzato** `canViewSegnalazione()` e `hasTerritorialCompetence()` per evitare drift tra endpoint
- **Segnalazioni anonimizzate** (post-retention GDPR, `volontarioId=null`): non visibili al volontario, restano visibili ad admin e referenti territoriali per audit

### Prevenzione IDOR (Insecure Direct Object Reference)

Tutti gli endpoint `/api/segnalazioni/[id]/*` verificano che l'utente abbia diritto di accedere alla risorsa prima di restituirla o modificarla:
- GET dettaglio segnalazione
- PUT modifica segnalazione: bloccata dopo `approvata`; provinciaId/regioneId derivano sempre server-side dal comune; validazione Zod anti-CRLF su tutti i campi PEC
- DELETE elimina bozza
- POST approva / rifiuta / invia-pec / simula-pec / cambia-stato (tutti usano `hasTerritorialCompetence` fail-closed)
- GET lettera PEC (con e senza allegati)
- GET download allegato
- DELETE allegato: richiede diritto di modifica; il proprietario può eliminare solo in stato "bozza"; i referenti in "bozza" e "in_revisione"
- Upload allegato: bloccato dopo `approvata`

### Business logic: protezione del pacchetto probatorio

- **DELETE allegati**: il volontario proprietario può eliminare allegati **solo** in stato `bozza`. Una volta inviata in revisione al referente (stato `in_revisione`), il pacchetto probatorio è "congelato" e non può più essere alterato dal volontario. I referenti con competenza territoriale e gli admin mantengono l'accesso in `bozza` e `in_revisione` (es. per rimuovere contenuto inappropriato prima dell'approvazione). Questo previene che un volontario rimuova prove fotografiche già visionate dal referente, alterando cosa verrà effettivamente inviato via PEC
- **Coerenza con PUT segnalazioni**: la stessa restrizione si applica alle modifiche PUT (il volontario non può modificare in `in_revisione`, solo il referente può)
- **Upload bloccato dopo approvazione**: dopo `approvata`, nessun nuovo allegato può essere caricato (previene che allegati mai revisionati dal referente vengano inclusi nella PEC)

### Protezione contro XSS

- **HTML escaping** di tutti i contenuti generati dall'utente nella lettera PEC (testo, descrizione libera, nome originale degli allegati)
- **Escaping defense-in-depth** per i campi interpolati fuori dal `<pre>` principale in `generaHtmlLettera`: `pecArpaRegionale`, `numeroProtocollo` vengono escapati con `escapeHtml`
- **Content-Security-Policy** strict: `default-src 'self'; script-src 'self'; frame-ancestors 'none'`
- **X-Content-Type-Options: nosniff** su tutte le risposte
- **Validazione input** con zod su tutti gli endpoint di creazione/modifica

### Protezione contro CSRF

- **Cookie SameSite=Strict** (blocca cross-site requests)
- **Verifica Origin/Referer** sui metodi state-changing (POST, PUT, DELETE, PATCH) nel middleware. La variabile `NEXT_PUBLIC_BASE_URL` è obbligatoria in produzione: se mancante, il check è fail-closed (503 su tutte le mutative)
- **Operazioni mutative solo via POST** (non GET): la route `/api/reminder` accetta `action` solo via POST
- **Restrizione dev hosts**: in produzione gli host `localhost:3000`/`127.0.0.1:3000` non sono accettati come Origin valide

### Protezione contro email header injection

- **Validazione zod** di tutti i campi che finiscono nelle email (oggetto PEC, testo introduttivo, CC aggiuntive, destinatario)
- **Regex anti-CRLF** `^[^\r\n]*$` su tutti i campi header
- **Validazione formato email** di tutti gli indirizzi PEC in copia (max 5)
- **Strip controlli** difensivo prima di passare a nodemailer

### Protezione contro CSV/Formula Injection

L'export CSV (`/api/segnalazioni/export`) sanifica ogni campo che inizia con `=`, `+`, `-`, `@`, `\t`, `\r` prefissandolo con un apostrofo neutro. Questo previene l'esecuzione di formule malevole (es. `=HYPERLINK(...)`, `=cmd|...`) quando il CSV viene aperto in Excel/LibreOffice.

### Backup sicuro

Lo script `scripts/backup-db.ts` esporta le tabelle in JSON con redazione dei dati sensibili:
- `user.passwordHash` è escluso dal backup (resta solo nel DB attivo)
- `sessione.token` è troncato a 8 caratteri con suffisso `...REDACTED`
- I file fisici degli allegati (`storage/uploads/`) vengono copiati nel backup per un ripristino completo
- La directory di backup (`backups/`) è esclusa dal repository (`.gitignore`) e va protetta a livello di filesystem sul server di produzione

### File upload sicuro

- **Directory di storage privata** (`/storage/uploads/`, non sotto `/public`)
- **Download autenticato** via route `/api/allegati/[id]/download` con verifica visibilità
- **Whitelist estensioni**: JPEG, PNG, WebP, PDF
- **Verifica magic bytes** anti-spoofing (il contenuto deve corrispondere all'estensione). Per WebP verifica sia "RIFF" (byte 0-3) sia "WEBP" (byte 8-11)
- **Dimensione massima**: 10 MB per file
- **Limite 4 allegati** per segnalazione (sempre, indipendentemente dal tipo)
- **Path traversal protection** a 2 livelli (validazione segmenti + resolve normalizzato) centralizzata in `src/lib/path-guard.ts`: ogni route che manipola file di allegati (upload, download, preview, DELETE allegati, lettera, invia-pec, DELETE segnalazione, gdpr.ts) usa la stessa libreria `parseUrlStorageSicuro` + `risolviPathAllegatoSicuro`. La validazione `isSafePathSegment` blocca `..`, `/`, `\`, `\0` in ogni segmento del path. Il check `startsWith(uploadsRoot + path.sep)` è omesso come ridondante: con segmenti sicuri, `path.resolve` restituisce sempre un path dentro `UPLOADS_ROOT` per costruzione.
- **Filename sanitizzato** in Content-Disposition (no caratteri speciali)
- **Rate limiting**: 20 upload/minuto per utente
- **Eliminazione allegati**: richiede diritto di modifica (proprietario in bozza o referente/admin in bozza/in_revisione con competenza territoriale)

### Header di sicurezza globali

Tutte le risposte includono via middleware:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (non include `preload` per evitare lock-in permanente HTTPS)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), interest-cohort=()`
- `X-Powered-By` disabilitato (`poweredByHeader: false` in `next.config.ts`)

### Rate limiting

| Endpoint | Limite | Blocco |
|---|---|---|
| Login (per IP) | 3 tentativi | 5 min, 15 min, 1 ora, 24 ore (escalation) |
| Login (per email) | 3 tentativi | 5 min, 15 min, 1 ora, 24 ore (escalation) |
| Creazione segnalazioni (per utente) | 20/ora | 30 min |
| Invio PEC reale (per utente) | 5/ora | 1 ora |
| Simulazione PEC (per utente) | 10/ora | 30 min |
| Upload allegati (per utente) | 20/minuto | 1 min |
| Export CSV (per utente) | 5/ora | 15 min |
| Creazione utenti (per admin) | 30/ora | 15 min |
| Modifica utenti (per admin) | 30/ora | 15 min |
| Operazioni di manutenzione globali | admin-only | n/a |

### Audit trail

- **Storico stati** con tracciatura di chi, quando, perché per ogni transizione
- **Log invii PEC** con destinatari, oggetto, esito, messaggio errore, tipo (reale/demo/simula)
- **Export CSV tracciato**: ogni export registra una voce nello `storico_stati` con utente, timestamp, filtri applicati e numero di record esportati (audit trail GDPR art. 30)
- **Transizioni forzate** dall'admin esplicitamente marcate nello storico
- **Eventi automatici** (cron job, transizioni di sistema) registrati con `userId=null`; la nota identifica l'origine (es. `[CRON AUTOMATICO]`)
- **Update atomiche** in `approva`/`rifiuta`/DELETE segnalazioni con clausola WHERE su stato corrente: prevengono race condition, rispondono 409 Conflict se lo stato è cambiato concorrentemente

### GDPR: anonimizzazione automatica

- **Retention 10 anni**: in conformità con PRIVACY.md e GDPR art. 5.1.e ("limitazione della conservazione"), le segnalazioni più vecchie di `RETENTION_SEGNALAZIONI_ANNI` (default 10) vengono anonimizzate
- **Calcolo retention basato su `dataChiusura`**: il job usa il campo `dataChiusura` (registrato quando lo stato transita a `chiusa_positiva`/`chiusa_negativa`) per calcolare la finestra reale di 10 anni dalla chiusura, non `updatedAt` (che si aggiorna ad ogni modifica e posticiperebbe falsamente la retention). Fallback su `updatedAt` solo per segnalazioni chiuse prima dell'introduzione del campo.
- **Anonimizzazione, non cancellazione**: il record viene preservato per audit/statistica, ma i PII vengono rimossi: `volontarioId=null`, `indirizzoVia="[ANONIMIZZATA]"`, `cap=null`, `latitudine/longitudine=null`, `descrizioneLibera="[ANONIMIZZATA per scadenza retention]"`, `notaAltroTipologia=null`, `notaAltroProblema=null`, `testoIntroduttivoPec=null`, `pecCcAggiuntive=null`, `nomeEsercizio=null`
- **Allegati eliminati**: i file fisici e i record in `allegato` vengono rimossi (le immagini potrebbero contenere PII identificativi)
- **Audit trail**: ogni anonimizzazione registra una voce in `storico_stati` con nota esplicita
- **Trigger**: via cron job giornaliero (`scripts/cron-jobs.ts`) o via API `POST /api/reminder` con `{ action: "gdpr-anonymize" }` (admin-only)
- **Schema database**: `Segnalazione.volontarioId` è nullable per supportare l'anonimizzazione; `canViewSegnalazione()` nega la visibilità al volontario per le segnalazioni anonimizzate
- **Logica centralizzata**: la logica di anonimizzazione è in `src/lib/cron-utils.ts` (funzione `anonimizzaSegnalazioniGdpr`), condivisa tra cron job automatico e API manuale per evitare drift
- **Pulizia file orfani**: il cron job esegue anche `cleanupFileOrfani()` che rimuove i file in `storage/uploads/` senza record DB corrispondente (orfani da `rm()` asincroni falliti)

### Monitoring sicuro (endpoint /api/metrics)

- **Endpoint Prometheus** in `/api/metrics` espone metriche di runtime (uptime, memoria RSS/heap/external, CPU user/system, versione Node) in formato `text/plain` compatibile con Prometheus scrape
- **Autenticazione duale**: supporta due modalità mutuamente esclusive:
  - **Token statico** (raccomandato per Prometheus): se `METRICS_TOKEN` env var è impostata, accetta `Authorization: Bearer <token>` o `?token=<token>`, con confronto **timing-safe** per prevenire timing attack sul token
  - **Cookie sessione admin** (per ispezione browser manuale): se `METRICS_TOKEN` non è impostata, richiede il cookie di sessione di un utente admin
- **Cache-Control: no-store**: le metriche non sono mai cached, per garantire freschezza dei dati a ogni scrape
- **Nessun PII esposto**: le metriche contengono solo dati di runtime del processo Node, mai dati utente o contenuti di segnalazioni

### 2FA TOTP (RFC 6238)

- **Libreria**: `src/lib/totp.ts` con `otpauth` per generare e verificare codici TOTP conformi a RFC 6238
- **Setup a 2 step** (anti-lockout): il secret viene salvato in `User.totpSecret` ma il 2FA è attivo solo dopo che `User.totpVerifiedAt` è valorizzato. Questo previene il lockout accidentale se l'utente avvia il setup senza completare la verifica (es. chiude la pagina prima di scansionare il QR code).
- **Endpoint dedicato**: `POST /api/auth/2fa` con azioni `setup`/`verify`/`disable`
- **Anti-disarm silenzioso**: per rigenerare il secret quando il 2FA è già attivo, è richiesto il codice TOTP corrente (`currentToken`), prevenendo che un attaccante con sessione rubata possa disarmare il 2FA senza conoscere il vecchio codice
- **Gate nel login**: `POST /api/auth/login` richiede il codice TOTP solo se `totpSecret AND totpVerifiedAt` sono valorizzati, con risposta `requiresTotp: true` per guidare il client
- **Rate limiting**: 5 operazioni 2FA/ora per utente (prevenire brute force sul token di 6 cifre)
- **Secret redatto nei log**: `totpSecret` è nella lista di redazione di Pino (`logger.ts`), mai loggato in chiaro

### Configurazione deploy sicura

- **Firewall obbligatorio**: `ufw deny 3000/tcp` + `HOSTNAME=127.0.0.1` nel servizio systemd per impedire accesso diretto a Node bypassando Caddy (vedi SETUP.md sezione 8.8.1)
- **Binding a loopback**: il server Node ascolta su `127.0.0.1:3000`, raggiungibile solo tramite Caddy (reverse proxy)
- **HTTPS terminato da Caddy** con certificato Let's Encrypt automatico
- **Caddy imposta `X-Forwarded-For`** con `{remote_host}` sovrascrivendo l'header client-side: il rate limiting basato su IP è protetto dal bypass

### Informazioni di produzione

In produzione verificare:
- `NODE_ENV=production` (disabilita Prisma query logging, stack trace dettagliati)
- `next start` (non `next dev`)
- `NEXT_PUBLIC_BASE_URL` configurato (per verifica Origin anti-CSRF, fail-closed se mancante)
- `PEC_SMTP_*` configurati (per invio PEC e notifiche reali)
- HTTPS terminato dal reverse proxy (Caddy) con certificato valido
- Firewall configurato (`ufw deny 3000/tcp`)
- `HOSTNAME=127.0.0.1` nel servizio systemd
- Backup automatici giornalieri (`scripts/backup-db.ts`) schedulati via cron
- Cron job di maintenance giornaliero (`scripts/cron-jobs.ts`) per pulizia sessioni, transizioni automatiche e anonimizzazione GDPR

## Test di sicurezza informatica (OWASP Top 10)

Il progetto include una suite di **75 test di sicurezza** in `src/__tests__/security-attack-suite.test.ts` che verificano l'efficacia delle difese contro i principali vettori di attacco. Ogni test esegue verifiche REALI (ispezione del sorgente o test comportamentale), non placeholder documentali:

| Categoria OWASP | Test | Descrizione |
|---|---|---|
| A01: Broken Access Control | 5 | IDOR prevention, fail-closed per referenti senza territorio, sentinella `__NEVER_MATCH__`, accesso admin totale |
| A02: Cryptographic Failures | 4 | bcrypt cost 12, `__Host-` cookie prefix, flag HttpOnly/SameSite=Strict/Secure, verifyPassword reject |
| A03: Injection | 9 | SQL injection (Prisma parametrizzato, scansione `$queryRawUnsafe`), email header injection (CRLF), CSV formula injection con ispezione sorgente export, zod validation |
| A04: Insecure Design | 6 | Race condition (update atomiche con P2002 retry, updateMany WHERE stato), business logic bypass (pacchetto probatorio, upload post-approvazione, volontario solo in bozza) |
| A05: Security Misconfiguration | 9 | CSP strict, HSTS, X-Frame-Options DENY, nosniff, CSRF Origin/Referer, fail-closed senza BASE_URL, poweredByHeader false (ispezione next.config) |
| A07: Authentication Failures | 9 | Brute force escalation, session fixation (rotation + invalidazione admin), rate limit doppio IP+email, timing side-channel mitigation (sentinel hash), TOTP gate nel login |
| A08: Software/Data Integrity | 10 | Path traversal centralizzato in `path-guard.ts`, parseUrlStorageSicuro (formato attuale e legacy), isSafePathSegment (`..`/`/`/`\\`/`\0`), isValidCuid, randomUUID filename, validazione CUID in upload, coerenza route gemelle, magic bytes (JPEG/WebP), limite 4 allegati centralizzato in types.ts, size max 10MB centralizzato |
| A09: Logging/Monitoring | 4 | Audit trail (storico stati), export CSV con filtro territoriale, eventi automatici cron con userId=null, logger Pino strutturato al posto di `console.*` in 16 route API |
| A10: SSRF | 2 | Scansione sorgente per `fetch(body.*)` e `http.get(body.*)`, verifica nodemailer usa env non input utente |
| XSS | 2 | HTML escaping in `generaHtmlLettera`, scansione componenti per `dangerouslySetInnerHTML` |
| Demo Mode | 2 | Blocco azioni mutative, `isDemoSession` type checking |
| GDPR | 5 | Retention configurabile (comportamentale), anonimizzazione PII + cancellazione file fisici, retention basata su `dataChiusura` (non updatedAt), campo `dataChiusura` nello schema, `segnalazionePrecedenteId` come foreign key con onDelete: SetNull |
| TOTP 2FA | 7 | generateTotpSecret ritorna Base32, generateTotpUri formato otpauth://, verifyTotp edge cases, round-trip TOTP completo, route /api/auth/2fa esposta, login integra TOTP gate |
| Backup encryption | 2 | Cifratura at-rest completa (DB + allegati fisici), AES-256-GCM con IV random e auth tag |
| Metrics auth | 1 | Endpoint /api/metrics supporta token statico per Prometheus con timing-safe comparison |

Esecuzione della suite:

```bash
npm run test -- src/__tests__/security-attack-suite.test.ts
```

## Segnalazione vulnerabilità

Se scopri una vulnerabilità di sicurezza, segnalala privatamente a:

**fabiot2801@gmail.com**

Non aprire una issue pubblica su GitHub per vulnerabilità di sicurezza. Riceverai una risposta entro 48 ore con:
- conferma di ricezione
- valutazione iniziale del rischio
- piano di risoluzione e tempistiche

## Responsabilità operativa

### Variabili d'ambiente di sicurezza

Le seguenti variabili d'ambiente controllano funzionalità di sicurezza avanzate:

| Variabile | Descrizione | Default |
|---|---|---|
| `METRICS_TOKEN` | Token statico per l'endpoint `/api/metrics` (compatibile con Prometheus via `Authorization: Bearer <token>`). Se non impostata, l'endpoint richiede il cookie di sessione admin (non compatibile con Prometheus). **In produzione: generare con `openssl rand -hex 32`**. | non impostata (fallback a cookie admin) |
| `BACKUP_ENCRYPTION_KEY` | Chiave Base64 di 32 byte per cifrare at-rest i backup (AES-256-GCM). Se impostata, cifra sia i metadati DB JSON sia gli allegati fisici in `storage/uploads/`. **In produzione: generare con `openssl rand -base64 32`**. | non impostata (backup in chiaro, sconsigliato in prod) |

### Responsabilità dell'amministratore di sistema

1. **Backup giornalieri**: verificare che il cron job di backup sia attivo e che i backup siano ripristinabili (testare il ripristino periodicamente)
2. **Rotazione backup**: retention 30 giorni automatica, verificare che la directory `backups/` non cresca indefinitamente
3. **Aggiornamenti di sicurezza**: tenere aggiornato il sistema operativo, Node.js, Caddy e tutte le dipendenze npm (`npm audit` periodico)
4. **Monitoraggio log**: verificare periodicamente i log di Caddy (`/var/log/caddy/`) e dell'app (`journalctl -u cielobuio-segnalazioni`)
5. **Gestione account admin**: creare/rimuovere admin secondo il principio del minimo privilegio, monitorare accessi sospetti
6. **Configurazione SMTP PEC**: verificare periodicamente che le credenziali SMTP siano valide e che gli invii PEC non falliscano
7. **Conformità GDPR**: rispondere alle richieste dei diritti dell'interessato (accesso, rettifica, cancellazione, portabilità) entro 30 giorni, vedi PRIVACY.md

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
Repository: https://github.com/Ft2801/CieloBuio-Segnalazioni
Contatto sicurezza: fabiot2801@gmail.com
