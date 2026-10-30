# SETUP.md: Guida completa, dal setup locale al deploy in produzione

Questo documento contiene tutti i passaggi precisi per portare il sistema
CieloBuio Segnalazioni da zero a un ambiente di produzione funzionante,
comprese le tecnologie usate, la configurazione degli account, e i controlli
di sicurezza da fare prima di andare online.

È pensato per essere seguito in ordine, dall'inizio alla fine, anche da chi
non ha lavorato in precedenza su questo codice.

---

## Indice

1. [Tecnologie usate (stack completo)](#1-tecnologie-usate-stack-completo)
2. [Prerequisiti](#2-prerequisiti)
3. [Setup dell'ambiente locale di sviluppo](#3-setup-dellambiente-locale-di-sviluppo)
4. [Account dimostrativi (demo, sola visualizzazione)](#4-account-dimostrativi-demo-sola-visualizzazione)
5. [Creazione di un account reale](#5-creazione-di-un-account-reale)
6. [Configurazione dell'invio PEC](#6-configurazione-dellinvio-pec)
7. [Preparazione al deploy in produzione](#7-preparazione-al-deploy-in-produzione)
8. [Deploy su un VPS (passo-passo)](#8-deploy-su-un-vps-passo-passo)
9. [Job schedulati (cron) obbligatori in produzione](#9-job-schedulati-cron-obbligatori-in-produzione)
10. [Backup](#10-backup)
11. [Manutenzione futura dell'installazione](#11-manutenzione-futura-dellinstallazione)
12. [Pubblicazione su GitHub: cosa è sicuro e cosa no](#12-pubblicazione-su-github-cosa-è-sicuro-e-cosa-no)
13. [Checklist finale prima di andare online](#13-checklist-finale-prima-di-andare-online)
14. [Deploy alternativo: Docker Compose](#14-deploy-alternativo-docker-compose)
15. [Risoluzione problemi comuni](#15-risoluzione-problemi-comuni)

---

## 1. Tecnologie usate (stack completo)

| Livello | Tecnologia | Note |
|---|---|---|
| Runtime | **Node.js 24+** | Gestore pacchetti richiesto: **npm 11+** |
| Framework web | **Next.js 16** (App Router) | Genera sia il frontend sia le API in un unico progetto |
| Linguaggio | **TypeScript 7** | Tipizzato. Il type check con TypeScript 7 è il primo passo di `npm run build`: gli errori di tipo bloccano il build |
| UI | **React 19** + **Tailwind CSS 4** + **shadcn/ui** | Componenti accessibili, nessun servizio esterno a pagamento |
| Database | **PostgreSQL 16** via **Prisma ORM** | ACID, MVCC, concorrenza multi-writer, database relazionale maturo |
| Autenticazione | Sessioni via cookie **HTTP-only** + **bcryptjs** (hash password, cost 12) | Nessun servizio di autenticazione esterno |
| Validazione input | **zod** | Ogni endpoint valida i dati ricevuti prima di toccare il database |
| Invio PEC | **Nodemailer** via SMTP | Funziona con qualunque provider PEC italiano che esponga SMTP |
| Reverse proxy / HTTPS | **Caddy** | Gestisce automaticamente il certificato TLS (Let's Encrypt), non serve configurarlo a mano |
| PWA | `public/manifest.json` + Service Worker | Manifest e caching offline minimale; senza icone il browser non propone l'installazione |

Le dipendenze dirette sono open source con licenza permissiva (per esempio
MIT, Apache 2.0, ISC): nessun costo di licenza, nessun lock-in verso un fornitore.
Alcune dipendenze transitive hanno licenze diverse, elencate in `CONTRIBUTING.md`.

---

## 2. Prerequisiti

Prima di iniziare, assicurati di avere:

- **Node.js 24 o superiore** (verifica con `node --version`)
- **Git**
- Un editor di testo o IDE (es. VS Code)
- Per il deploy in produzione: un **VPS** (server privato virtuale) economico
  con Linux (Ubuntu 22.04+ consigliato), e un **dominio** che punti al suo IP
  (es. `segnalazioni.esempio.it`)
- Per l'invio PEC reale: una **casella PEC intestata a CieloBuio** (non al volontario sviluppatore), con accesso SMTP disponibile
  presso il proprio gestore

---

## 3. Setup dell'ambiente locale di sviluppo

Questi passaggi ti portano ad avere l'applicazione funzionante sul tuo
computer, con un database PostgreSQL locale o remoto.

### 3.1 Clona il repository

```bash
git clone https://github.com/Ft2801/CieloBuio-Segnalazioni.git
cd CieloBuio-Segnalazioni
```

### 3.2 Installa le dipendenze

Seleziona la versione di Node.js indicata in `.nvmrc` (24), verifica che `npm --version` sia almeno 11 e installa le dipendenze con `npm ci`, che usa esattamente le versioni del `package-lock.json`:

```bash
nvm use   # oppure fnm use: legge .nvmrc
npm ci
```

`npm ci` esegue anche lo script `prepare`, che installa gli hook Git di Husky (pre-commit con lint-staged). Fuori da un repository Git lo script si limita a segnalarlo e non blocca l'installazione.

### 3.3 Crea il file delle variabili d'ambiente

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Il file `.env` deve essere leggibile solo dal suo proprietario: può contenere password del database, credenziali PEC e chiavi di cifratura. Il file `.env` creato va bene così com'è per lo sviluppo locale (usa PostgreSQL
e lascia l'invio PEC disattivato). Non serve modificarlo per iniziare a
sviluppare. **Non committare mai questo file**: è già escluso da
`.gitignore`.

### 3.4 Applica lo schema al database

```bash
npm run db:migrate
```

Questo comando crea tutte le tabelle nel database PostgreSQL configurato in .env
definite in `prisma/schema.prisma`.

> Nota: questo comando richiede che Prisma scarichi i propri "engine"
> binari da internet la prima volta (`binaries.prisma.sh`). Se lavori dietro
> un firewall aziendale molto restrittivo, assicurati che quel dominio sia
> raggiungibile.

### 3.5 Popola le tabelle di configurazione iniziali

```bash
npm run db:seed
```

Questo comando inserisce le regioni con i relativi riferimenti normativi,
le province e i comuni di riferimento. I comuni vengono creati **senza
sindaco e senza PEC**: i dati reali vanno completati dal pannello di
amministrazione. Finché la PEC di un comune manca, l'invio PEC delle sue
segnalazioni viene rifiutato con un messaggio esplicito.

Il seed è ripetibile e non sovrascrive i riferimenti normativi già presenti
nel database. Se una regione ha cambiato la sua legge, le differenze vengono
segnalate; per allinearle ai dati del seed si esegue
`npm run db:seed -- --aggiorna-normativa`. Le modifiche fatte dal pannello
di amministrazione vengono sovrascritte solo con questo flag.

**Questo script non crea alcun utente.** Per un motivo preciso: il
repository sarà pubblico, e non deve mai contenere credenziali reali di
account con permessi di scrittura, nemmeno come "valore di esempio da
cambiare poi" (in pratica restano quasi sempre invariate). Il passo
successivo crea il primo utente in modo sicuro.

### 3.6 Crea il primo utente amministratore

```bash
npm run db:create-admin
```

Lo script chiede interattivamente, dal terminale:
- email
- nome e cognome
- ruolo (premi invio per il default `admin`)
- iniziali per il numero di protocollo (opzionale, premi invio per saltare:
  verranno derivate automaticamente dal nome e cognome)
- password (validata subito con le stesse regole dell'applicazione: almeno
  12 caratteri, con maiuscola, minuscola, numero e carattere speciale)

Le credenziali inserite **non vengono scritte in nessun file**: vengono
salvate, già cifrate con bcrypt, direttamente nel database.

### 3.7 Avvia il server di sviluppo

```bash
npm run dev
```

Apri il browser su `http://localhost:3000` e accedi con le credenziali
create al passo 3.6.

### 3.8 Controlli di qualità prima di un contributo

```bash
npm run check
```

Il comando esegue in sequenza formattazione (Prettier), lint (ESLint con regole di sicurezza), typecheck, analisi del codice inutilizzato (knip), controllo delle licenze delle dipendenze e test con copertura al 100%. La CI esegue gli stessi controlli ad ogni push e pull request.

---

## 4. Account dimostrativi (demo, sola visualizzazione)

Oltre agli account reali, l'applicazione include **tre account dimostrativi
di sola visualizzazione**, pensati per mostrare l'interfaccia a chi non ha
ancora un account reale (es. durante una presentazione al direttivo), o per
verificare rapidamente l'aspetto dei tre ruoli.

Gli account demo esistono **solo nella build statica pubblicata su GitHub
Pages**. Il server di produzione non li riconosce: nelle altre build la
modalità demo è disattivata (vedi sotto e `SECURITY.md`).

### Come funzionano (e perché sono sicuri anche a repository pubblico)

- **Non toccano il database**: la verifica delle credenziali avviene
  interamente nel browser (vedi `src/lib/demo-mode.ts`), quindi funzionano
  anche se il server o il database sono spenti o irraggiungibili.
- **Sola visualizzazione**: ogni azione che modifica dati (creare,
  approvare, rifiutare, inviare PEC, caricare o eliminare allegati,
  modificare la configurazione) viene bloccata prima ancora di provare a
  contattare il server, con un messaggio che lo spiega.
- **Nessun pulsante le suggerisce**: il login **non ha pulsanti "clicca per accedere come
  admin/volontario"**. Le credenziali vanno scritte a mano. Questo evita che
  chiunque apra la pagina di login veda una scorciatoia immediata, pur
  lasciando l'accesso demo disponibile a chi conosce (o legge in questo
  file) le credenziali esatte.
- **Dati statici**: le segnalazioni mostrate in modalità demo sono di
  esempio, incorporate nel codice (`src/lib/demo-data.ts`), non dati reali.

### Credenziali

| Ruolo | Email | Password |
|---|---|---|
| Volontario | `volontario@demo.cielobuio-segnalazioni.local` | `SoloLettura-Volontario!1` |
| Referente territoriale | `referente@demo.cielobuio-segnalazioni.local` | `SoloLettura-Referente!1` |
| Amministratore | `admin@demo.cielobuio-segnalazioni.local` | `SoloLettura-Admin!1` |

Il dominio `demo.cielobuio-segnalazioni.local` è **fittizio** (non esiste in
DNS, non è raggiungibile): usarlo per errore da qualche altra parte non ha
alcun effetto, e non collide con alcun dominio reale.

Se vuoi cambiare queste credenziali (ad esempio per un'installazione con un
nome diverso), modifica l'array `DEMO_ACCOUNTS` in `src/lib/demo-mode.ts` e
aggiorna questa tabella di conseguenza.

### Un compromesso onesto da conoscere

Perché la modalità demo funzioni anche a server spento, il confronto delle
credenziali avviene nel codice **che gira nel browser**: questo significa
che le tre password demo sono comunque leggibili da chiunque ispezioni il
codice JavaScript dell'app (non sono un vero segreto). Non è un problema,
perché questi account non danno accesso a nulla di reale: è però importante
non riutilizzare mai queste password, né lo stesso schema, per un account
vero.

---

## 5. Creazione di un account reale

Ogni account con permessi di scrittura (volontario, referente, admin) va
creato con lo script interattivo, mai inserito a mano nel database o
scritto in un file:

```bash
npm run db:create-admin
```

Nonostante il nome, lo script chiede il ruolo e può creare anche un
referente territoriale o un volontario, non solo un admin. In alternativa,
un amministratore già loggato può creare nuovi utenti direttamente dal
pannello di amministrazione dell'app (Amministrazione → Utenti), dove i
requisiti della password sono mostrati prima dell'invio del modulo.

**Se crei un referente territoriale**, lo script chiede anche la sigla
della provincia di competenza (es. `BG`): assicurati che quella provincia
esista già nella tabella di configurazione (creata al passo 3.5, o
aggiungibile dal pannello admin).

---

## 6. Configurazione dell'invio PEC

Finché `PEC_SMTP_HOST` non è impostata nel file `.env`, la
richiesta di invio PEC è rifiutata con risposta 503 e lo stato della
segnalazione non cambia. La funzione "simula spedizione" resta disponibile:
registra l'anteprima nel log e invia la copia di controllo soltanto quando
il servizio di posta è configurato. Questo permette di verificare l'intero
flusso (bozza → revisione → approvazione → invio) senza rischiare di inviare
PEC reali per errore.

Per abilitare l'invio reale, aggiungi al file `.env`:

```bash
PEC_SMTP_HOST=smtp.pec.tuodominio.it
PEC_SMTP_PORT=465
PEC_SMTP_USER=PEC-DA-CONFIGURARE@pec.tuodominio.it
PEC_SMTP_PASSWORD=password_applicativa_della_pec
PEC_FROM=PEC-DA-CONFIGURARE@pec.tuodominio.it
```

**Requisiti da confermare con il proprio gestore PEC prima dell'attivazione:**

1. Che la casella supporti l'**accesso SMTP con credenziali applicative**
   (non solo l'accesso via webmail). Alcuni gestori richiedono di generare
   una password dedicata per l'accesso via client/SMTP, diversa da quella
   della webmail.
2. Che la casella sia **intestata a CieloBuio**, non al
   volontario che sta facendo il deploy: è uno dei vincoli non negoziabili
   del progetto (vedi README, sezione "Vincoli non negoziabili rispettati").
3. **Vincolo tecnico delle PEC italiane**: i messaggi possono avere
   destinatari in CC (anche PEC), ma **non supportano il CCN/BCC verso
   indirizzi PEC**. Il sistema rispetta già questo vincolo automaticamente,
   non serve configurare nulla in proposito.

Dopo aver impostato queste variabili, riavvia l'applicazione perché siano
lette.

---

## 7. Preparazione al deploy in produzione

Prima del deploy vero e proprio, alcune decisioni vanno prese e alcune
variabili sono **obbligatorie** (non solo consigliate) in produzione.

### 7.1 Variabile obbligatoria: `NEXT_PUBLIC_BASE_URL`

```bash
NEXT_PUBLIC_BASE_URL=https://segnalazioni.esempio.it
```

Questa variabile non è solo per i link nelle email: **è anche il
meccanismo di protezione anti-CSRF** dell'applicazione (vedi
`src/proxy.ts`). In produzione, se non è impostata, tutte le richieste che modificano
dati ricevono risposta 503 (configurazione incompleta): il sistema non
accetta modifiche senza un'origine di riferimento. **Non avviare mai l'applicazione in produzione senza questa
variabile impostata con il dominio reale.**

### 7.2 Configurazione PostgreSQL

Il progetto usa **PostgreSQL 16** come database predefinito. Lo schema
Prisma è già configurato con `provider = "postgresql"` e la stringa di
connessione è letta da `DATABASE_URL` nel file `.env`.

PostgreSQL offre ACID compliance e MVCC per la concorrenza multi-writer.
È la scelta
ideale per un sistema multi-utente con transazioni critiche (invio PEC,
generazione protocolli, audit trail).

Per installare PostgreSQL sul server:

```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Crea il database e l'utente:

```bash
sudo -u postgres psql -c "CREATE DATABASE cielobuio_segnalazioni;"
sudo -u postgres psql -c "CREATE USER cielobuio WITH ENCRYPTED PASSWORD 'tua-password-sicura';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE cielobuio_segnalazioni TO cielobuio;"
```

Imposta nel `.env` di produzione:

```bash
DATABASE_URL="postgresql://cielobuio:tua-password-sicura@localhost:5432/cielobuio_segnalazioni?schema=public"
```

Poi applica le migrazioni del database con `npm run db:migrate` (vedi il punto 8.6).

### 7.3 Decidere dove gira il processo Node.js

L'applicazione, una volta compilata, è un server Node.js autonomo
(`output: "standalone"` in `next.config.ts`) che ascolta sulla porta 3000.
In produzione va tenuto in esecuzione permanente da un **process manager**
(qui useremo `systemd`, incluso in ogni distribuzione Linux, per non
aggiungere altre dipendenze), dietro un reverse proxy (**Caddy**) che
gestisce il dominio e l'HTTPS.

---

## 8. Deploy su un VPS (passo-passo)

Questa sezione presume un VPS Ubuntu 22.04+ pulito, con un dominio già
puntato al suo IP (record DNS di tipo A).

### 8.1 Collegati al server e aggiorna il sistema

```bash
ssh utente@ip-del-server
sudo apt update && sudo apt upgrade -y
```

### 8.2 Installa Node.js e Git

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git
```

### 8.3 Installa Caddy (reverse proxy + HTTPS automatico)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 8.4 Clona il progetto sul server

```bash
sudo mkdir -p /opt/cielobuio-segnalazioni
sudo chown $USER:$USER /opt/cielobuio-segnalazioni
git clone https://github.com/Ft2801/CieloBuio-Segnalazioni.git /opt/cielobuio-segnalazioni
cd /opt/cielobuio-segnalazioni
```

### 8.5 Configura le variabili d'ambiente di produzione

```bash
umask 077
cp .env.example .env
chmod 600 .env
nano .env
```

Non lasciare `.env` leggibile da altri utenti locali: contiene credenziali e chiavi. Il servizio systemd deve poterlo leggere come `www-data`, quindi il cambio di proprietario al punto 8.8 comprende anche questo file.

Imposta almeno:

```bash
DATABASE_URL="postgresql://cielobuio:password@localhost:5432/cielobuio_segnalazioni?schema=public"
NEXT_PUBLIC_BASE_URL=https://segnalazioni.esempio.it
PEC_SMTP_HOST=smtp.pec.tuodominio.it
PEC_SMTP_PORT=465
PEC_SMTP_USER=PEC-DA-CONFIGURARE@pec.tuodominio.it
PEC_SMTP_PASSWORD=password_applicativa_della_pec
PEC_FROM=PEC-DA-CONFIGURARE@pec.tuodominio.it
REMINDER_GIORNI=30
TRANSIZIONE_INVIATA_GIORNI=7

# Sicurezza e backup (METRICS_TOKEN opzionale, BACKUP_ENCRYPTION_KEY obbligatoria):
# METRICS_TOKEN: token per /api/metrics (Prometheus). Genera con: openssl rand -hex 32
# BACKUP_ENCRYPTION_KEY: chiave Base64 32 byte, obbligatoria per creare e ripristinare i backup. Genera con: openssl rand -base64 32
```

(Sostituisci `segnalazioni.esempio.it` con il dominio reale scelto.)

**Variabili di sicurezza (METRICS_TOKEN raccomandata, BACKUP_ENCRYPTION_KEY obbligatoria)**:

- `METRICS_TOKEN`: token statico per l'endpoint `/api/metrics` (compatibile con Prometheus via `Authorization: Bearer <token>`). Senza questa variabile, l'endpoint richiede il cookie di sessione admin (non compatibile con Prometheus che non può inviare cookie HTTP-only). Genera con `openssl rand -hex 32`.
- `BACKUP_ENCRYPTION_KEY`: **obbligatoria** per creare e ripristinare i backup. Chiave Base64 di 32 byte: ogni file del backup (tabelle, allegati, metadati) è cifrato con AES-256-GCM. Genera con `openssl rand -base64 32`. Senza questa variabile `npm run db:backup` e `npm run db:restore` terminano senza operare. **Conservala in un gestore di password o KMS separato dal backup: senza di essa i backup sono irrecuperabili.**

### 8.6 Installa le dipendenze, genera Prisma e prepara il database

```bash
npm ci                    # installa anche le devDependencies: servono al build (TypeScript 7, Tailwind)
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:create-admin
```

> Lo schema è versionato in `prisma/migrations/`. In produzione le migrazioni
> si applicano con `npm run db:migrate` (`prisma migrate deploy`), che non
> genera migrazioni e non cancella dati. Quando modifichi `prisma/schema.prisma`,
> crea la migrazione in sviluppo con `npm run db:migrate:dev` (`prisma migrate dev`)
> e committa la cartella generata. I dati di configurazione iniziali si caricano con `npm run db:seed`.

### 8.7 Compila l'applicazione per la produzione

```bash
npm run build
```

Questo comando compila l'app e prepara la cartella `.next/standalone/` con
tutto il necessario per l'esecuzione (incluse le risorse statiche e la
cartella `public/`, copiate automaticamente dallo script di build).

### 8.8 Crea un servizio systemd per tenere l'app sempre attiva

```bash
sudo nano /etc/systemd/system/cielobuio-segnalazioni.service
```

Contenuto:

```ini
[Unit]
Description=CieloBuio - Sistema segnalazioni
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/cielobuio-segnalazioni
EnvironmentFile=/opt/cielobuio-segnalazioni/.env
ExecStart=/usr/bin/node /opt/cielobuio-segnalazioni/.next/standalone/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
# BINDING A LOOPBACK: il server Node deve essere raggiungibile SOLO tramite
# Caddy (reverse proxy), mai direttamente da Internet. Se la porta 3000
# fosse esposta pubblicamente, un attaccante potrebbe bypassare tutti i
# controlli di rate limiting (che si basano su X-Real-IP impostato da
# Caddy) e di CSRF (che si basa su Origin verificata).
Environment=HOSTNAME=127.0.0.1

[Install]
WantedBy=multi-user.target
```

Poi:

```bash
sudo chown -R www-data:www-data /opt/cielobuio-segnalazioni
sudo chmod 600 /opt/cielobuio-segnalazioni/.env
sudo install -d -o www-data -g www-data -m 0700 /opt/cielobuio-segnalazioni/storage /opt/cielobuio-segnalazioni/storage/uploads /opt/cielobuio-segnalazioni/backups
sudo chmod -R go-rwx /opt/cielobuio-segnalazioni/storage /opt/cielobuio-segnalazioni/backups
sudo systemctl daemon-reload
sudo systemctl enable --now cielobuio-segnalazioni
sudo systemctl status cielobuio-segnalazioni
```

Se lo stato non è `active (running)`, controlla i log con:

```bash
sudo journalctl -u cielobuio-segnalazioni -f
```

### 8.8.1 Configura il firewall (OBBLIGATORIO per la sicurezza)

Il server Node è in ascolto su `127.0.0.1:3000` ma per difesa in profondità
è **obbligatorio** configurare anche un firewall a livello di sistema
operativo che blocchi qualsiasi accesso diretto alla porta 3000 dall'esterno.
Questo previene bypass del rate limiting e della protezione CSRF nel caso
in cui il binding a loopback fallisca per errori di configurazione.

```bash
# Installa ufw (Ubuntu/Debian) se non presente
sudo apt install -y ufw

# Permetti SSH (IMPORTANTE: fallo PRIMA di abilitare ufw, altrimenti ti chiudi fuori)
sudo ufw allow OpenSSH
# oppure, se hai cambiato porta SSH: sudo ufw allow 2222/tcp

# Permetti HTTP e HTTPS (gestiti da Caddy)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# NEGA esplicitamente l'accesso diretto alla porta 3000 (Node)
sudo ufw deny 3000/tcp

# Abilita il firewall
sudo ufw enable

# Verifica la configurazione
sudo ufw status verbose
```

L'output di `ufw status verbose` deve mostrare:
- `80/tcp ALLOW` (Caddy HTTP)
- `443/tcp ALLOW` (Caddy HTTPS)
- `3000/tcp DENY` (Node bloccato)
- `OpenSSH ALLOW` (per non perdere accesso SSH)

**Verifica che la porta 3000 non sia raggiungibile dall'esterno:**

```bash
# Da un altro computer su Internet:
curl -v http://TUO-DOMINIO:3000/  # deve fallire con connection refused o timeout
curl -v http://TUO-DOMINIO/       # deve funzionare (via Caddy sulla 443)
```

Se la prima richiesta ha successo, il firewall non sta bloccando la porta
3000: **non procedere al deploy in produzione** finché non è configurato
correttamente. Vedi `SECURITY.md` per i dettagli sull'impatto di sicurezza.

### 8.9 Configura Caddy con il dominio reale

Il repository include già un file `Caddyfile` di produzione pronto: apri
`/opt/cielobuio-segnalazioni/Caddyfile` e sostituisci
`segnalazioni.esempio.it` con il tuo dominio reale. Poi copialo dove
Caddy si aspetta di trovarlo:

```bash
sudo cp /opt/cielobuio-segnalazioni/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy otterrà automaticamente un certificato HTTPS per il dominio (richiede
che le porte 80 e 443 siano raggiungibili da internet).

### 8.10 Verifica

Apri `https://segnalazioni.esempio.it` (con il tuo dominio reale) e
controlla che:
- il certificato HTTPS sia valido (lucchetto verde nel browser)
- la schermata di login si carichi correttamente
- l'accesso con l'account admin creato al passo 8.6 funzioni

---

## 9. Job schedulati (cron) obbligatori in produzione

Due job vanno programmati con `cron` per il corretto funzionamento nel
tempo del sistema (senza, l'app funziona comunque, ma le pratiche non
transitano automaticamente di stato e non hai backup):

```bash
crontab -e -u www-data
```

Aggiungi il job di manutenzione come utente `www-data`:

```cron
# Alle 3:00: transizioni, sessioni, anonimizzazione GDPR e file orfani
0 3 * * * cd /opt/cielobuio-segnalazioni && /usr/bin/env npm run cron:reminder >> logs/cron.log 2>&1
```

Il backup richiede una finestra senza scritture su database e allegati. Lo script `scripts/backup-consistente.sh` ferma il servizio, esegue il backup come `www-data` e riavvia il servizio anche se il backup fallisce. Il suo uso presuppone il servizio systemd e il percorso applicativo indicati al punto 8. Verifica che non siano attivi altri processi che scrivono sui dati.

**Non eseguire come root uno script dalla directory applicativa, che è scrivibile da `www-data`.** Installa una copia non modificabile dall'utente dell'applicazione e crea una directory dei log di proprietà di root. In caso di distribuzione di una versione futura dello script, installa di nuovo la copia:

```bash
sudo install -o root -g root -m 0755 /opt/cielobuio-segnalazioni/scripts/backup-consistente.sh /usr/local/sbin/cielobuio-backup-consistente
sudo install -d -o root -g root -m 0750 /var/log/cielobuio
sudo crontab -e -u root
```

```cron
# Alle 2:00: ferma il servizio, salva una copia coerente, riavvia il servizio
0 2 * * * /usr/local/sbin/cielobuio-backup-consistente >> /var/log/cielobuio/backup.log 2>&1
```

Non scrivere il log di un job root in una directory scrivibile da `www-data`: un collegamento simbolico creato dall'applicazione potrebbe reindirizzare la scrittura su un altro file del sistema.

Crea la cartella dei log se non esiste:

```bash
mkdir -p /opt/cielobuio-segnalazioni/logs
```

---

## 10. Backup

- **Database PostgreSQL**: il job di backup configurato al punto 9 esporta
  le tabelle in JSON cifrato dentro `backups/`, con pulizia automatica dei
  backup più vecchi di 30 giorni. Per una copia completa del database si
  affianca un dump periodico con `pg_dump`, schedulato sul server.
- **Allegati**: lo script di backup include i file fisici nella directory
  `STORAGE_ROOT` se configurata, altrimenti in `storage/uploads/`. Un file
  mancante, illeggibile o non ripristinabile impedisce la pubblicazione di
  un archivio incompleto. Controlla il codice di uscita e il log del job.
- **Ambiente**: gli script di seed, creazione utente, manutenzione, backup e
  ripristino caricano `.env` dalla directory di lavoro. Eseguili dalla
  directory del progetto, senza inserire credenziali nella riga di comando.

### Ripristino controllato

1. Verifica la chiave `BACKUP_ENCRYPTION_KEY`, il nome del backup e lo spazio
   disponibile. Conserva una copia separata dello stato corrente. Ferma tutti
   i processi che scrivono nel database o nello storage, incluso il servizio:

   ```bash
   sudo systemctl stop cielobuio-segnalazioni
   cd /opt/cielobuio-segnalazioni
   sudo -u www-data npm run db:restore -- backup-YYYYMMDD-HHMMSS --force
   ```

   Ometti `--force` solo se tutte le tabelle di destinazione sono vuote.
   La procedura verifica metadati, tabelle e allegati prima di sostituire i
   dati, invalida le sessioni e riallinea recidive e sequenze PostgreSQL.
2. Controlla database, allegati e log. Se lo script è stato interrotto
   forzatamente, verifica anche le directory `.cielobuio-restore-*` e
   `.cielobuio-previous-*` accanto allo storage: file e database non
   condividono una transazione atomica. Non riavviare l'applicazione prima
   di aver accertato la coerenza dei due insiemi.
3. Per un backup che contiene pratiche oltre la retention, esegui il job di
   anonimizzazione GDPR e controlla i file residui. Riavvia il servizio
   soltanto dopo la verifica:

   ```bash
   sudo -u www-data npm run cron:reminder
   sudo systemctl start cielobuio-segnalazioni
   ```

Testa la procedura in un ambiente isolato prima dell'uso in produzione.
- **Cifratura dei backup (obbligatoria)**: imposta la variabile
  d'ambiente `BACKUP_ENCRYPTION_KEY` con una chiave Base64 di 32 byte
  (generabile con `openssl rand -base64 32`). È obbligatoria: senza di essa
  lo script di backup termina senza creare file. Ogni file del backup
  (tabelle JSON, metadati e allegati fisici) è cifrato con AES-256-GCM
  (file `.enc`).
- **Responsabilità**: definite chi tra i volontari controlla periodicamente
  che i backup vengano effettivamente generati (es. verifica mensile della
  cartella `backups/` e delle dimensioni dei file).

---

## 11. Manutenzione dell'installazione

Il deploy systemd usa una finestra di manutenzione: sospendere i cron e gli altri processi che scrivono nel database o nello storage. Eseguire lo script con l'utente proprietario dell'installazione, che deve poter leggere `.env` e avere permessi sudo non interattivi limitati a `systemctl stop` e `systemctl start` dell'unità applicativa.

```bash
cd /opt/cielobuio-segnalazioni
bash scripts/deploy.sh production main
```

Lo script richiede una directory Git pulita e il ramo già selezionato. Ferma il servizio, esegue il backup cifrato, acquisisce il codice con `git pull --ff-only`, installa le dipendenze, costruisce l'applicazione e applica le migrazioni. Un backup fallito interrompe sempre il deploy. La build precede le migrazioni: un errore di compilazione non applica uno schema nuovo. Il servizio viene avviato anche quando un passaggio fallisce; in tal caso verificare lo stato prima di ripetere il deploy. Non si tratta di un rollback automatico di codice e database.

Per staging usare directory, database, storage, unità systemd e porta distinti dalla produzione. I valori predefiniti dello script sono `/opt/cielobuio-segnalazioni-staging` e `cielobuio-segnalazioni-staging`; l'URL del controllo deve essere esplicito:

```bash
CIELOBUIO_HEALTH_URL=http://localhost:3001/api/health bash scripts/deploy.sh staging main
```

`CIELOBUIO_APP_DIR` e `CIELOBUIO_SERVICE` consentono percorsi e unità personalizzati. Il controllo HTTP ha timeout di connessione e risposta e non deve interrogare il servizio di produzione durante un deploy staging.

---

## 12. Pubblicazione su GitHub: cosa è sicuro e cosa no

Il repository è pensato per essere reso pubblico su GitHub. Prima di
pubblicarlo (o di dare accesso a nuovi collaboratori), verifica quanto
segue:

**Sicuro da pubblicare (già impostato così in questo progetto):**
- Tutto il codice sorgente dell'applicazione
- `.env.example` (contiene solo nomi di variabili e valori segnaposto, mai
  credenziali vere)
- Il `Caddyfile` di produzione (contiene solo un dominio d'esempio da
  sostituire, nessun segreto)
- Gli script `scripts/seed.ts` e `scripts/create-admin.ts` (non contengono credenziali:
  il primo popola solo dati di configurazione (regioni, leggi, province,
  comuni senza sindaco e senza PEC), il secondo chiede le credenziali a
  runtime senza scriverle da nessuna parte)
- Le credenziali dei tre account demo (sezione 4): non danno accesso a
  nulla di reale, e sono accettate solo dalla build GitHub Pages

**Da NON pubblicare mai (già esclusi da `.gitignore`, verificare comunque
prima di ogni commit):**
- Il file `.env` reale (contiene le vere credenziali SMTP della PEC)
- Il database PostgreSQL (contiene dati reali delle segnalazioni e
  hash delle password)
- La cartella `storage/uploads/` (foto e documenti reali allegati alle
  segnalazioni)
- La cartella `backups/` (backup del database)
- Qualunque file di log (`*.log`)

Prima del primo `git push` verso un repository pubblico, esegui comunque
questo controllo manuale:

```bash
git status
git diff --cached --name-only
```

e verifica che nessuno dei file sopra elencati come "da non pubblicare"
compaia nell'elenco.

---

## 13. Checklist finale prima di andare online

- [ ] `NEXT_PUBLIC_BASE_URL` impostata con il dominio reale (sezione 7.1:
      obbligatoria per la protezione anti-CSRF)
- [ ] Casella PEC configurata, intestata a CieloBuio, testata con una
      simulazione ("simula spedizione" dall'app) e con un invio reale di verifica
- [ ] Almeno un utente amministratore reale creato con `db:create-admin`
- [ ] Dati di configurazione (sindaci, PEC dei comuni) completati e verificati
      dal pannello di amministrazione: il seed crea i comuni senza sindaco e
      senza PEC
- [ ] Servizio systemd attivo e configurato per riavviarsi da solo
      (`Restart=on-failure`) e all'avvio del server (`enable`)
- [ ] Caddy configurato con il dominio reale, HTTPS verificato nel browser
- [ ] I due job cron (maintenance e backup) programmati e verificati con
      un'esecuzione manuale di verifica
- [ ] Backup testato: verifica che `npm run db:backup` produca davvero un
      file in `backups/` con contenuto leggibile
- [ ] Verifica che il file `.env` reale non sia mai stato committato
      (sezione 12)
- [ ] Verificato che le credenziali dei tre account demo (sezione 4) siano
      rifiutate dal server di produzione (la modalità demo è attiva solo
      nella build GitHub Pages)
- [ ] `https://<dominio>/.well-known/security.txt` risponde e la data `Expires` non è ancora scaduta (vedi README, sezione Manutenzione)
- [ ] Provato l'intero flusso con un account reale: bozza → invio in
      revisione → approvazione → "simula spedizione" → invio reale di verifica
      → cambio stato

---

## 14. Deploy alternativo: Docker Compose

Oltre al deploy bare-metal con systemd (sezione 8), il repository include
`Dockerfile` e `docker-compose.yml` per un deploy containerizzato che
include app + PostgreSQL + Caddy (reverse proxy) in un unico stack.

### 14.1. Prerequisiti Docker

- Docker 24+ e Docker Compose v2 installati sul server
- Dominio DNS configurato per puntare al server
- Porte 80 (HTTP) e 443 (HTTPS) aperte sul firewall
- Le immagini del `Dockerfile` e di `docker-compose.yml` (`node:24-alpine`, `postgres:16-alpine`, `caddy:2-alpine`) sono fissate a digest `sha256`: la build usa sempre le stesse basi finché il digest non viene aggiornato, e Dependabot propone gli aggiornamenti

### 14.2. Avvio con Docker Compose

```bash
# Clona il repository
git clone https://github.com/Ft2801/CieloBuio-Segnalazioni.git
cd CieloBuio-Segnalazioni

# Imposta le variabili d'ambiente obbligatorie
export DB_PASSWORD="password-sicura-generata-con-openssl-rand-hex-32"
export NEXT_PUBLIC_BASE_URL="https://segnalazioni.esempio.it"
export PEC_SMTP_HOST="smtp.pec.tuodominio.it"
export PEC_SMTP_USER="PEC-DA-CONFIGURARE@pec.tuodominio.it"
export PEC_SMTP_PASSWORD="password_applicativa"
export PEC_FROM="PEC-DA-CONFIGURARE@pec.tuodominio.it"
# Raccomandato per il monitoraggio Prometheus:
export METRICS_TOKEN="$(openssl rand -hex 32)"
# Obbligatoria per creare e ripristinare i backup: conservala in un gestore
# di password separato dal server, altrimenti i backup sono irrecuperabili.
export BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 32)"

# Avvia lo stack
docker compose up -d --build

# Verifica che i container siano running
docker compose ps
```

### 14.3. Setup del database in Docker

Il container include la CLI Prisma e `tsx` (runner TypeScript), che
permettono di applicare le migrazioni ed eseguire gli script di setup
senza richiedere `bun`:

```bash
# Applica le migrazioni del database (obbligatorio al primo avvio e dopo ogni aggiornamento)
docker compose exec app npm run db:migrate

# Popola le tabelle di configurazione (regioni, province, comuni)
docker compose exec app npm run db:seed

# Crea il primo utente amministratore
docker compose exec app npm run db:create-admin

# Verifica che l'app risponda (richiesta interna al container, evita problemi
# di routing DNS del Caddyfile configurato per un dominio specifico)
docker compose exec app node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => console.log(r.status, r.ok ? 'OK' : 'ERRORE'), () => process.exit(1))"

# In alternativa, dall'host con resolve DNS forzato:
# curl -k --resolve segnalazioni.esempio.it:443:127.0.0.1 https://segnalazioni.esempio.it/api/health
```

### 14.4. Backup e cron in Docker

```bash
# Backup manuale (cifrato se BACKUP_ENCRYPTION_KEY è impostata)
docker compose exec app npm run db:backup

# Job schedulati da aggiungere al crontab dell'host (-T evita l'uso del terminale):
# 0 3 * * * docker compose -f /path/to/docker-compose.yml exec -T app npm run cron:reminder
# 0 2 * * * docker compose -f /path/to/docker-compose.yml exec -T app npm run db:backup
```

### 14.5. Configurazione Caddy

Il file `Caddyfile` è già configurato per terminare HTTPS e fare reverse
proxy. L'upstream è configurabile via variabile d'ambiente `UPSTREAM_HOST`:
di default usa `localhost:3000` (deploy bare-metal), in Docker Compose
viene automaticamente impostato a `app:3000` dal `docker-compose.yml`.

Modifica il dominio nel Caddyfile sostituendo `segnalazioni.esempio.it`
con il dominio reale di CieloBuio:

```Caddyfile
segnalazioni.esempio.it {
  reverse_proxy {$UPSTREAM_HOST:localhost:3000}
  # ... resto della configurazione (header di sicurezza, log, ecc.)
}
```

In Docker Compose non è necessario editare il Caddyfile: la variabile
`UPSTREAM_HOST=app:3000` è già impostata nel service `caddy` del
`docker-compose.yml`.

### 14.6. Differenze rispetto al deploy bare-metal

- **HOSTNAME**: nel container Docker, l'app binda `0.0.0.0:3000` sulla
  rete Docker interna, ma la porta è mappata sull'host solo su
  `127.0.0.1:3000:3000` nel `docker-compose.yml`. Quindi dall'esterno la
  porta 3000 NON è raggiungibile direttamente, ed è protetta dal reverse
  proxy Caddy. Questo è diverso dal deploy systemd bare-metal dove serve
  `HOSTNAME=127.0.0.1` direttamente nel processo Node (vedi sezione 8.8),
  perché in quel caso manca l'isolazione della rete Docker.
- **Bun non richiesto**: il container usa `node:24-alpine` + `tsx` per
  eseguire gli script TypeScript. Non è necessario installare Bun
  nell'host o nel container.
- **NEXT_PUBLIC_BASE_URL**: passata come build arg (non solo env runtime)
  perché le variabili `NEXT_PUBLIC_*` vengono inlineate nel bundle client
  in fase di build. Senza build arg, il client avrebbe `undefined` anche
  con la env var impostata nel runtime del container.
- **Persistenza**: i volumi Docker `app-storage`, `backups` e `db-data`
  preservano gli allegati, i backup e il database tra riavvii del container.
- **Backup cifrati**: `BACKUP_ENCRYPTION_KEY` (Base64 di 32 byte, genera con
  `openssl rand -base64 32`) è obbligatoria. Tutti i file dei backup sono
  cifrati con AES-256-GCM. Senza questa variabile il backup non viene creato.

---

## 15. Risoluzione problemi comuni

**"L'installazione delle dipendenze fallisce per conflitti di versione"**
Assicurati di partire da una copia pulita del progetto, senza `node_modules`,
e con il `package-lock.json` del repository non modificato. Poi esegui di nuovo
`npm install`.

**"`npm run db:migrate` si blocca o dà errori di rete"**
Prisma scarica i propri motori binari da `binaries.prisma.sh` al primo
utilizzo: verifica che il server abbia accesso a internet in uscita verso
quel dominio (alcuni firewall aziendali/cloud lo bloccano).

**"Le richieste che modificano dati (creare, approvare...) falliscono con
errore di autorizzazione dopo il deploy"**
Quasi sempre è `NEXT_PUBLIC_BASE_URL` non impostata o impostata con un
valore diverso dal dominio reale usato per accedere al sito (deve
combaciare esattamente, protocollo incluso: `https://`, non `http://`).

**"L'invio PEC non parte, ma non ci sono errori evidenti"**
Controlla che `PEC_SMTP_HOST` sia impostata: senza di essa l'invio PEC
resta disabilitato (503) per evitare invii accidentali. Controlla anche
`PEC_SMTP_USER` e `PEC_SMTP_PASSWORD`, di norma necessarie per l'accesso SMTP
della casella. `PEC_FROM` è obbligatoria per l'invio reale: la lettera riporta la PEC
dell'associazione e, senza di essa, l'invio viene rifiutato con un messaggio
esplicito. Senza `PEC_FROM` la simulazione usa la PEC dell'utente come mittente.

**"Un utente resta bloccato dopo alcuni tentativi di login falliti"**
È il comportamento atteso del rate limiting (sezione Sicurezza del
README): 3 tentativi falliti per la stessa email, o 20 tentativi dallo
stesso indirizzo IP, bloccano l'accesso per 5 minuti, con escalation
fino a 24 ore in caso di blocchi ripetuti. Non esiste uno
sblocco manuale rapido: basta attendere il tempo indicato, oppure
riavviare il processo dell'applicazione (il conteggio dei tentativi è
mantenuto in memoria del processo, quindi un riavvio lo azzera. Da
usare con cautela, solo se davvero necessario).

**"Ho bisogno di aggiungere una nuova regione o correggere una legge"**
Non serve toccare il codice: accedi come amministratore, vai nel pannello
di amministrazione, sezione Regioni, e modifica o aggiungi la riga
corrispondente. Vale lo stesso principio per province, comuni e utenti.

**"Non trovo soluzione a un problema non elencato qui"**
Apri una issue su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
descrivendo il problema con il maggior dettaglio possibile (passi per
riprodurlo, log, versione del software, browser, sistema operativo).
In alternativa, scrivi a fabiot2801@gmail.com per assistenza diretta.


### Database dedicato al collaudo

La suite `npm run test:integration` richiede PostgreSQL con migrazioni applicate e un database sacrificabile chiamato `cielobuio_integration`. Usare un ruolo dedicato, privo di permessi sui database operativi. Impostare `TEST_DATABASE_URL` sulla sua connessione, eseguire `DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate`, quindi `npm run test:integration`. La suite elimina tutti i dati applicativi nel database di collaudo e usa cartelle temporanee per allegati e backup. La configurazione non ricava la connessione implicitamente da `DATABASE_URL` e rifiuta nomi database differenti. I casi coprono flussi concorrenti, rollback, allegati, TOTP, sessioni e ripristino; i dettagli operativi sono nella sezione di collaudo del README.

Lo storage degli allegati è privato e non ammette collegamenti simbolici nella radice, nelle cartelle delle pratiche o nei file serviti da download e anteprima. La directory deve essere scrivibile soltanto dall'account applicativo e dagli amministratori fidati del sistema.
