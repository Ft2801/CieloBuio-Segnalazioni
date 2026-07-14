# CieloBuio, sistema di segnalazione impianti di illuminazione non conformi

![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)
![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-red?style=flat-square)
![Status](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwind-css&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1?style=flat-square)
![Nodemailer](https://img.shields.io/badge/Nodemailer-9-22B14C?style=flat-square)
![Caddy](https://img.shields.io/badge/Caddy-2-1F88C0?style=flat-square&logo=caddy&logoColor=white)

![Security](https://img.shields.io/badge/security-hardened-green?style=flat-square&logo=shield&logoColor=white)
![RBAC](https://img.shields.io/badge/authorization-RBAC+territorial-blueviolet?style=flat-square)
![CSRF](https://img.shields.io/badge/CSRF-protected-success?style=flat-square)
![CSP](https://img.shields.io/badge/CSP-strict-success?style=flat-square)
![HSTS](https://img.shields.io/badge/HSTS-enabled-success?style=flat-square)
![bcrypt](https://img.shields.io/badge/bcrypt-cost%2012-orange?style=flat-square)
![Rate Limit](https://img.shields.io/badge/rate%20limit-IP+%20email-yellow?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-purple?style=flat-square&logo=pwa&logoColor=white)
![GDPR](https://img.shields.io/badge/GDPR-compliant-blue?style=flat-square)
![AGPL](https://img.shields.io/badge/copyleft-AGPL--3.0-red?style=flat-square)

![Code Style](https://img.shields.io/badge/code%20style-strict-blue?style=flat-square)
![ESLint](https://img.shields.io/badge/ESLint-passing-brightgreen?style=flat-square)
![Type Check](https://img.shields.io/badge/type%20check-passing-brightgreen?style=flat-square)
![Build](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)
![Vitest](https://img.shields.io/badge/tests-1562%20passing-brightgreen?style=flat-square&logo=vitest&logoColor=white)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&logo=vitest&logoColor=white)
![Security Tests](https://img.shields.io/badge/security%20tests-OWASP%20Top%2010-red?style=flat-square&logo=owasp&logoColor=white)
![Italian](https://img.shields.io/badge/lang-Italiano-red?style=flat-square&logo=italy&logoColor=white)

Piattaforma web (PWA) per la segnalazione tramite PEC di impianti di illuminazione pubblici e privati non conformi alle leggi regionali italiane in materia di inquinamento luminoso.

Sviluppata per **CieloBuio, Coordinamento per la protezione del cielo notturno**.

- **Autore**: [Fabio Tempera](https://ft2801.github.io/Portfolio)
- **Anno**: 2026
- **Licenza**: AGPL-3.0

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
13. [Migrazione dal sistema Excel/VBA esistente](#migrazione-dal-sistema-excelvba-esistente)
14. [Manutenzione e continuità](#manutenzione-e-continuità)
15. [Contribuire](#contribuire)
16. [Supporto e segnalazioni](#supporto-e-segnalazioni)
17. [Licenza](#licenza)

---

## Contesto e obiettivo

CieloBuio (associazione di promozione sociale per la protezione del cielo notturno dall'inquinamento luminoso) necessita di un sistema che permetta a volontari sul territorio di segnalare, tramite PEC, impianti di illuminazione pubblici e, soprattutto, privati non conformi alle leggi regionali italiane.

Il sistema genera automaticamente una lettera di diffida formale (PEC) indirizzata al Comune competente (e, se richiesto, all'ARPA regionale) a partire da:

- dati del luogo (indirizzo, coordinate GPS)
- dati del segnalatore
- riferimenti normativi della regione competente (compilati automaticamente)
- tipologia di non conformità rilevata (da opzioni predefinite + testo libero)
- foto/allegati a supporto

Il progetto sostituisce un sistema precedente basato su Excel/VBA + Word + Outlook desktop con una PWA multi-utente, mantenendo intatta la logica di business già validata e aggiungendo un flusso di revisione/approvazione da parte di un referente territoriale prima dell'invio effettivo della PEC.

### Vincoli non negoziabili rispettati

- **Stack "boring by design"**: tecnologie mainstream, documentate, con community ampia
- **Codice sorgente e database sempre di proprietà di CieloBuio**
- **Architettura dati separata dalla logica applicativa**: i dati di configurazione vivono in tabelle semplici, editabili da un non programmatore, senza mai richiedere modifiche al codice
- **Motore a regole/flag configurabili, non codice ad hoc per ogni legge regionale**
- **Formato dati sempre esportabile** (CSV/Excel con un click)
- **Solo tecnologie open source con licenza permissiva**

---

## Caratteristiche principali

### Gestione segnalazioni

- Creazione di segnalazioni con indirizzo, GPS, foto (fino a 4 allegati)
- Derivazione automatica: comune → provincia → regione → legge applicabile → PEC del Comune/ARPA
- Numero di protocollo univoco nel formato `YYYYMMGG-REG-PV-NCXX` generato lato server
- Anteprima della lettera PEC stampabile come PDF (via browser)
- Storico completo degli stati con audit trail (chi ha fatto cosa e quando)

### Flusso di approvazione multi-ruolo

- **Volontario**: crea bozze, carica foto, invia al referente per approvazione
- **Referente territoriale** (provinciale o regionale): rivede, corregge, rifiuta con nota o approva; solo dopo approvazione è possibile inviare la PEC
- **Amministratore CieloBuio**: accesso completo, gestione configurazione, archivio nazionale, gestione escalation

### Motore di generazione lettera PEC

- Template con segnaposto che segue il testo legale reale già in uso da CieloBuio
- Tutti i riferimenti normativi sono letti dalla tabella `regioni_leggi`, mai hard-coded nel codice
- Versione "con ARPA" e "senza ARPA" gestite automaticamente in base al flag
- Generazione PDF via browser (stampa), senza dipendenze da Word/Office

### Invio PEC

- Invio da server via SMTP (configurabile con le credenziali della casella PEC dell'associazione)
- Distinzione tra "simula spedizione" (invio di prova solo al mittente) e "invio reale"
- Vincolo tecnico rispettato: i messaggi PEC non supportano il CCN (BCC) verso indirizzi PEC, quindi tutti i destinatari vanno in TO o CC
- Log completo degli invii per tracciabilità

### Notifiche e reminder

- Vista dedicata per le pratiche in stato "in attesa" da oltre 30 giorni (soglia configurabile)
- Transizione automatica "inviata" verso "in_attesa" dopo N giorni configurabili (default 7), eseguibile via API o cron job
- Notifiche email automatiche (in produzione, via SMTP configurato):
  - al referente territoriale quando una segnalazione viene inviata in revisione
  - al volontario quando la segnalazione viene rifiutata con nota
  - al volontario quando la PEC viene inviata con successo
- Supporto alla logica di recidiva: ogni segnalazione può avere una segnalazione precedente collegata, con livello di recidiva crescente e precompilazione automatica dei campi del luogo
- L'escalation verso la Procura della Repubblica NON è automatizzata: il sistema segnala solo la soglia di recidiva, la decisione resta umana

### Pannello di amministrazione

- Gestione completa di regioni, province, comuni e utenti
- Modifica dei riferimenti normativi regionali senza toccare codice
- Verifica periodica dei dati dei sindaci tracciata nel campo `noteAggiornamento`; il pannello evidenzia automaticamente i comuni con sindaco non verificato da oltre 6 mesi
- Validazione input lato server con zod su tutti gli endpoint di creazione

### Export e portabilità

- Export CSV delle segnalazioni con tutte le colonne principali, compatibile Excel (UTF-8 con BOM)
- Pulsante di export nella lista segnalazioni, con rispetto dei filtri attivi
- Anteprima lettera PEC stampabile come PDF (via browser), con opzione di includere gli allegati fotografici incorporati

### PWA installabile

- Manifest, service worker e icone 192x192 / 512x512
- L'app è installabile su Android, iOS e desktop come applicazione nativa
- Caching minimale della shell per uso offline di base

### Sicurezza

- Rate limiting sul login con backoff progressivo: 3 tentativi falliti consecutivi bloccano l'accesso per 5 minuti; blocchi ripetuti entro un'ora escalano a 15 minuti, poi 1 ora, poi 24 ore (vedi `src/lib/rate-limit.ts`)
- Validazione tipo e dimensione allegati con verifica magic bytes anti-spoofing (max 10 MB, JPEG/PNG/WebP/PDF; per WebP verifica sia "RIFF" sia "WEBP")
- Password hashate con bcrypt (cost 12), password policy rafforzata (min 12 caratteri, 4 classi, max 2 consecutivi uguali)
- Matrice delle transizioni lecite tra stati (l'amministratore può forzare con ?force=1)
- Autorizzazione RBAC con competenza territoriale fail-closed: un referente senza territorio assegnato non vede alcuna segnalazione
- Anti-CSRF: cookie SameSite=Strict + verifica Origin/Referer nel middleware (richiede `NEXT_PUBLIC_BASE_URL` in produzione)
- Validazione latitudine/longitudine nei range geografici reali (-90/+90, -180/+180)
- CSV/Formula Injection: sanificazione di campi che iniziano con `=`, `+`, `-`, `@` nell'export CSV
- Update atomiche con clausola WHERE su stato corrente in approva/rifiuta/DELETE segnalazioni (previene race condition)
- DELETE allegati con diritto di modifica (non sola visibilità) e blocco se stato non modificabile

---

## Stack tecnico

| Livello | Tecnologia | Motivazione |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **React 19** + **TypeScript 5** | Stack mainstream, tipizzato, mantenuto attivamente |
| UI | **Tailwind CSS 4** + **shadcn/ui** | Componenti accessibili e personalizzabili, niente lock-in |
| Database | **PostgreSQL 16** (via **Prisma ORM**) | ACID, MVCC per concorrenza multi-writer, JSONB per dati strutturati, full-text search nativo |
| Autenticazione | Sessioni via cookie HTTP-only + **bcryptjs** | Nessuna dipendenza da servizi esterni, password hashate |
| Validazione | **zod** | Validazione input lato server con tipi TypeScript |
| Generazione PDF | Template HTML → stampa via browser | Nessuna dipendenza da Word/Office |
| Invio PEC e notifiche | **Nodemailer** via SMTP | Standard, supporta qualunque provider PEC italiano |
| PWA | **manifest.json** + service worker | App installabile, caching offline minimale |

Tutte le tecnologie sono open source con licenze permissive (MIT, Apache 2.0, ISC).

---

## Architettura

```
┌─────────────────────────────────────────────────────────┐
│  PWA (client)                                            │
│  - Form segnalazione, cattura foto/GPS                   │
│  - Dashboard per volontari/referenti/admin               │
│  - Anteprima e stampa PDF della lettera PEC              │
└───────────────────────────┬───────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│  Backend applicativo (Next.js API Routes)                 │
│  - Autenticazione e ruoli (volontario / referente / admin) │
│  - Genera numero di protocollo univoco                     │
│  - Compone la lettera da template + tabella di regole       │
│  - Gestisce il flusso di approvazione                        │
│  - Invia la PEC via SMTP (se configurato)                    │
│  - Espone i reminder per le pratiche in attesa              │
└───────────────────────────┬───────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                                       ▼
┌──────────────────────┐            ┌─────────────────────────┐
│ Dati di configurazione │            │ Dati applicativi          │
│ (regioni_leggi,        │            │ (segnalazioni, allegati,  │
│  province, comuni,     │            │  storico_stati, log_invii)│
│  users)                │            │                            │
│ editabili senza codice │            │                            │
└──────────────────────┘            └─────────────────────────┘
```

Il principio guida: **il backend non contiene mai hard-coded** riferimenti normativi, indirizzi PEC o nomi di sindaci. Tutto quel materiale è dato, non codice, e vive nelle tabelle di configurazione.

---

## Installazione e avvio

### Prerequisiti

- **Node.js 22+** (richiesto per lo sviluppo e la produzione)
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
   npm run db:push
   ```

5. Popola il database con i dati di configurazione di esempio (regioni, leggi, province, comuni):

   ```bash
   npm run db:seed
   ```

   Poi crea il primo utente amministratore (email, nome e password vengono
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

- Non richiedono database né backend attivi: la verifica delle credenziali
  avviene interamente nel browser (vedi `src/lib/demo-mode.ts`), quindi
  funzionano anche a server spento o offline.
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

Lo script chiede email, nome, ruolo e password interattivamente e li
scrive già cifrati nel database: nessuna credenziale reale resta in un
file del repository.

---

## Flusso di una segnalazione

Stati previsti, in ordine di avanzamento naturale:

1. **Bozza**: creata dal volontario sul campo, salvabile con foto/GPS
2. **In revisione**: inviata al referente territoriale competente
   - Se il referente **rifiuta**: torna in stato Bozza con nota del referente
   - Se il referente **approva**: passa allo stato successivo
3. **Approvata**: pronta per l'invio della PEC; disponibile la "simula spedizione" (invio di prova solo al mittente)
4. **Inviata**: la PEC è stata inviata a Comune (e ARPA se previsto); la pratica ha un numero di protocollo definitivo e non è più modificabile
5. **In attesa**: stato di monitoraggio, con reminder periodici finché non arriva una risposta
6. **Chiusa positiva**: l'impianto è stato adeguato
7. **Chiusa negativa**: nessun adeguamento; da valutare manualmente l'escalation

L'escalation fino alla segnalazione alla Procura della Repubblica **non è automatizzata**: il sistema si limita a segnalare che una pratica ha raggiunto una soglia di recidiva, la decisione resta umana.

---

## Configurazione dell'invio PEC in produzione

In ambiente di sviluppo l'invio PEC è in modalità "demo": stampa solo un log e non invia nulla. Per abilitare l'invio reale, aggiungi al file `.env` le variabili:

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
# BACKUP_ENCRYPTION_KEY=

# Directory dei backup (default: ./backups)
# BACKUP_DIR=

# Path assoluto del storage degli allegati (default: ./storage/uploads).
# Utile in deploy Docker dove il volume è montato altrove.
# STORAGE_ROOT=
```

**Nota importante**: l'account PEC deve essere intestato a CieloBuio (associazione), non al volontario sviluppatore. Verificare che il provider PEC scelto supporti l'accesso SMTP con credenziali applicative (non solo webmail).

### Vincoli tecnici delle caselle PEC italiane

- I messaggi inviati da un indirizzo PEC possono avere destinatari CC in PEC, ma **non supportano il CCN (BCC)** verso indirizzi PEC. Il sistema rispetta questo vincolo mettendo tutti i destinatari in TO o CC.

---

## Sicurezza

Il progetto è stato sottoposto a un audit di sicurezza metodico e completo sull'intero codebase, coprendo tutte le route API, il middleware, le librerie di autenticazione/autorizzazione, la generazione lettere PEC, il rate limiting, l'upload file, i componenti frontend, lo schema Prisma, gli script di manutenzione e la configurazione di deploy. Vedi [SECURITY.md](SECURITY.md) per il dettaglio completo.

Misure principali:
- **Autenticazione**: bcrypt cost 12, password policy rafforzata (12+ caratteri, 4 classi), session rotation al login, cookie `__Host-` prefix in produzione (prevenzione session fixation via subdomain)
- **Invalidazione sessioni admin**: cambio password/ruolo/territorio da admin distrugge tutte le sessioni attive dell'utente (prevenzione persistenza dopo compromissione)
- **Rate limiting doppio**: login con limite per IP **e** per email (prevenzione bypass via `X-Forwarded-For` spoofabile), escalation blocchi (5 min, 15 min, 1 ora, 24 ore)
- **Rate limiting admin**: POST/PATCH `/api/config/users` limitati a 30/ora (difesa in profondità contro script automatizzati)
- **Autorizzazione**: RBAC con competenza territoriale, prevenzione IDOR su tutti gli endpoint, fail-closed per referenti senza territorio
- **Business logic**: stato `approvata` blocca modifiche PUT e upload allegati; il volontario proprietario può eliminare allegati SOLO in stato "bozza" (non in "in_revisione"): previene alterazione del pacchetto probatorio dopo invio in revisione al referente
- **CSRF**: cookie SameSite=Strict + verifica Origin/Referer nel middleware, fail-closed in produzione senza `NEXT_PUBLIC_BASE_URL`
- **Firewall obbligatorio**: SETUP.md documenta configurazione `ufw` con `deny 3000/tcp` + `HOSTNAME=127.0.0.1` in systemd per prevenire bypass del rate limiting via accesso diretto a Node
- **XSS**: HTML escaping di tutti i contenuti utente, CSP strict su script-src (con style-src 'unsafe-inline' per Next.js), escaping defense-in-depth anche nei campi interpolati della lettera PEC
- **File upload**: directory privata, download autenticato, magic bytes verification (incluso RIFF+WEBP per WebP), path traversal protection, limite 4 allegati per segnalazione
- **Email header injection**: validazione zod + regex anti-CRLF su tutti i campi PEC
- **Security headers**: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, `X-Powered-By` disabilitato
- **Audit trail**: storico stati completo, log invii PEC, audit log export CSV (GDPR art. 30)
- **GDPR retention**: cron job di anonimizzazione automatica delle segnalazioni più vecchie di 10 anni (allineato a PRIVACY.md), con rimozione di PII (indirizzo, GPS, descrizioni, allegati) e preservazione del record per audit/statistica
- **Privacy**: rate limit su export CSV (5/ora per utente) per prevenire scarichi massivi non tracciati

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

---

## Qualità del codice e test

Il progetto mantiene una **copertura del 100%** su tutte le metriche (statements, branches, functions, lines) su TUTTO il codice sorgente:
- `src/lib/` (16 moduli di logica business: auth, cron-utils, db, demo-data, demo-mode, gdpr, lettera, logger, notifiche, path-guard, protocollo, rate-limit, totp, types, utils, validation)
- `src/middleware.ts` (security headers, CSRF)
- `src/hooks/use-toast.ts` (reducer toast, hook React)
- `src/components/ui/` (13 componenti shadcn/ui)
- `src/components/app/` (10 componenti app, inclusi dettaglio-segnalazione 740 righe, form-segnalazione 860 righe, pannello-admin 1056 righe)
- `src/app/api/` (30 route API con test integration)
- `src/app/layout.tsx`, `src/app/page.tsx`
- `scripts/cron-jobs.ts` (maintenance GDPR)

### Statistiche attuali

- **Test totali**: 1562 test passing (60 file di test)
  - 396 test unitari su `src/lib/` (inclusi 27 test su `path-guard.ts`, 11 test su `cron-utils.ts`, 19 test su `protocollo.ts`, 17 test su `lettera.ts`)
  - 460 test di integrazione su 30 API routes (inclusi 23 test su `/api/auth/2fa`)
  - 75 test di sicurezza informatica (OWASP Top 10, tutti con verifiche reali su codice sorgente)
  - 33 test su feature enterprise (health, docs, metrics con token Prometheus, TOTP integrato con anti-lockout, backup encryption completa)
  - 488 test su componenti React (473 app + 15 layout/page)
  - 56 test su 13 componenti UI shadcn/ui
  - 25 test su middleware
  - 20 test su hook (use-toast)
  - 8 test su cron-jobs
- **Coverage**: **100% statements, 100% branches, 100% functions, 100% lines** su tutto il codice sorgente coperto (esclusi tipi, dati demo, client DB e script CLI non testati)
- **TypeScript strict**: 0 errori (`tsc --noEmit` pulito)
- **ESLint**: 0 errori, 0 warning
- **Build**: Next.js 16 standalone riuscito

### Moduli testati al 100%

| Modulo | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/lib/auth.ts` | 100% | 100% | 100% | 100% |
| `src/lib/demo-mode.ts` | 100% | 100% | 100% | 100% |
| `src/lib/lettera.ts` | 100% | 100% | 100% | 100% |
| `src/lib/notifiche.ts` | 100% | 100% | 100% | 100% |
| `src/lib/protocollo.ts` | 100% | 100% | 100% | 100% |
| `src/lib/rate-limit.ts` | 100% | 100% | 100% | 100% |
| `src/lib/utils.ts` | 100% | 100% | 100% | 100% |
| `src/lib/validation.ts` | 100% | 100% | 100% | 100% |
| `src/middleware.ts` | 100% | 100% | 100% | 100% |
| `src/hooks/use-toast.ts` | 100% | 100% | 100% | 100% |
| `src/components/ui/*` (13 file) | 100% | 100% | 100% | 100% |
| `src/app/api/*` (30 route) | 100% | 100% | 100% | 100% |
| `scripts/cron-jobs.ts` | 100% | 100% | 100% | 100% |

### API routes testate con integration test

Tutte le 30 API routes hanno test di integrazione dedicati in `src/app/api/__tests__/`:

- `auth/login`, `auth/logout`, `auth/me`, `auth/2fa` (autenticazione, rate limit IP+email, session rotation, 2FA TOTP con anti-lockout)
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
- `middleware` (security headers, CSRF check, fail-closed senza NEXT_PUBLIC_BASE_URL)

### Componenti frontend testati

- `AutoreLink`, `LoginScreen` (11 test)
- `VistaReminder`, `Dashboard`, `ListaSegnalazioni`, `AppShell` (92 test)
- `DettaglioSegnalazione` (126 test - tutti gli stati, ruoli, azioni, demo mode)
- `FormSegnalazione` (90 test - creazione, modifica, recidiva, allegati, GPS, validazione)
- `PannelloAdmin` (87 test - 4 tab: regioni, province, comuni, utenti con CRUD completo)
- `useToast` hook (20 test - reducer, ADD/UPDATE/DISMISS/REMOVE, TOAST_LIMIT)
- Componenti UI shadcn (38 test - Button, Badge, Card, Checkbox, Input, Label, Textarea, Switch, Tabs, Dialog, Select, Toast, Toaster)

### Esecuzione dei test

```bash
# Test singoli
npm run test

# Test con coverage
npm run test:coverage

# Test in watch mode
npm run test:watch
```

### Categorie di test

- **Test unitari** (`src/lib/__tests__/`): 396 test su funzioni pure, helper autenticazione, generazione lettera, protocollo, rate limiting, validazione Zod, notifiche email, modalità demo, path-guard, TOTP, cron-utils
- **Test integration API** (`src/app/api/__tests__/`): 460 test su tutte le 30 route handler con mock di DB (Prisma), next/headers, nodemailer, bcryptjs, fs/promises
- **Test sicurezza informatica** (`src/__tests__/security-attack-suite.test.ts`): 75 test di penetrazione simulati organizzati per categoria OWASP Top 10, tutti con verifiche reali su codice sorgente:
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
- **Test feature enterprise** (`src/__tests__/enterprise-features.test.ts`): 33 test su health, docs, metrics, TOTP anti-lockout, backup encryption
- **Test middleware** (`src/__tests__/middleware.test.ts`): 25 test su security headers, CSRF check, fail-closed
- **Test componenti React** (`src/components/app/__tests__/`): 473 test su rendering, interazioni, stati, errori, demo mode
- **Test layout e page** (`src/app/__tests__/`): 15 test su metadata, viewport, struttura di base
- **Test componenti UI** (`src/components/ui/__tests__/`): 56 test su 13 componenti shadcn/ui (button, input, card, dialog, select, toast, toaster, switch, checkbox, tabs, textarea, label, badge)
- **Test hook** (`src/hooks/__tests__/`): 20 test su use-toast (reducer, dispatch, cleanup)
- **Test scripts** (`scripts/__tests__/`): 8 test su cron-jobs (pulizia sessioni, transizioni, anonimizzazione GDPR, errori)
- **Test edge cases**: rami difensivi (fail-closed, fallback, catch block, rami `??` e `&&`)

---

## Privacy e conformità normativa

Vedi [PRIVACY.md](PRIVACY.md) per l'analisi completa GDPR e normative PEC.

Punti chiave:
- **Titolare del trattamento**: CieloBuio (ODV)
- **Basi giuridiche**: consenso (volontari) e interesse legittimo (referenti, dati pubblici amministratori)
- **Retention**: segnalazioni 10 anni (termine prescrittivo), sessioni 8 ore
- **Diritti GDPR**: accesso, rettifica, cancellazione (limitata per obblighi legali), portabilità (export CSV disponibile)
- **PEC**: rispetto del DPR 160/2010, no BCC verso PEC, valore legale equivalente a raccomandata A/R
- **Escalation alla Procura**: NON automatizzata, decisione umana del direttivo

---

## Struttura del progetto

```
.
├── prisma/
│   └── schema.prisma           # Schema del database (tutte le tabelle)
├── scripts/
│   ├── seed.ts                 # Script di popolamento dati di configurazione (no utenti)
│   ├── create-admin.ts         # Crea un utente interattivamente (email/password a runtime)
│   ├── cron-jobs.ts            # Maintenance periodica (transizioni, pulizia sessioni, GDPR)
│   ├── backup-db.ts            # Backup del database in JSON con cifratura AES-256-GCM
│   ├── restore-db.ts           # Ripristino del database da backup cifrato
│   ├── build-pages.mjs         # Helper build statica per GitHub Pages (modalità demo)
│   ├── deploy.sh               # Automazione deploy VPS (backup, pull, build, restart)
│   └── generate-icons.py       # Generazione icone PWA (192x192, 512x512)
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
│   │   ├── globals.css         # Stili globali (tema chiaro, product register)
│   │   ├── layout.tsx          # Layout root (manifest PWA, service worker)
│   │   └── page.tsx            # Entry point (app shell)
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
│   │   │   └── use-session.ts         # Hook sessione
│   │   └── ui/                 # Componenti shadcn/ui
│   └── lib/
│       ├── auth.ts             # Autenticazione, ruoli, sessioni
│       ├── cron-utils.ts       # Logica maintenance centralizzata (sessioni, transizioni, GDPR, orfani)
│       ├── db.ts               # Client Prisma con retry automatico
│       ├── demo-mode.ts        # Credenziali e logica della modalità demo offline (sola lettura)
│       ├── demo-data.ts        # Dati statici mostrati in modalità demo
│       ├── gdpr.ts             # Anonimizzazione GDPR segnalazioni
│       ├── lettera.ts          # Motore generazione lettera PEC
│       ├── logger.ts           # Logger strutturato Pino con redazione PII
│       ├── notifiche.ts        # Notifiche email a referenti e volontari
│       ├── path-guard.ts       # Path traversal protection centralizzata
│       ├── protocollo.ts       # Generazione numero protocollo (transazione atomica)
│       ├── rate-limit.ts       # Rate limiting in-memory con escalation
│       ├── totp.ts             # Libreria TOTP (RFC 6238) per 2FA
│       ├── types.ts            # Tipi condivisi + costanti (TRANSIZIONI_LECITE, MAX_ALLEGATI)
│       ├── utils.ts            # Utility generiche (cn)
│       └── validation.ts       # Schemi zod per validazione input
├── public/
│   ├── icon-192.png            # Icona PWA 192x192
│   ├── icon-512.png            # Icona PWA 512x512
│   ├── manifest.json           # Manifest PWA
│   ├── sw.js                   # Service worker
│   ├── sw-register.js          # Registrazione service worker (script esterno)
│   └── logo.svg                # Logo
├── storage/
│   └── uploads/                # Allegati caricati (directory PRIVATA, gitignored, creata al primo upload)
├── .dockerignore               # Esclusioni build context Docker (previene leak di secrets)
├── .env.example                # Template variabili d'ambiente
├── Caddyfile                   # Reverse proxy + HTTPS automatico per la produzione
├── Dockerfile                  # Build multi-stage per deploy containerizzato
├── docker-compose.yml          # Stack completo: app + PostgreSQL + Caddy
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
├── vitest.config.ts            # Configurazione Vitest con coverage
├── eslint.config.mjs           # Configurazione ESLint
├── components.json             # Configurazione shadcn/ui
├── postcss.config.mjs          # Configurazione PostCSS (Tailwind CSS 4)
├── next-env.d.ts               # Tipi Next.js
├── next.config.ts              # Configurazione Next.js (standalone output)
└── next.config.pages.ts        # Configurazione Next.js per build statica GitHub Pages (demo)
```

---

## Migrazione dal sistema Excel/VBA esistente

Il progetto non parte da zero: esiste già un sistema funzionante in Excel/VBA + Word + Outlook, con segnalazioni vere già inviate a diversi Comuni italiani. Lo schema del database e il testo della lettera PEC sono derivati direttamente da quel sistema.

### Procedura di migrazione

1. Esportare i fogli `LEGGI`, `Comuni`, `Province`, `ARPA` dal file Excel originale in CSV
2. Importarli nelle tabelle corrispondenti (`regioni_leggi`, `comuni`, `province`) — PostgreSQL di default
3. Verificare manualmente i dati dei sindaci (il manuale originale segnala che erano già parzialmente obsoleti al momento della compilazione)
4. Esportare il foglio `ARCHIVIO` e importarlo nella tabella `segnalazioni`, impostando lo stato iniziale come `inviata`
5. Copiare i file della cartella `ARCHIVIO SEGNALAZIONI` (PDF, Word, foto) nello storage, collegandoli alla riga corrispondente in `allegati`
6. Tenere il file Excel originale come sistema di emergenza finché il nuovo sistema non ha gestito con successo un numero adeguato di segnalazioni reali in parallelo

---

## Manutenzione e continuità

Il progetto è progettato per sopravvivere all'abbandono del volontario sviluppatore originale. Per garantire la continuità:

### Aggiornamento dei dati di configurazione

- **Comuni, sindaci, PEC**: modificabili dal pannello amministrazione senza toccare codice. Si raccomanda una verifica periodica (almeno semestrale) dei dati dei sindaci, tracciata nel campo `noteAggiornamento`. Il pannello admin evidenzia automaticamente in giallo i comuni con sindaco non verificato da oltre 6 mesi
- **Riferimenti normativi regionali**: una riga di `regioni_leggi` per regione. Se una regione cambia la sua norma, si aggiorna la riga, non il software
- **Referenti territoriali**: gestiti dal pannello utenti, assegnati a provincia o regione

### Job schedulati (cron)

In produzione configurare due job schedulati:

1. **Maintenance giornaliero** (es. alle 3:00):
   ```bash
   0 3 * * * cd /path/to/project && npm run cron:reminder >> logs/cron.log 2>&1
   ```
   Effettua: transizione automatica "inviata" verso "in_attesa" dopo `TRANSIZIONE_INVIATA_GIORNI` (default 7), pulizia sessioni scadute.

2. **Backup giornaliero** (es. alle 2:00):
   ```bash
   0 2 * * * cd /path/to/project && npm run db:backup >> logs/backup.log 2>&1
   ```
   Esporta tutte le tabelle in JSON in `backups/` con retention a 30 giorni.

### Backup

- Il database PostgreSQL va backuppato con `pg_dump` (vedi scripts/backup-db.ts per il backup JSON redatto)
- In produzione, usare `pg_dump` schedulato
- Gli allegati sono in `storage/uploads/` (directory privata, fuori da `public/`): includerli nel backup. La vecchia directory `public/uploads/` resta vuota per retrocompatibilità.

### Export dei dati

- Le segnalazioni sono esportabili in CSV con un click dal pannello admin (con filtri attivi rispettati)
- Nessun formato proprietario, nessun lock-in verso sviluppatori o fornitori terzi

### Configurazione PostgreSQL

Il progetto usa PostgreSQL di default. La stringa di connessione è definita in `.env`:

```
DATABASE_URL="postgresql://cielobuio:password@localhost:5432/cielobuio_segnalazioni?schema=public"
```

Per inizializzare il database: `npm run db:push` (applica lo schema) oppure `npm run db:migrate:dev` (crea migrazioni versionate).

---

## Contribuire

Le contribuzioni sono benvenute. Vedi [CONTRIBUTING.md](CONTRIBUTING.md) per le linee guida.

### Cose da tenere a mente

- **Mai inserire testo normativo o riferimenti a leggi direttamente nel codice**: tutto deve passare per le tabelle di configurazione
- **Mai aggiungere dipendenze da servizi a pagamento o con pricing che può cambiare**: solo open source con licenza permissiva
- **Mai automatizzare decisioni legali**: l'escalation verso la Procura resta una decisione umana
- **Documentare ogni cambiamento architetturale** in questo README

---

## Supporto e segnalazioni

- **Segnalazioni, feature request, domande**: apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
- **Contatto diretto (anche per segnalazioni sensibili che non vuoi esporre pubblicamente)**: fabiot2801@gmail.com
- **Vulnerabilità di sicurezza**: vedi [SECURITY.md](SECURITY.md) per la procedura di divulgazione responsabile

---

## Licenza

Copyright © 2026 CieloBuio, Coordinamento per la protezione del cielo notturno.
Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio).
Contatto: fabiot2801@gmail.com

Rilasciato sotto licenza **GNU Affero General Public License v3.0** (AGPL-3.0). Vedi il file [LICENSE](LICENSE) per il testo completo.

Questa licenza garantisce che chiunque possa usare, studiare, modificare e redistribuire il software, ma richiede che eventuali versioni modificate offerte come servizio network restino open source con la stessa licenza; questo protegge CieloBuio dal rischio che qualcuno possa chiudere il codice in futuro.
