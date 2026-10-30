# CieloBuio, sistema di segnalazione impianti di illuminazione non conformi

![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)
![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-red?style=flat-square)
![Status](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwind-css&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1?style=flat-square)
![Nodemailer](https://img.shields.io/badge/Nodemailer-10-22B14C?style=flat-square)
![Caddy](https://img.shields.io/badge/Caddy-2-1F88C0?style=flat-square&logo=caddy&logoColor=white)

![Security](https://img.shields.io/badge/security-hardened-green?style=flat-square&logo=shield&logoColor=white)
![RBAC](https://img.shields.io/badge/authorization-RBAC+territorial-blueviolet?style=flat-square)
![CSRF](https://img.shields.io/badge/CSRF-protected-success?style=flat-square)
![CSP](https://img.shields.io/badge/CSP-strict-success?style=flat-square)
![HSTS](https://img.shields.io/badge/HSTS-enabled-success?style=flat-square)
![bcrypt](https://img.shields.io/badge/bcrypt-cost%2012-orange?style=flat-square)
![Rate Limit](https://img.shields.io/badge/rate%20limit-IP+%20email-yellow?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-ready-purple?style=flat-square&logo=pwa&logoColor=white)
![GDPR](https://img.shields.io/badge/GDPR-oriented-blue?style=flat-square)
![AGPL](https://img.shields.io/badge/copyleft-AGPL--3.0-red?style=flat-square)

![Code Style](https://img.shields.io/badge/code%20style-strict-blue?style=flat-square)
![ESLint](https://img.shields.io/badge/ESLint-passing-brightgreen?style=flat-square)
![Type Check](https://img.shields.io/badge/type%20check-passing-brightgreen?style=flat-square)
![Build](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)
![Vitest](https://img.shields.io/badge/tests-passing-brightgreen?style=flat-square&logo=vitest&logoColor=white)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&logo=vitest&logoColor=white)
![Security Tests](https://img.shields.io/badge/security%20tests-OWASP%20Top%2010-red?style=flat-square&logo=owasp&logoColor=white)
![Italian](https://img.shields.io/badge/lang-Italiano-red?style=flat-square&logo=italy&logoColor=white)

Piattaforma web (PWA) per la segnalazione tramite PEC di impianti di illuminazione pubblici e privati non conformi alle leggi regionali italiane in materia di inquinamento luminoso.

Sviluppata per **CieloBuio, Coordinamento per la protezione del cielo notturno**.

- **Autore**: [Fabio Tempera](https://ft2801.github.io/Portfolio)
- **Anno**: 2026
- **Licenza**: AGPL-3.0-or-later

---

## Indice

1. [Contesto e obiettivo](#contesto-e-obiettivo)
2. [Caratteristiche principali](#caratteristiche-principali)
3. [Stack tecnico](#stack-tecnico)
4. [Architettura](#architettura)
5. [Installazione e avvio](#installazione-e-avvio)
6. [Account dimostrativi](#account-dimostrativi)
7. [Flusso di una segnalazione](#flusso-di-una-segnalazione)
8. [Configurazione dell'invio PEC in produzione](#configurazione-dellinvio-pec-in-produzione)
9. [Sicurezza](#sicurezza)
10. [Qualità del codice e test](#qualità-del-codice-e-test)
11. [Privacy e conformità normativa](#privacy-e-conformità-normativa)
12. [Struttura del progetto](#struttura-del-progetto)
13. [Manutenzione e continuità](#manutenzione-e-continuità)
14. [Contribuire](#contribuire)
15. [Supporto e segnalazioni](#supporto-e-segnalazioni)
16. [Licenza](#licenza)

---

## Contesto e obiettivo

CieloBuio, Coordinamento per la protezione del cielo notturno, necessita di un sistema che permetta a volontari sul territorio di segnalare, tramite PEC, impianti di illuminazione pubblici e, soprattutto, privati non conformi alle leggi regionali italiane.

Il sistema genera automaticamente una lettera di diffida formale (PEC) indirizzata al Comune competente (e, se richiesto, all'ARPA regionale) a partire da:

- dati del luogo (indirizzo, coordinate GPS)
- dati del segnalatore
- riferimenti normativi della regione competente (compilati automaticamente)
- tipologia di non conformità rilevata (da opzioni predefinite + testo libero)
- foto/allegati a supporto

Il progetto è una PWA multi-utente che prevede un flusso di revisione/approvazione da parte di un referente territoriale prima dell'invio effettivo della PEC.

### Vincoli non negoziabili rispettati

- **Stack "boring by design"**: tecnologie mainstream, documentate, con community ampia
- **Codice sorgente e database sempre di proprietà di CieloBuio**
- **Architettura dati separata dalla logica applicativa**: i dati di configurazione vivono in tabelle semplici, editabili da un non programmatore, senza mai richiedere modifiche al codice
- **Motore a regole/flag configurabili, non codice ad hoc per ogni legge regionale**
- **Formato dati sempre esportabile** (CSV apribile con Excel o LibreOffice, con un click)
- **Solo tecnologie open source, preferibilmente con licenze permissive (MIT, Apache 2.0, ISC, BSD); le dipendenze transitive con licenze non permissive (LGPL, EPL, CC-BY) sono elencate in CONTRIBUTING.md e vanno verificate a ogni aggiornamento**

---

## Caratteristiche principali

### Gestione segnalazioni

- Creazione di segnalazioni con indirizzo, GPS, foto (fino a 4 allegati)
- Derivazione automatica: comune → provincia → regione → legge applicabile → PEC del Comune/ARPA
- Numero di protocollo univoco nel formato `YYYYMMGG-REG-PV-NCXX` generato lato server. La data e il conteggio giornaliero seguono il fuso `Europe/Rome`, indipendentemente dal fuso del server.
- Anteprima della lettera PEC stampabile come PDF (via browser)
- Storico completo degli stati con audit trail (chi ha fatto cosa e quando)

### Flusso di approvazione multi-ruolo

- **Volontario**: crea bozze, carica foto, invia al referente per approvazione
- **Referente territoriale** (provinciale o regionale): rivede, corregge, rifiuta con nota o approva; solo dopo approvazione è possibile inviare la PEC
- **Amministratore CieloBuio**: accesso completo, gestione configurazione, archivio nazionale, gestione escalation

### Motore di generazione lettera PEC

- Template con segnaposto basato sul testo già in uso da CieloBuio, da far verificare da un legale prima dell'uso ufficiale
- I riferimenti normativi regionali sono letti dalla tabella `regioni_leggi` e non sono scritti nel codice
- Versione "con ARPA" e "senza ARPA" gestite automaticamente in base al flag
- Generazione PDF via browser (stampa), senza dipendenze da Word/Office

### Invio PEC

- Invio da server via SMTP (configurabile con le credenziali della casella PEC di CieloBuio)
- Distinzione tra "simula spedizione" (anteprima inviata solo al destinatario di controllo) e "invio reale"
- Vincolo tecnico rispettato: i messaggi PEC non supportano il CCN (BCC) verso indirizzi PEC, quindi tutti i destinatari vanno in TO o CC
- Log completo degli invii per tracciabilità
- Invio bloccato se un allegato registrato non è più disponibile sul server: la PEC non parte con allegati mancanti e lo stato della segnalazione non cambia

### Notifiche e reminder

- Vista dedicata per le pratiche in stato "in attesa" da oltre 30 giorni (soglia configurabile)
- Transizione automatica "inviata" verso "in_attesa" dopo N giorni configurabili (default 7), eseguibile via API o cron job
- Notifiche email automatiche (in produzione, via SMTP configurato):
  - al referente territoriale quando una segnalazione viene inviata in revisione
  - al volontario quando la segnalazione viene rifiutata con nota
  - al volontario e al referente quando la PEC viene inviata con successo
- Supporto alla logica di recidiva: una segnalazione può essere collegata a una pratica precedente dello stesso proprietario già inviata, in attesa o chiusa, con livello di recidiva crescente e precompilazione automatica dei campi del luogo
- L'escalation verso la Procura della Repubblica NON è automatizzata: il sistema segnala solo la soglia di recidiva, la decisione resta umana

### Pannello di amministrazione

- Gestione completa di regioni, province, comuni e utenti
- Modifica dei riferimenti normativi regionali senza toccare codice
- Verifica periodica dei dati dei sindaci tracciata nel campo `noteAggiornamento`; il pannello evidenzia automaticamente i comuni con sindaco non verificato da oltre 6 mesi
- Validazione input lato server con zod su tutti gli endpoint di creazione

### Export e portabilità

- Export CSV delle segnalazioni con tutte le colonne principali, compatibile Excel (UTF-8 con BOM e separatore punto e virgola)
- Pulsante di export nella lista segnalazioni, con rispetto dei filtri attivi
- Anteprima lettera PEC stampabile come PDF (via browser), con opzione di includere gli allegati fotografici incorporati

### PWA

- Manifest e service worker con caching minimale della shell per uso offline di base; senza icone il browser non propone l'installazione automatica, l'app resta usabile dal browser

### Tema chiaro e scuro

- Pulsante dedicato per passare dal tema chiaro al tema scuro, nella barra laterale su desktop e nell'intestazione su mobile, anche nella schermata di accesso
- Al primo accesso il tema segue la preferenza del sistema operativo; la scelta esplicita dell'utente è salvata nel browser
- Il tema è applicato prima del primo rendering, senza flash del tema sbagliato
- Contrasto dei testi, dei badge e dei controlli verificato secondo WCAG 2.2 AA in entrambi i temi

### Sicurezza

- Rate limiting sul login con backoff progressivo: 20 tentativi falliti per IP e 3 per email, nella finestra di 15 minuti, bloccano l'accesso per 5 minuti; blocchi ripetuti entro un'ora escalano a 15 minuti, poi 1 ora, poi 24 ore (vedi `src/lib/rate-limit.ts`)
- Validazione tipo e dimensione allegati con verifica magic bytes anti-spoofing (max 10 MB, JPEG/PNG/WebP/PDF; per WebP verifica sia "RIFF" sia "WEBP")
- Password hashate con bcrypt (cost 12), password policy rafforzata (min 12 caratteri, 4 classi, max 2 consecutivi uguali)
- Matrice delle transizioni lecite tra stati (l'amministratore può forzare con ?force=1)
- Autorizzazione RBAC con competenza territoriale fail-closed: un referente senza territorio assegnato non vede alcuna segnalazione
- Anti-CSRF: cookie SameSite=Strict + verifica Origin/Referer nel proxy (richiede `NEXT_PUBLIC_BASE_URL` in produzione)
- Validazione latitudine/longitudine nei range geografici reali (-90/+90, -180/+180) in creazione e modifica della segnalazione
- CSV/Formula Injection: sanificazione di campi che iniziano con `=`, `+`, `-`, `@` o con spazi bianchi nell'export CSV
- Update atomiche con clausola WHERE su stato corrente in approva/rifiuta/DELETE segnalazioni (previene race condition)
- DELETE allegati con diritto di modifica (non sola visibilità) e blocco se stato non modificabile

---

## Stack tecnico

| Livello | Tecnologia | Motivazione |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **React 19** + **TypeScript 7** | Stack mainstream, tipizzato, mantenuto attivamente |
| Tipografia | **Inter** 5.3 (licenza OFL-1.1), caricato dal progetto con `next/font/local` | Nessuna richiesta a servizi di terze parti per i caratteri; licenza in `src/fonts/inter/LICENSE.txt` |
| UI | **Tailwind CSS 4** + **shadcn/ui** | Componenti accessibili e personalizzabili, niente lock-in |
| Database | **PostgreSQL 16** (via **Prisma ORM**) | ACID e MVCC per la concorrenza multi-writer, database relazionale maturo e open source |
| Autenticazione | Sessioni via cookie HTTP-only + **bcryptjs** | Nessuna dipendenza da servizi esterni, password hashate |
| Validazione | **zod** | Validazione input lato server con tipi TypeScript |
| Generazione PDF | Template HTML → stampa via browser | Nessuna dipendenza da Word/Office |
| Invio PEC e notifiche | **Nodemailer** via SMTP | Standard; compatibile con i provider PEC che offrono accesso SMTP |
| PWA | **manifest.json** + service worker | Manifest, caching offline minimale |

Le tecnologie principali sono open source con licenze permissive (per esempio MIT, Apache 2.0, ISC, PostgreSQL License).

---

## Architettura

```
┌──────────────────────────────────────────────────────────┐
│  PWA (client)                                            │
│  - Form segnalazione, cattura foto/GPS                   │
│  - Dashboard per volontari, referenti e admin            │
│  - Anteprima e stampa PDF della lettera PEC              │
└──────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│  Backend applicativo (Next.js API Routes)                │
│  - Autenticazione e ruoli (volontario, referente, admin) │
│  - Genera il numero di protocollo univoco                │
│  - Compone la lettera da template e tabella di regole    │
│  - Gestisce il flusso di approvazione                    │
│  - Invia la PEC via SMTP (se configurato)                │
│  - Espone i reminder per le pratiche in attesa           │
└──────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
              │                              │
              ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────┐
│  Dati di configurazione   │  │  Dati applicativi         │
│  regioni_leggi, province, │  │  segnalazioni, allegati,  │
│  comuni, users            │  │  storico_stati,           │
│  editabili senza codice   │  │  log_invii_pec            │
└───────────────────────────┘  └───────────────────────────┘
```

Il principio guida: **il codice applicativo non contiene riferimenti normativi regionali, indirizzi PEC o nomi di sindaci**. Questi dati vivono nelle tabelle di configurazione: sono caricati dal seed iniziale (`scripts/seed.ts`) e poi modificabili dal pannello di amministrazione. Il testo fisso della lettera e le note del form citano anche norme statali generali (Codice della Strada, Codice Civile), che non sono leggi regionali.

---

## Installazione e avvio

### Prerequisiti

- **npm 11+** (verifica con `npm --version`).
- **Node.js 24+** (richiesto per lo sviluppo e la produzione). La versione è indicata in `.nvmrc`: con nvm o fnm basta eseguire `nvm use` (o `fnm use`) nella cartella del progetto
- Un terminale con accesso al filesystem

### Procedura

1. Clona la repository:

   ```bash
   git clone https://github.com/Ft2801/CieloBuio-Segnalazioni.git
   cd CieloBuio-Segnalazioni
   ```

2. Installa le dipendenze:

   ```bash
   npm install
   # oppure: npm ci (installazione deterministica da package-lock.json)
   ```

3. Crea il file `.env` con la configurazione del database (PostgreSQL di default):

   ```bash
   echo 'DATABASE_URL="postgresql://cielobuio:password@localhost:5432/cielobuio_segnalazioni?schema=public"' > .env
   ```

4. Applica lo schema al database:

   ```bash
   npm run db:migrate
   ```

5. Popola il database con i dati di configurazione iniziali (regioni, leggi, province, comuni senza sindaco né PEC):

   ```bash
   npm run db:seed
   ```

   Il seed è ripetibile: i record già presenti vengono riusati senza errori. Le regioni già presenti non vengono sovrascritte, così le modifiche fatte dal pannello di amministrazione non vanno perse. Per allineare i riferimenti normativi di una regione ai dati del seed usa `npm run db:seed -- --aggiorna-normativa`.

   Poi crea il primo utente amministratore (email, nome e cognome, ruolo e password vengono
   chiesti interattivamente, non restano scritti in nessun file):

   ```bash
   npm run db:create-admin
   ```

6. Avvia il server di sviluppo:

   ```bash
   npm run dev
   ```

   L'applicazione sarà disponibile su `http://localhost:3000`.

### Build per produzione

```bash
npm run build
npm run start
```

---

## Account dimostrativi

L'applicazione include tre account dimostrativi di **sola visualizzazione**
(volontario, referente, admin), pensati per mostrare l'interfaccia dei tre
ruoli senza toccare dati reali:

- Sono attivi **solo nella build statica pubblicata su GitHub Pages**. Il
  server di produzione (Docker o installazione manuale) non li riconosce: la
  modalità demo è disattivata e si accede solo con gli account reali. Il
  gating dipende dal flag `NEXT_PUBLIC_CIELOBUIO_DEMO`, impostato soltanto
  da `next.config.pages.ts`.
- Non richiedono database né backend attivi: la verifica delle credenziali
  avviene interamente nel browser (vedi `src/lib/demo-mode.ts`), quindi
  funzionano anche a server spento o offline, ma solo nella build statica.
- Mostrano dati statici di esempio incorporati nel bundle (vedi
  `src/lib/demo-data.ts`), non provenienti dal database.
- Non possono creare, modificare, approvare, rifiutare o inviare nulla:
  ogni azione mutativa viene bloccata lato client con un messaggio
  esplicativo prima ancora di provare a contattare il server.
- Le credenziali **non sono suggerite da alcun pulsante** nella schermata
  di login: vanno scritte a mano. Questo è intenzionale, perché il
  repository è pubblico: un pulsante "clicca per accedere come admin"
  esporrebbe una scorciatoia visibile a chiunque legga il codice, mentre
  qui l'accesso demo richiede comunque di conoscere e digitare le
  credenziali esatte.

Le credenziali dei tre account dimostrativi sono elencate in `SETUP.md`
(sezione "Account dimostrativi"), non qui, per lo stesso motivo.

Per un account reale con permessi di scrittura, crealo con:

```bash
npm run db:create-admin
```

Lo script chiede email, nome e cognome, ruolo e password interattivamente e li
scrive già cifrati nel database: nessuna credenziale reale resta in un
file del repository. La password va inserita due volte; dopo cinque
inserimenti non validi l'operazione viene annullata. Senza terminale
(pipe, CI) la password si passa con la variabile `ADMIN_PASSWORD`.

---

## Flusso di una segnalazione

Stati previsti, in ordine di avanzamento naturale:

1. **Bozza**: creata dal volontario sul campo, salvabile con foto/GPS
2. **In revisione**: inviata al referente territoriale competente
   - Se il referente **rifiuta**: torna in stato Bozza con nota del referente
   - Se il referente **approva**: passa allo stato successivo
3. **Approvata**: pronta per l'invio della PEC; disponibile la "simula spedizione" (anteprima inviata solo al destinatario di controllo). Il referente può riportarla in revisione
4. **Inviata**: la PEC è stata inviata a Comune (e ARPA se previsto); la pratica ha un numero di protocollo definitivo e non è più modificabile
5. **In attesa**: stato di monitoraggio, con reminder periodici finché non arriva una risposta
6. **Chiusa positiva**: l'impianto è stato adeguato
7. **Chiusa negativa**: nessun adeguamento; l'escalation resta una decisione dell'amministratore

L'escalation fino alla segnalazione alla Procura della Repubblica **non è automatizzata**: il sistema si limita a segnalare che una pratica ha raggiunto una soglia di recidiva, la decisione resta umana.

---

## Configurazione dell'invio PEC in produzione

Senza `PEC_SMTP_HOST` l'invio PEC è disabilitato: la richiesta risponde 503 e lo stato della segnalazione non cambia. La simulazione della spedizione registra sempre l'anteprima nel log; la copia di controllo viene inviata solo quando il servizio SMTP è configurato. Per abilitare l'invio reale, aggiungi al file `.env` le variabili:

```bash
PEC_SMTP_HOST=smtp.pec.tuodominio.it
PEC_SMTP_PORT=465
PEC_SMTP_USER=tua_pec@pec.tuodominio.it
PEC_SMTP_PASSWORD=password_applicativa
PEC_FROM=tua_pec@pec.tuodominio.it

# Soglia promemoria pratiche in attesa (giorni, default 30)
REMINDER_GIORNI=30

# Giorni dopo cui transizione automatica "inviata" -> "in_attesa" (default 7)
TRANSIZIONE_INVIATA_GIORNI=7

# Anni di retention GDPR dopo la chiusura della pratica (default 10)
RETENTION_SEGNALAZIONI_ANNI=10

# URL pubblica della piattaforma (per i link nelle notifiche email e per il check CSRF)
NEXT_PUBLIC_BASE_URL=https://segnalazioni.esempio.it

# Token per /api/metrics (Prometheus). Generare con: openssl rand -hex 32
# METRICS_TOKEN=

# Chiave Base64 (32 byte) per cifrare i backup. Generare con: openssl rand -base64 32
# BACKUP_ENCRYPTION_KEY=   # obbligatoria per backup e ripristino

# Directory dei backup (default: ./backups)
# BACKUP_DIR=

# Path assoluto del storage degli allegati (default: ./storage/uploads).
# Utile in deploy Docker dove il volume è montato altrove.
# STORAGE_ROOT=
```

**Nota importante**: l'account PEC deve essere intestato a CieloBuio, non al volontario sviluppatore. Verificare che il provider PEC scelto supporti l'accesso SMTP con credenziali applicative (non solo webmail).

### Vincoli tecnici delle caselle PEC italiane

- I messaggi inviati da un indirizzo PEC possono avere destinatari CC in PEC, ma **non supportano il CCN (BCC)** verso indirizzi PEC. Il sistema rispetta questo vincolo mettendo tutti i destinatari in TO o CC.
- L'accettazione SMTP dei destinatari non prova la consegna certificata. Controllare nella casella PEC le ricevute di accettazione e consegna. Una risposta con esito incerto, un'interruzione del processo o una consegna parziale bloccano i tentativi successivi sulla stessa pratica. Non premere nuovamente «Invia PEC» senza riconciliare il log; la procedura operativa è in [SECURITY.md](SECURITY.md#riconciliazione-degli-invii-pec).

---

## Sicurezza

Le misure di sicurezza comprendono controlli sulle route API, sul proxy, sull'autenticazione, sull'autorizzazione territoriale, sui flussi PEC, sugli allegati e sulla manutenzione. Il comportamento in produzione dipende anche dalla configurazione di Caddy, del servizio e dei permessi sul filesystem: verificare questi componenti sul server di destinazione. Vedi [SECURITY.md](SECURITY.md) per il dettaglio.

Misure principali:
- **Autenticazione**: bcrypt cost 12, password policy rafforzata (12+ caratteri, 4 classi), session rotation al login, cookie `__Host-` in produzione (impedisce che un sottodominio compromesso sovrascriva il cookie di sessione)
- **Invalidazione sessioni admin**: cambio password/ruolo/territorio da admin distrugge tutte le sessioni attive dell'utente (prevenzione persistenza dopo compromissione)
- **Rate limiting doppio**: login con limite per IP **e** per email. L'IP è letto solo da `X-Real-IP`, impostato da Caddy: `X-Forwarded-For` non è mai usato. Escalation blocchi (5 min, 15 min, 1 ora, 24 ore)
- **Rate limiting admin**: creazione (`POST /api/config/users`) e modifica (`PATCH /api/config/users/[id]`) limitate a 30/ora ciascuna (difesa in profondità contro script automatizzati)
- **Autorizzazione**: RBAC con competenza territoriale, prevenzione IDOR su tutti gli endpoint, fail-closed per referenti senza territorio
- **Business logic**: stato `approvata` blocca modifiche PUT e upload allegati; il volontario proprietario può eliminare allegati SOLO in stato "bozza" (non in "in_revisione"): previene alterazione del pacchetto probatorio dopo invio in revisione al referente
- **CSRF**: cookie SameSite=Strict + verifica Origin/Referer nel proxy, fail-closed in produzione senza `NEXT_PUBLIC_BASE_URL`
- **Firewall obbligatorio**: SETUP.md documenta configurazione `ufw` con `deny 3000/tcp` + `HOSTNAME=127.0.0.1` in systemd per prevenire bypass del rate limiting via accesso diretto a Node
- **XSS**: HTML escaping di tutti i contenuti utente, CSP strict su script-src con nonce per ogni richiesta e 'strict-dynamic' (style-src 'unsafe-inline' per Next.js), escaping defense-in-depth anche nei campi interpolati della lettera PEC
- **File upload**: directory privata, download autenticato, magic bytes verification (incluso RIFF+WEBP per WebP), path traversal protection, limite 4 allegati per segnalazione
- **Email header injection**: validazione zod + regex anti-CRLF su tutti i campi PEC
- **Security headers**: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, `X-Powered-By` disabilitato
- **Audit trail**: storico stati completo, log invii PEC, registro `AuditLog` degli export CSV (GDPR art. 30)
- **GDPR retention**: cron job di anonimizzazione automatica delle segnalazioni chiuse da più di 10 anni (allineato a PRIVACY.md), con rimozione di PII (indirizzo, GPS, descrizioni, allegati) e preservazione del record per audit/statistica
- **Privacy**: rate limit su export CSV (5/ora per utente) per limitare gli scarichi massivi; ogni export è comunque registrato nell'`AuditLog`

### Rate limiting

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

---

## Qualità del codice e test

Il progetto applica una soglia globale di copertura del **100%** su statements, branches, functions e lines, verificata da `npm run test:coverage` in CI. Il perimetro della misura comprende tutto il codice TypeScript di `src/` (incluso `src/proxy.ts`, le route API, i componenti e il layout) e di `scripts/` (script CLI e job di manutenzione). Le uniche esclusioni dichiarate in `vitest.config.mts` sono i file di test (`*.test.*`, `*.spec.*`, cartelle `__tests__`), il setup dei test (`src/setup-tests.ts`) e le dichiarazioni di tipo (`*.d.ts`). Gli script di build (`scripts/build-pages.ts`, `scripts/copy-standalone.ts`) sono scritti in TypeScript e rientrano nel perimetro.

### Suite e strumenti di qualità

- **Test**: la suite Vitest (`npm test`) comprende:
  - Test unitari su `src/lib/` (client Prisma, SMTP, protocollo, path guard, validazione, lettera, notifiche, GDPR, cron, demo, backup)
  - Test di integrazione su tutte le API routes in `src/app/api/__tests__/` (autenticazione, configurazione territoriale, segnalazioni, azioni di stato, PEC, allegati, export)
  - Test di sicurezza (OWASP Top 10, con verifiche sul codice sorgente)
  - Test di funzionalità enterprise (health, docs, metrics con token Prometheus, TOTP con anti-lockout, cifratura dei backup)
  - Test su componenti React, layout, pagina, hook e componenti UI shadcn/ui
- **Copertura**: soglia globale configurata al 100% per statements, branches, functions e lines. `npm run test:coverage` genera il dettaglio per file in `coverage/`, directory locale esclusa dall'archivio del progetto.
- **TypeScript 7**: verifica dei tipi con `npm run typecheck`
- **ESLint**: verifica con `npm run lint` e `--max-warnings=0`
- **Build**: generazione dell'applicazione standalone Next.js 16 con `npm run build`
- **Dipendenze**: audit di produzione con `npm audit --omit=dev --audit-level=high`; controllo delle licenze con `npm run licenze`, incluse le eccezioni dichiarate nel comando
- **Formattazione**: controllo Prettier con `npm run format:check`
- **Codice e dipendenze inutilizzate**: controllo con `npm run knip`
- **Analisi statica di sicurezza**: regole di `eslint-plugin-security` integrate in ESLint; le regole disattivate sono motivate in `eslint.config.mjs`

### API routes testate con integration test

Tutte le 30 API routes hanno test di integrazione. La maggior parte si trova in `src/app/api/__tests__/`; `health`, `docs` e `metrics` sono testate in `src/__tests__/enterprise-features.test.ts`:

- `auth/login`, `auth/logout`, `auth/me`, `auth/2fa` (autenticazione, rate limit IP+email, rotazione delle sessioni e del fattore TOTP senza interrompere il 2FA attivo)
- `config/regioni`, `config/province`, `config/comuni`, `config/users` (CRUD completo, admin-only)
- `segnalazioni` (GET lista, POST creazione, GET export CSV con rate limit e audit trail)
- `segnalazioni/[id]` (GET dettaglio, PUT modifica, DELETE)
- `segnalazioni/[id]/approva`, `/rifiuta`, `/cambia-stato` (matrice `TRANSIZIONI_LECITE`, race condition 409)
- `segnalazioni/[id]/invia-pec`, `/simula-pec` (SMTP mode, demo mode, allegati, CC, ARPA, rate limit)
- `segnalazioni/[id]/lettera` (anteprima HTML)
- `allegati` (DELETE: proprietario solo in stato "bozza", referenti in "bozza" e "in_revisione")
- `allegati/[id]/download`, `/preview` (path traversal protection, Content-Disposition)
- `upload` (magic bytes, limit 4 allegati, rate limit)
- `stats` (dashboard, 10 count in parallelo)
- `reminder` (GET lista, POST cleanup/auto-transition/gdpr-anonymize)
- Proxy `src/proxy.ts` (security headers, CSRF check, fail-closed senza `NEXT_PUBLIC_BASE_URL`), testato in `src/__tests__/proxy.test.ts`

### Componenti frontend testati

- `AutoreLink`, `LoginScreen`
- `VistaReminder`, `Dashboard`, `ListaSegnalazioni`, `AppShell`
- `ThemeToggle` (test - variante icona e variante estesa, stato `aria-pressed`, persistenza della scelta)
- `DettaglioSegnalazione` (test - tutti gli stati, ruoli, azioni, demo mode)
- `FormSegnalazione` (test - creazione, modifica, recidiva, allegati, GPS, validazione)
- `PannelloAdmin` (test - 4 tab: regioni, province, comuni, utenti con CRUD completo)
- `useToast` hook (test - reducer, ADD/UPDATE/DISMISS/REMOVE, TOAST_LIMIT)
- Componenti UI shadcn (test - Button, Badge, Card, Checkbox, Input, Label, Textarea, Switch, Tabs, Dialog, Select, Toast, Toaster)

### Esecuzione dei test

```bash
# Test singoli
npm run test

# Test con coverage
npm run test:coverage

# Test end-to-end e accessibilità (richiede `npm run build:pages` e Chromium di Playwright)
npx playwright install chromium
# Su Linux, se mancano librerie di sistema: npx playwright install --with-deps chromium
npm run build:pages
npm run test:e2e

# Test in watch mode
npm run test:watch
```

### Collaudo con PostgreSQL e storage reali

`npm run test:integration` verifica transazioni, rollback dello storico, upload concorrenti e limite di quattro allegati, conflitti di versione, download e anteprime senza collegamenti simbolici, consumo univoco dei codici TOTP, sessioni concorrenti e backup con ripristino di dati e file. Soltanto l'identità della richiesta HTTP è iniettata nei test delle route; PostgreSQL e filesystem sono reali.

**La suite cancella i dati applicativi prima di ogni caso e al termine.** Usare esclusivamente un database sacrificabile chiamato `cielobuio_integration`, con un ruolo dedicato senza accesso ai database operativi. La configurazione richiede `TEST_DATABASE_URL` e rifiuta un nome database differente. Non usare credenziali di produzione.

```bash
# Il database dedicato e il ruolo di collaudo devono già esistere.
export TEST_DATABASE_URL='postgresql://collaudo:password-locale@localhost:5432/cielobuio_integration?schema=public'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:integration
```

La CI applica le migrazioni al servizio PostgreSQL dedicato prima di eseguire questa suite. Il comando resta distinto da `npm run check`, che non richiede servizi esterni.

### Concorrenza delle pratiche

I vincoli relazionali di PostgreSQL mantengono la coerenza delle coppie comune/provincia e provincia/regione anche durante operazioni concorrenti. Un Comune o una provincia con pratiche collegate non può essere ricollocato in un territorio diverso.

Le richieste di modifica, approvazione, rifiuto, cambio stato, eliminazione e gestione degli allegati accettano `If-Match` con il valore ISO completo di `updatedAt` racchiuso tra virgolette, ad esempio `"2026-01-01T00:00:00.123Z"`. Un valore diverso dalla versione corrente produce HTTP 409 senza applicare l'operazione. L'interfaccia invia la versione visualizzata e recepisce `updatedAt` dalle risposte di upload ed eliminazione degli allegati. I client senza precondizione restano soggetti ai controlli di stato, autorizzazione e concorrenza del server. Le variazioni agli allegati e la versione della pratica sono registrate nella stessa transazione.

### Controlli automatici

- **Verifica completa in locale**: `npm run check` esegue in sequenza formattazione, lint, typecheck, knip, controllo delle licenze e test con copertura al 100%
- **Test end-to-end**: `npm run test:e2e` (Playwright e axe-core) gira sulla build statica in `out/` in un job dedicato della CI. Non fa parte della copertura unitaria né di `npm run check`, perché richiede un browser.
- **Pre-commit**: Husky esegue lint-staged sui file in staging (Prettier ed ESLint). L'hook viene installato dallo script `prepare` durante `npm ci`
- **Messaggi di commit**: l'hook `commit-msg` rifiuta titoli vuoti o più lunghi di 72 caratteri, secondo le convenzioni di CONTRIBUTING.md
- **Integrazione continua** (`.github/workflows/ci.yml`): ad ogni push e pull request la CI esegue la pipeline unificata con test di qualità, integrazione, sicurezza, Docker, link e build statica
  - Qualità e test: formato, lint, typecheck, knip, licenze delle dipendenze, test con copertura, build dell'applicazione, build statica per GitHub Pages, audit npm e verifica delle firme del registry
  - Sicurezza e infrastruttura: actionlint sui workflow, hadolint sul Dockerfile, shellcheck sugli script, validazione Caddyfile e docker-compose, scansione vulnerabilità Trivy
- **Deploy automatico** (`.github/workflows/deploy-pages.yml`): esportazione statica e pubblicazione su GitHub Pages ad ogni push su `main`
- **Test di policy del repository** (`src/__tests__/repo-policy.test.ts`): verifica che action e immagini siano fissate a SHA o digest, che i file di governance esistano e che la versione di Node.js sia coerente

### Categorie di test

- **Test unitari** (`src/lib/__tests__/`): test su funzioni pure, helper autenticazione, generazione lettera, protocollo, rate limiting, validazione Zod, notifiche email, modalità demo, path-guard, TOTP, cron-utils
- **Test integration API** (`src/app/api/__tests__/`): test su tutte le 30 route handler con mock di DB (Prisma), next/headers, nodemailer, bcryptjs, fs/promises
- **Test sicurezza informatica** (`src/__tests__/security-attack-suite.test.ts`): 78 test di penetrazione simulati organizzati per categoria OWASP Top 10, tutti con verifiche reali su codice sorgente:
  - **A01 Broken Access Control**: IDOR prevention, fail-closed per referenti senza territorio, sentinella `__NEVER_MATCH__`
  - **A02 Cryptographic Failures**: bcrypt cost 12, `__Host-` cookie prefix, flag HttpOnly/SameSite=Strict/Secure
  - **A03 Injection**: SQL injection (Prisma parametrizzato), email header injection (CRLF prevention), CSV formula injection
  - **A04 Insecure Design**: race condition (update atomiche), business logic bypass (pacchetto probatorio)
  - **A05 Security Misconfiguration**: CSP strict, HSTS, X-Frame-Options DENY, nosniff, CSRF Origin/Referer, fail-closed
  - **A07 Authentication Failures**: brute force escalation (5min→15min→1h→24h), session fixation (rotation + invalidazione)
  - **A08 Software/Data Integrity**: path traversal multi-layer, magic bytes spoofing, limite allegati, size max
  - **A09 Logging/Monitoring**: audit trail completo, export CSV tracciato, eventi automatici con userId=null
  - **A10 SSRF**: verifica nessun endpoint fa fetch a URL user-controlled
  - **XSS**: HTML escaping in generaHtmlLettera
  - **DEMO**: blocco azioni mutative in demo mode
  - **GDPR**: anonimizzazione automatica con rimozione PII
- **Test feature enterprise** (`src/__tests__/enterprise-features.test.ts`): test su health, docs, metrics, TOTP anti-lockout, backup encryption
- **Test proxy** (`src/__tests__/proxy.test.ts`): test su security headers, CSRF check, fail-closed
- **Test componenti React** (`src/components/app/__tests__/`): test su rendering, interazioni, stati, errori, demo mode
- **Test layout e page** (`src/app/__tests__/`): test su metadata, viewport, struttura di base
- **Test componenti UI** (`src/components/ui/__tests__/`): test su 13 componenti shadcn/ui (button, input, card, dialog, select, toast, toaster, switch, checkbox, tabs, textarea, label, badge)
- **Test hook** (`src/hooks/__tests__/`): test su use-toast (reducer, dispatch, cleanup)
- **Test scripts** (`scripts/__tests__/`): test su cron-jobs (pulizia sessioni, transizioni, anonimizzazione GDPR, errori)
- **Test edge cases**: rami difensivi (fail-closed, fallback, catch block, rami `??` e `&&`)

---

## Privacy e conformità normativa

Vedi [PRIVACY.md](PRIVACY.md) per l'analisi completa GDPR e normative PEC.

Punti chiave:
- **Titolare del trattamento**: CieloBuio, Coordinamento per la protezione del cielo notturno
- **Basi giuridiche**: interesse legittimo (art. 6.1.f GDPR) per i dati di volontari, referenti, amministratori pubblici e segnalazioni. Il sistema non raccoglie un consenso. Dettaglio in PRIVACY.md
- **Retention**: segnalazioni 10 anni dalla chiusura (termine ordinario di prescrizione civile, art. 2946 c.c.), sessioni 8 ore
- **Diritti GDPR**: accesso, rettifica, cancellazione (limitata per obblighi legali), portabilità (export CSV disponibile)
- **PEC**: rispetto del DPR 68/2005, nessun CCN verso indirizzi PEC, valore legale equivalente a raccomandata A/R
- **Escalation alla Procura**: NON automatizzata, decisione umana del direttivo

---

## Struttura del progetto

```
.
├── prisma/
│   ├── migrations/             # Migrazioni SQL versionate
│   └── schema.prisma           # Schema del database (tutte le tabelle)
├── scripts/
│   ├── seed.ts                 # Script di popolamento dati di configurazione (no utenti)
│   ├── create-admin.ts         # Crea un utente interattivamente (email/password a runtime)
│   ├── cron-entry.ts           # Punto d'ingresso del job di maintenance (npm run cron:reminder)
│   ├── cron-jobs.ts            # Maintenance periodica (transizioni, pulizia sessioni, GDPR)
│   ├── backup-db.ts            # Backup del database in JSON con cifratura AES-256-GCM
│   ├── restore-db.ts           # Ripristino del database da backup cifrato
│   ├── build-pages.ts          # Build statica per GitHub Pages
│   ├── copy-standalone.ts      # Copia public/ e file statici nel build standalone
│   └── deploy.sh               # Automazione deploy VPS (backup, pull, build, restart)
├── src/
│   ├── app/
│   │   ├── api/                # API Routes (backend)
│   │   │   ├── auth/           # Login, logout, sessione, 2FA TOTP
│   │   │   ├── segnalazioni/   # CRUD segnalazioni + azioni (approva, rifiuta, invia PEC, cambia stato, export CSV, lettera)
│   │   │   ├── config/         # Gestione tabelle configurazione (solo admin, validazione zod)
│   │   │   ├── upload/         # Upload allegati (con validazione tipo e dimensione)
│   │   │   ├── allegati/       # Eliminazione, download, preview allegati
│   │   │   ├── stats/          # Statistiche per dashboard
│   │   │   ├── reminder/       # Pratiche in attesa oltre soglia + transizioni automatiche
│   │   │   ├── health/         # Health check per monitoring
│   │   │   ├── docs/           # Documentazione OpenAPI
│   │   │   └── metrics/        # Metriche Prometheus con token auth
│   │   ├── error.tsx           # Pagina di errore dell'applicazione
│   │   ├── globals.css         # Stili globali (tema chiaro e scuro, product register)
│   │   ├── layout.tsx          # Layout root (manifest PWA, service worker)
│   │   └── page.tsx            # Entry point (app shell)
│   ├── hooks/                  # Hook React (use-toast)
│   ├── proxy.ts                # Proxy Next.js: security headers, CSRF, fail-closed
│   ├── setup-tests.ts          # Setup dei test (Vitest)
│   ├── components/
│   │   ├── app/                # Componenti applicativi
│   │   │   ├── app-shell.tsx          # Shell principale con navigazione
│   │   │   ├── login-screen.tsx       # Schermata di login
│   │   │   ├── dashboard.tsx          # Dashboard con statistiche
│   │   │   ├── lista-segnalazioni.tsx # Lista filtrabile + paginazione + export CSV
│   │   │   ├── form-segnalazione.tsx  # Form creazione/modifica (con recidiva)
│   │   │   ├── dettaglio-segnalazione.tsx # Dettaglio + azioni + anteprima lettera
│   │   │   ├── pannello-admin.tsx     # Pannello amministrazione
│   │   │   ├── vista-reminder.tsx     # Vista promemoria
│   │   │   ├── autore-link.tsx        # Link all'autore del progetto
│   │   │   ├── theme-toggle.tsx       # Pulsante tema chiaro/scuro
│   │   │   └── use-session.ts         # Hook sessione
│   │   └── ui/                 # Componenti shadcn/ui
│   └── lib/
│       ├── auth.ts             # Autenticazione, ruoli, sessioni
│       ├── backup.ts           # Backup e ripristino cifrati del database e degli allegati
│       ├── cli-io.ts           # Input da terminale per gli script di amministrazione
│       ├── cli-utenti.ts       # Creazione interattiva di un utente (db:create-admin)
│       ├── confronto-sicuro.ts # Confronto di token e credenziali a tempo costante
│       ├── cron-utils.ts       # Logica maintenance centralizzata (sessioni, transizioni, GDPR, orfani)
│       ├── db.ts               # Client Prisma con retry automatico
│       ├── demo-data.ts        # Dati statici mostrati in modalità demo
│       ├── demo-mode.ts        # Credenziali e logica della modalità demo offline (sola lettura)
│       ├── errori.ts           # Testo leggibile degli errori catturati
│       ├── filtro-stato.ts     # Filtri di stato per le liste
│       ├── format.ts           # Formattazione condivisa di date e plurali
│       ├── gdpr.ts             # Anonimizzazione GDPR segnalazioni
│       ├── http.ts             # Utilità HTTP condivise dalle route API
│       ├── lettera.ts          # Motore generazione lettera PEC
│       ├── logger.ts           # Logger strutturato Pino con redazione PII
│       ├── notifiche.ts        # Notifiche email a referenti e volontari
│       ├── path-guard.ts       # Path traversal protection centralizzata
│       ├── prisma-client.ts    # Client Prisma collegato a PostgreSQL (adapter nativo)
│       ├── protocollo.ts       # Generazione numero protocollo (unicità garantita dal vincolo unique, con nuovo tentativo)
│       ├── rate-limit.ts       # Rate limiting in-memory con escalation
│       ├── smtp.ts             # Configurazione SMTP per PEC e notifiche
│       ├── tema.ts             # Tema chiaro/scuro dell'interfaccia
│       ├── totp.ts             # Libreria TOTP (RFC 6238) per 2FA
│       ├── totp-replay.ts      # Protezione anti-replay dei codici TOTP
│       ├── types.ts            # Tipi condivisi + costanti (TRANSIZIONI_LECITE, MAX_ALLEGATI)
│       ├── utils.ts            # Utility generiche (cn)
│       └── validation.ts       # Schemi zod per validazione input
├── public/
│   ├── .well-known/            # security.txt (RFC 9116): contatto per le segnalazioni
│   ├── manifest.json           # Manifest PWA
│   ├── sw.js                   # Service worker
│   ├── robots.txt              # Regole per i crawler
│   └── sw-register.js          # Registrazione service worker (script esterno)
├── storage/
│   └── uploads/                # Allegati caricati (directory PRIVATA, gitignored, creata al primo upload)
├── .dockerignore               # Esclusioni build context Docker (previene leak di secrets)
├── .editorconfig               # Regole base per l'editor (UTF-8, fine riga LF, indentazione)
├── .gitattributes              # Fine riga LF per script, Caddyfile e Dockerfile
├── .husky/                     # Hook Git (pre-commit con lint-staged, commit-msg)
├── .nvmrc                      # Versione di Node.js del progetto (24)
├── .npmrc                      # engine-strict: npm rifiuta versioni di Node.js incompatibili
├── .prettierignore             # File esclusi dalla formattazione
├── .prettierrc.json            # Regole di formattazione (Prettier, 120 colonne)
├── .vscode/                    # Impostazioni e estensioni VS Code consigliate
├── CODE_OF_CONDUCT.md          # Codice di condotta
├── knip.json                   # Configurazione dell'analisi di codice inutilizzato
├── .env.example                # Template variabili d'ambiente
├── Caddyfile                   # Reverse proxy + HTTPS automatico per la produzione
├── Dockerfile                  # Build multi-stage per deploy containerizzato
├── docker-compose.yml          # Stack completo: app + PostgreSQL + Caddy
├── .gitattributes
├── .github/                    # Workflow CI e deploy GitHub Pages, template issue/PR e CODEOWNERS
├── .gitignore
├── CONTRIBUTING.md
├── CHANGELOG.md
├── SECURITY.md                 # Documento di sicurezza
├── PRIVACY.md                  # Conformità GDPR e normative PEC
├── SETUP.md                    # Guida completa: dal setup locale al deploy in produzione
├── LICENSE
├── README.md                   # Questo file
├── package.json
├── package-lock.json           # Lockfile per installazione deterministica
├── tsconfig.json
├── vitest.config.mts           # Configurazione Vitest con coverage
├── eslint.config.mjs           # Configurazione ESLint
├── components.json             # Configurazione shadcn/ui
├── postcss.config.mjs          # Configurazione PostCSS (Tailwind CSS 4)
├── next-env.d.ts               # Tipi Next.js
├── prisma.config.ts            # Configurazione Prisma 7
├── next.config.ts              # Configurazione Next.js (standalone output)
└── next.config.pages.ts        # Configurazione Next.js per build statica GitHub Pages
```

I test sono nelle cartelle `__tests__/` accanto al codice che verificano e in `src/__tests__/`; non fanno parte del codice applicativo.

---

## Manutenzione e continuità

Il progetto è progettato per sopravvivere all'abbandono del volontario sviluppatore originale. Per garantire la continuità:

### Aggiornamento dei dati di configurazione

- **Comuni, sindaci, PEC**: modificabili dal pannello amministrazione senza toccare codice. Si raccomanda una verifica periodica (almeno semestrale) dei dati dei sindaci, tracciata nel campo `noteAggiornamento`. Il pannello admin evidenzia automaticamente, con sfondo ambra ed etichetta "Da verificare", i comuni con sindaco non verificato da oltre 6 mesi
- **Riferimenti normativi regionali**: una riga di `regioni_leggi` per regione. Se una regione cambia la sua norma, si aggiorna la riga, non il software
- **Referenti territoriali**: gestiti dal pannello utenti, assegnati a provincia o regione

### Rinnovo di security.txt

Il campo `Expires` di `public/.well-known/security.txt` va aggiornato almeno una volta all'anno, prima della scadenza. Il test in `src/__tests__/repo-policy.test.ts` fallisce quando la data è passata.

### Job schedulati (cron)

In produzione configurare due job schedulati:

1. **Maintenance giornaliero** (es. alle 3:00):
   ```bash
   0 3 * * * cd /path/to/project && npm run cron:reminder >> logs/cron.log 2>&1
   ```
   Effettua: transizione automatica "inviata" verso "in_attesa" dopo `TRANSIZIONE_INVIATA_GIORNI` (default 7), pulizia sessioni scadute, anonimizzazione GDPR delle segnalazioni oltre la retention e pulizia dei file orfani.

2. **Backup giornaliero** (es. alle 2:00): per il deploy systemd, installare una copia di `scripts/backup-consistente.sh` in un percorso di proprietà di root e programmarla nel cron di root. Lo script ferma e riavvia il servizio e avvia `npm run db:backup` come utente applicativo. Anche il log root deve trovarsi in una directory non scrivibile dall'applicazione. Vedi [SETUP.md](SETUP.md#9-job-schedulati-cron-obbligatori-in-produzione). Non usare il comando di backup durante scritture concorrenti. L'archivio cifra tabelle e allegati con AES-256-GCM; la retention locale è di 30 giorni.

### Backup

- `npm run db:backup` (`scripts/backup-db.ts`) produce un archivio cifrato delle tabelle e degli allegati. La retention locale è di 30 giorni; un archivio incompleto viene rifiutato e non pubblicato.
- L'applicazione e gli altri processi che scrivono sui dati devono essere fermi durante il backup per avere una copia coerente di database e file. Un cron che esegue il comando mentre il servizio è attivo produce soltanto una copia di migliore sforzo, non una garanzia di ripristino. Pianificare una finestra di manutenzione o arrestare il servizio attorno al job, avviandolo anche se il comando fallisce.
- `npm run db:restore -- backup-YYYYMMDD-HHMMSS` ripristina file e database; `--force` è richiesto se una tabella contiene dati. Prima di eseguirlo fermare l'applicazione, verificare la disponibilità della chiave e predisporre una copia indipendente dello stato corrente. Gli upload vengono letti da `STORAGE_ROOT` se impostata, altrimenti da `storage/uploads/`. In caso di interruzione forzata, controllare le directory temporanee e lo stato del database prima del riavvio.
- In produzione è consigliato affiancare un `pg_dump` schedulato, che copre l'intero database. Testare periodicamente un ripristino su un ambiente isolato; gestire separatamente la conservazione dei dump.

### Export dei dati

- Le segnalazioni sono esportabili in CSV dalla lista segnalazioni (con i filtri attivi rispettati). Un singolo export ammette al massimo 5000 righe; se il limite viene superato, la richiesta restituisce un errore esplicito anziché un file incompleto. Restringere i filtri per esportare gruppi più piccoli.
- Nessun formato proprietario, nessun lock-in verso sviluppatori o fornitori terzi

### Configurazione PostgreSQL

Il progetto usa PostgreSQL di default. La stringa di connessione è definita in `.env`:

```
DATABASE_URL="postgresql://cielobuio:password@localhost:5432/cielobuio_segnalazioni?schema=public"
```

Per applicare lo schema: `npm run db:migrate` (migrazioni versionate in `prisma/migrations/`). Per creare una nuova migrazione in sviluppo: `npm run db:migrate:dev`.

---

## Contribuire

Le contribuzioni sono benvenute. Vedi [CONTRIBUTING.md](CONTRIBUTING.md) per le linee guida. Partecipando al progetto si accetta il [Codice di condotta](CODE_OF_CONDUCT.md).

### Cose da tenere a mente

- **Mai inserire riferimenti a leggi regionali nel codice applicativo**: tutto deve passare per le tabelle di configurazione
- **Mai aggiungere dipendenze da servizi a pagamento o con pricing che può cambiare**: solo open source, preferibilmente con licenze permissive (vedi CONTRIBUTING.md)
- **Mai automatizzare decisioni legali**: l'escalation verso la Procura resta una decisione umana
- **Documentare ogni cambiamento architetturale** in questo README

---

## Supporto e segnalazioni

- **Segnalazioni, feature request, domande**: apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
- **Contatto diretto (anche per segnalazioni sensibili che non vuoi esporre pubblicamente)**: fabiot2801@gmail.com
- **Vulnerabilità di sicurezza**: vedi [SECURITY.md](SECURITY.md) per la procedura di divulgazione responsabile. Il sito pubblica anche `/.well-known/security.txt` (RFC 9116) con i contatti

---

## Licenza

Copyright © 2026 CieloBuio, Coordinamento per la protezione del cielo notturno.
Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio).
Contatto: fabiot2801@gmail.com

Il codice adotta la licenza **GNU Affero General Public License v3.0 o successiva** (AGPL-3.0-or-later). Vedi il file [LICENSE](LICENSE) per il testo completo.

Questa licenza garantisce che chiunque possa usare, studiare, modificare e redistribuire il software, ma richiede che eventuali versioni modificate offerte come servizio network restino open source con la stessa licenza; questo protegge CieloBuio dal rischio che qualcuno possa chiudere il codice in futuro.
