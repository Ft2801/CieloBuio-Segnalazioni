# Changelog

Tutti i cambiamenti notevoli del progetto vengono documentati in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.0.0/),
e il progetto adotta il [versionamento semantico](https://semver.org/lang/it/).

## [1.0.0] - 2026-07-14

Prima release stabile. Sostituisce il sistema precedente basato su Excel/VBA + Word + Outlook desktop.

### Applicazione

- PWA con tema chiaro product register, palette restrained con accent indaco
- PWA installabile con manifest, service worker e icone 192x192 / 512x512
- Sistema di autenticazione con quattro ruoli: volontario, referente territoriale (provinciale o regionale), amministratore
- Sessioni via cookie HTTP-only con hash bcrypt (cost factor 12) delle password
- Cookie di sessione con prefisso `__Host-` in produzione
- Rate limiting sul login con escalation dei blocchi (3 tentativi, poi 5 min, 15 min, 1 ora, 24 ore)
- Rate limiting login doppio (per IP e per email)
- Password policy: min 12 caratteri, 4 classi di caratteri, max 2 consecutivi uguali
- Autenticazione a due fattori (2FA) TOTP conforme a RFC 6238 con protezione anti-lockout
- Form di creazione/modifica segnalazioni con acquisizione indirizzo, GPS, derivazione automatica comune/provincia/regione/legge/PEC
- 7 checkbox di tipologia non conformità e problemi riscontrati
- Upload fino a 4 allegati per segnalazione con validazione magic bytes anti-spoofing (JPEG, PNG, WebP, PDF)
- Allegati salvati in directory privata, scaricabili tramite route autenticata
- Flusso di approvazione a 7 stati con matrice delle transizioni lecite
- Numero di protocollo univoco nel formato YYYYMMGG-REG-PV-NCXX generato atomicamente lato server
- Anteprima della lettera PEC stampabile come PDF via browser
- Storico completo degli stati con audit trail
- Notifiche email automatiche a referenti e volontari
- Supporto alla logica di recidiva con livello crescente e precompilazione
- Pannello di amministrazione per regioni, province, comuni e utenti
- Export CSV delle segnalazioni con sanitizzazione anti formula injection

### Sicurezza

- Path traversal protection centralizzata in `src/lib/path-guard.ts` con validazione segmenti (incluso blocco del segmento `.`), resolve normalizzato, check startsWith defense-in-depth, reject caratteri di controllo
- Validazione formato CUID in upload prima della lookup DB (difesa in profondità)
- Mitigazione timing side-channel nel login con hash sentinella pre-calcolato per user enumeration
- Hash session token (SHA-256) nel DB: in caso di leak del DB i token non sono riutilizzabili
- TOTP anti-replay (RFC 6238 §5.2) con tracking del lastUsedTimestep per utente
- Password policy con limite 72 byte bcrypt (no truncation silenziosa)
- Validazione incrociata ruolo/territorio in nuovoUtenteSchema (referente richiede provincia/regione)
- CSRF: cookie SameSite=Strict + verifica Origin/Referer fail-closed in produzione con match esatto (no substring)
- Security headers: CSP strict su script-src (style-src 'unsafe-inline' per Next.js), HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- CSP esplicita sulla route lettera HTML (defense-in-depth oltre middleware)
- Cache-Control: private, no-store su /api/auth/me e altre route con PII (previene cache hit cross-user)
- Protezione anti email header injection (CRLF) su tutti i campi PEC
- Protezione anti CSV/formula injection nell'export
- Race condition prevention con updateMany atomiche su tutte le transizioni di stato (inclusa PUT segnalazioni con WHERE su stato atteso)
- Transazione interattiva `$transaction(async (tx) => …)` per la transizione automatica "inviata → in_attesa" del cron: updateMany e creazione storicoStato sono atomici, preservando l'invariante "ogni transizione di stato ha il suo audit record"
- State machine integrity: stato "inviata" non forzabile via cambia-stato nemmeno con ?force=1
- Rate limiting su tutti gli endpoint sensibili (login, upload, PEC, export, config utenti)
- 2FA TOTP con setup a 2 step anti-lockout, anti-disarm silenzioso, gate nel login
- Endpoint `/api/metrics` con token via Bearer header only (rimosso ?token= dai log proxy)
- Cifratura at-rest completa dei backup con AES-256-GCM (DB JSON + allegati fisici)
- Symlink traversal protection in backup-db.ts (lstat + realpath check)
- File size limit 500MB in backup per prevenire OOM
- Sanitizzazione `passwordHash`, `totpSecret`, `totpVerifiedAt` nei backup
- Eliminazione allegati con ordine DB-prima-del-filesystem: in caso di errore del filesystem il DB resta consistente e il cron `cleanupFileOrfani` rimuove i file residui
- Cache transporter SMTP con chiave che include host, porta, utente e password: la rotazione delle credenziali produce un nuovo transporter invece di riusare quello obsoleto
- `fromAddress` PEC con `||` invece di `??` per trattare correttamente `PEC_FROM=""` come "non configurato"
- Caddyfile con `form-action 'self'` nella CSP di base per defense-in-depth coerente con il middleware Next.js
- Logger Pino strutturato con redazione automatica di campi sensibili a ogni profondità (inclusi PII pec/emailOrdinaria/indirizzo/firma)
- Invalidazione sessioni su cambio password/ruolo/territorio da admin
- Notifiche email a referenti territorialmente competenti (rimossa cascata a tutti gli admin)
- SMTP transporter derivato dalla porta (465 implicit TLS, 587 STARTTLS)

### Privacy e GDPR

- Anonimizzazione automatica delle segnalazioni chiuse oltre 10 anni (configurabile)
- Anonimizzazione transazionale: deleteMany allegati + update segnalazione + create storico in un'unica transazione (atomicità garantita)
- Resilienza GDPR: errore su singola segnalazione non blocca l'anonimizzazione delle restanti
- Retention basata su `dataChiusura` (non `updatedAt`) per calcolo corretto della finestra GDPR, con fallback su `updatedAt` per segnalazioni chiuse prima dell'introduzione del campo
- Rimozione PII completa: volontarioId, indirizzo, CAP, coordinate GPS, descrizioni, allegati
- Cancellazione fisica dei file su disco durante l'anonimizzazione (best-effort, con cleanup orfani fallback)
- Pulizia automatica dei file orfani in `storage/uploads/` via cron job con normalizzazione formati urlStorage (attuale + legacy)
- Audit trail completo per tracciabilità (storico stati, log invii PEC, audit export CSV)

### Architettura

- Stack: Next.js 16, React 19, TypeScript 5, Prisma 6, PostgreSQL 16, Tailwind CSS 4, Zod 4
- Script TypeScript eseguibili via `tsx` (compatibile Node.js e Docker senza bun)
- Docker multi-stage build con utente non-root, health check con curl, NEXT_PUBLIC_BASE_URL come build arg
- .dockerignore per ridurre build context e prevenire leak di secrets/PII nel builder
- Lockfile `package-lock.json` versionato per installazione deterministica
- Logica cron centralizzata in `src/lib/cron-utils.ts` (condivisa tra cron automatico e API manuale) con validazione difensiva delle variabili d'ambiente
- Cron jobs con advisory lock PostgreSQL per prevenire esecuzioni concorrenti
- Backup con symlink traversal protection (lstat + realpath) e file size limit
- Deploy script con fail-closed su backup fallito (FORCE_DEPLOY per override esplicito)
- Restore script (scripts/restore-db.ts) per disaster recovery completo
- Limite 4 allegati e dimensione massima 10 MB centralizzati in `src/lib/types.ts`
- Ricerca testuale case-insensitive su PostgreSQL (`mode: "insensitive"`)
- Query lista segnalazioni ottimizzata con `_count` invece di caricare record allegati completi
- Dockerfile con commento esplicito sul binding `HOSTNAME=0.0.0.0` (contesto Docker vs systemd)
- Prisma schema con indici su comuneId, segnalazionePrecedenteId, timestamp (storico e log PEC), esito log PEC, ruolo/provinciaId/regioneId/attivo su User, vincolo unique (nome, provinciaId) su Comune
- ESLint con regole critical riattivate (react-hooks/exhaustive-deps, prefer-const, no-unreachable, no-fallthrough)
- PWA con manifest arricchito (id, scope, separate any/maskable icons, brand-aligned theme_color, start_url relativo per compatibilità GitHub Pages)
- Service worker con precache tollerante, fallback 503 esplicito, LRU eviction
- Caddyfile con CSP (incluso `form-action 'self'`), X-Frame-Options, Permissions-Policy, request_body max_size, log stdout
- Restore DB con `$transaction([deleteMany, createMany])` per tabella: la tabella non resta vuota se la createMany fallisce
- `BACKUP_DIR` risolta in modo assoluto in `scripts/backup-db.ts` per coerenza con `scripts/restore-db.ts` (entrambi usano `path.resolve(cwd, "backups")` quando `BACKUP_DIR` non è impostata)
- Build statica (`scripts/build-pages.mjs`) con timeout di 10 minuti su `next build` per evitare blocchi indefiniti in CI

### Endpoint API

- `auth/login`, `auth/logout`, `auth/me`, `auth/2fa` (autenticazione, 2FA TOTP, session rotation)
- `segnalazioni` (GET lista con ricerca case-insensitive, POST creazione, GET export CSV)
- `segnalazioni/[id]` (GET dettaglio, PUT modifica, DELETE con race condition prevention)
- `segnalazioni/[id]/approva`, `/rifiuta`, `/cambia-stato` (matrice TRANSIZIONI_LECITE)
- `segnalazioni/[id]/invia-pec`, `/simula-pec` (SMTP mode, demo mode, allegati)
- `segnalazioni/[id]/lettera` (anteprima HTML con escaping XSS)
- `upload` (magic bytes, CUID validation, transazione atomica per limite 4 allegati)
- `allegati` (DELETE con competenza territoriale centralizzata)
- `allegati/[id]/download`, `/preview` (path traversal protection, Content-Disposition)
- `config/regioni`, `/province`, `/comuni`, `/users` (CRUD completo, admin-only)
- `stats` (dashboard con 10 count in parallelo)
- `reminder` (GET lista, POST cleanup/auto-transition/gdpr-anonymize)
- `health` (health check per monitoring)
- `docs` (OpenAPI 3.0.3 con cookie dinamico)
- `metrics` (Prometheus con token auth)

### Test

- **1562 test** passing (60 file di test)
- **100% statements, 100% branches, 100% functions, 100% lines** su tutto il codice sorgente coperto (esclusi tipi, dati demo, client DB e script CLI non testati)
- 396 test unitari su `src/lib/`
- 460 test di integrazione su 30 API routes
- 75 test di sicurezza informatica (OWASP Top 10 con verifiche reali su codice sorgente)
- 33 test su feature enterprise (health, docs, metrics, TOTP, backup)
- 25 test su middleware
- 473 test su componenti React app + 56 su componenti UI shadcn/ui + 15 su layout/page
- 20 test su hook use-toast
- 8 test su cron-jobs
- TypeScript strict: 0 errori
- ESLint: 0 errori, 0 warning

### Documentazione

- README.md con panoramica, stack tecnico, architettura, installazione (Node.js 22+), account demo, flusso segnalazioni, sicurezza, qualità del codice e test, privacy, struttura progetto, migrazione, manutenzione
- SETUP.md con guida passo-passo dal setup locale al deploy VPS (Caddy + systemd + cron + firewall) e deploy Docker Compose, numerazione sezioni coerente (1-15), script NodeSource per Node.js 22
- SECURITY.md con misure di sicurezza implementate, test OWASP Top 10, variabili d'ambiente, procedura di divulgazione responsabile, riferimento corretto al comando di avvio produzione (`npm run start`)
- PRIVACY.md con analisi GDPR, retention basata su `dataChiusura`, anonimizzazione automatica, contatto per richieste GDPR
- CONTRIBUTING.md con linee guida per contributori, requisiti coverage, riferimenti a GitHub issues
- LICENSE AGPL-3.0

### Supporto e segnalazioni

- **Segnalazioni, feature request, domande**: apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
- **Contatto diretto (anche per segnalazioni sensibili)**: fabiot2801@gmail.com
- **Vulnerabilità di sicurezza**: vedi SECURITY.md per la procedura di divulgazione responsabile

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
Repository: https://github.com/Ft2801/CieloBuio-Segnalazioni
Contatto: fabiot2801@gmail.com
