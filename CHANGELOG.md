# Changelog

Tutti i cambiamenti notevoli del progetto vengono documentati in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.0.0/),
e il progetto adotta il [versionamento semantico](https://semver.org/lang/it/).

## [1.0.0] - 2026-07-12

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

- Path traversal protection centralizzata in `src/lib/path-guard.ts` con validazione segmenti e resolve normalizzato
- Validazione formato CUID in upload prima della lookup DB (difesa in profondità)
- Mitigazione timing side-channel nel login con hash sentinella per user enumeration
- CSRF: cookie SameSite=Strict + verifica Origin/Referer fail-closed in produzione
- Security headers: CSP strict, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- Protezione anti email header injection (CRLF) su tutti i campi PEC
- Protezione anti CSV/formula injection nell'export
- Race condition prevention con updateMany atomiche su tutte le transizioni di stato
- Rate limiting su tutti gli endpoint sensibili (login, upload, PEC, export, config utenti)
- 2FA TOTP con setup a 2 step anti-lockout, anti-disarm silenzioso, gate nel login
- Endpoint `/api/metrics` con token statico per Prometheus (timing-safe comparison)
- Cifratura at-rest completa dei backup con AES-256-GCM (DB JSON + allegati fisici)
- Sanitizzazione `passwordHash`, `totpSecret`, `totpVerifiedAt` nei backup
- Logger Pino strutturato con redazione automatica di campi sensibili a ogni profondità
- Invalidazione sessioni su cambio password/ruolo/territorio da admin

### Privacy e GDPR

- Anonimizzazione automatica delle segnalazioni chiuse oltre 10 anni (configurabile)
- Retention basata su `dataChiusura` (non `updatedAt`) per calcolo corretto della finestra GDPR
- Rimozione PII completa: volontarioId, indirizzo, CAP, coordinate GPS, descrizioni, allegati
- Cancellazione fisica dei file su disco durante l'anonimizzazione
- Pulizia automatica dei file orfani in `storage/uploads/` via cron job
- Audit trail completo per tracciabilità (storico stati, log invii PEC, audit export CSV)

### Architettura

- Stack: Next.js 16, React 19, TypeScript 5, Prisma 6, PostgreSQL 16, Tailwind CSS 4, Zod 4
- Script TypeScript eseguibili via `tsx` (compatibile Node.js e Docker senza bun)
- Docker multi-stage build con utente non-root, health check, e supporto `tsx` nel container
- Lockfile `package-lock.json` versionato per installazione deterministica
- Logica cron centralizzata in `src/lib/cron-utils.ts` (condivisa tra cron automatico e API manuale)
- Limite 4 allegati e dimensione massima 10 MB centralizzati in `src/lib/types.ts`
- Ricerca testuale case-insensitive su PostgreSQL (`mode: "insensitive"`)
- Query lista segnalazioni ottimizzata con `_count` invece di caricare record allegati completi
- Dockerfile con commento esplicito sul binding `HOSTNAME=0.0.0.0` (contesto Docker vs systemd)

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

- **1561 test** passing (60 file di test)
- **100% statements, 100% branches, 100% functions, 100% lines** su tutto il codice sorgente
- 498 test unitari su `src/lib/`
- 460 test di integrazione su 30 API routes
- 80 test di sicurezza informatica (OWASP Top 10 con verifiche reali su codice sorgente)
- 530 test su componenti React
- 25 test su middleware
- TypeScript strict: 0 errori
- ESLint: 0 errori, 0 warning

### Documentazione

- README.md con panoramica, stack tecnico, architettura, installazione, account demo, flusso segnalazioni, sicurezza, qualità del codice e test, privacy, struttura progetto, migrazione, manutenzione
- SETUP.md con guida passo-passo dal setup locale al deploy VPS (Caddy + systemd + cron + firewall) e deploy Docker Compose
- SECURITY.md con misure di sicurezza implementate, test OWASP Top 10, variabili d'ambiente, procedura di divulgazione responsabile
- PRIVACY.md con analisi GDPR, retention basata su `dataChiusura`, anonimizzazione automatica, contatto per richieste GDPR
- CONTRIBUTING.md con linee guida per contributori, requisiti coverage, riferimenti a GitHub issues
- LICENSE AGPL-3.0

### Supporto e segnalazioni

- **Bug, feature request, domande**: apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
- **Contatto diretto (anche per segnalazioni sensibili)**: fabiot2801@gmail.com
- **Vulnerabilità di sicurezza**: vedi SECURITY.md per la procedura di divulgazione responsabile

---

Sviluppo: [Fabio Tempera](https://ft2801.github.io/Portfolio), 2026.
Repository: https://github.com/Ft2801/CieloBuio-Segnalazioni
Contatto: fabiot2801@gmail.com
