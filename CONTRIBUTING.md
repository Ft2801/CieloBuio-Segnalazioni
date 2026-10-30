# Contribuire a CieloBuio, segnalazioni

Grazie per il tuo interesse nel contribuire al progetto CieloBuio. Questo documento raccoglie le linee guida per chi vuole proporre modifiche, segnalare problemi o aggiungere funzionalità.

## Contesto del progetto

Prima di contribuire, leggere con attenzione il file [README.md](README.md), in particolare:

- i **vincoli non negoziabili** (bassa manutenzione, open source, formato dati portatile, nessun lock-in)
- il principio di **architettura dati separata dalla logica applicativa**
- il principio del **motore a regole/flag configurabili**

Questi vincoli sono la ragione d'essere del progetto e qualsiasi contributo che li violi non potrà essere accettato.

## Come segnalare un problema

1. Verificare che il problema non sia già segnalato nelle issue aperte su
   https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
2. Aprire una nuova issue con:
   - titolo descrittivo
   - passi per riprodurre il problema
   - comportamento atteso
   - comportamento osservato
   - versione del software, browser, sistema operativo
   - eventuali screenshot o log
3. In alternativa, scrivere a fabiot2801@gmail.com (privato, per segnalazioni sensibili
   che non vuoi esporre pubblicamente)

## Come proporre una funzionalità

1. Aprire una issue di tipo "feature request" su
   https://github.com/Ft2801/CieloBuio-Segnalazioni/issues descrivendo:
   - il problema che la funzionalità risolve
   - la soluzione proposta
   - eventuali alternative considerate
2. Attendere il feedback dei maintainer prima di iniziare lo sviluppo
3. Per modifiche architetturali significative, è preferibile un documento di design breve da discutere prima del codice

## Come inviare una pull request

1. Forkare la repository
2. Creare un branch descrittivo (`feature/export-csv`, `improve/login-flow`, ecc.)
3. Installare le dipendenze con `npm ci` dalla versione di Node.js indicata in `.nvmrc` (24). `npm ci` installa anche gli hook Git di Husky
4. Scrivere codice seguendo le convenzioni esistenti (TypeScript strict, componenti funzionali React, prefisso `use-` per gli hook)
5. Eseguire tutti i controlli con una sola istruzione:
   ```bash
   npm run check
   ```
   Il comando esegue formattazione (Prettier), lint (ESLint con regole di sicurezza), typecheck, analisi di codice e dipendenze inutilizzate (knip), controllo delle licenze e test con copertura globale del 100%. Il pre-commit esegue lint-staged sui file in staging
6. Verificare che la build di produzione completi senza errori: `npm run build`
7. Verificare che l'applicazione si avvii e funzioni nei flussi principali (login, nuova segnalazione, approvazione, invio PEC)
8. Scrivere un messaggio di commit descrittivo (in italiano, con verbo all'infinito)
9. Compilare il modulo della pull request, che riassume i controlli da completare, e collegarla alla issue originale

## Regole architetturali inviolabili

Queste regole derivano dai vincoli non negoziabili del progetto (vedi README.md). Una modifica che le viola non può essere accettata, anche se funziona.

### 1. Nessun riferimento a leggi regionali nel codice

Le norme regionali (soglie, termini, articoli, zone protette) non si scrivono nel codice applicativo. Il motore usa regole e flag configurabili, letti dalle tabelle di configurazione. Se una legge cambia, deve bastare aggiornare i dati, non il codice.

### 2. Nessuna dipendenza da servizi a pagamento

Il progetto usa solo tecnologie open source, preferibilmente con licenze permissive (MIT, Apache 2.0, ISC, BSD). Nessun servizio con costi o condizioni che possono cambiare. Ogni nuova dipendenza viene verificata con `npm run licenze`, che blocca le licenze non ammesse (vedi la sezione "Licenze delle dipendenze").

### 3. Nessuna automazione di decisioni legali

L'escalation verso la Procura della Repubblica non è automatizzata. Il sistema segnala solo il raggiungimento della soglia di recidiva, e la decisione resta umana.

### 4. Nessun hard-coding di dati di configurazione

Comuni, province, regioni, PEC, referenti e riferimenti normativi vivono nelle tabelle di configurazione. Si gestiscono dal pannello di amministrazione o dal seed, mai nel codice.

### 5. Formato dati portatile

Ogni dato è esportabile in un formato aperto e leggibile (CSV apribile con Excel o LibreOffice), senza lock-in verso un fornitore.

## Stile del codice

- **TypeScript** strict mode, nessun `any` se non strettamente necessario
- **Componenti funzionali** React, hook personalizzati con prefisso `use-`
- **API Routes** con gestione errori esplicita e risposte JSON coerenti (`{ ok: true }` o `{ error: "..." }`)
- **Commenti** in italiano, concisi, solo dove servono
- **Nomi** in italiano per concetti di business (segnalazione, referente, volontario), in inglese per utility tecniche
- **Niente emoji** nel codice o nei messaggi di commit
- **Formattazione** con Prettier (120 colonne, regole in `.prettierrc.json`): `npm run format` la applica, `npm run format:check` la verifica
- **Sicurezza nel codice**: ESLint con eslint-plugin-security. Una regola non si disattiva senza una motivazione scritta in `eslint.config.mjs`, nel punto in cui viene applicata
- **Codice inutilizzato**: knip segnala export, file e pacchetti non usati. Ogni eccezione va motivata, non nascosta
- **Editor**: `.vscode/settings.json` applica Prettier al salvataggio e le correzioni ESLint, `.vscode/extensions.json` elenca le estensioni consigliate. Chi usa un altro editor può ignorarle

## Dipendenze e aggiornamenti

- **Nuove dipendenze npm**: si aggiungono con `npm install --save-dev` (o `npm install`), e il `package-lock.json` aggiornato va incluso nella stessa modifica. Il lockfile non si modifica a mano
- **Action GitHub fissate a SHA**: ogni `uses:` nei workflow contiene lo SHA completo del commit, con il tag di versione come commento (`uses: owner/repo@<sha> # vX.Y.Z`). Per aggiornare un'action si usa lo SHA del nuovo tag, verificato su GitHub
- **Immagini Docker fissate a digest**: ogni immagine (Dockerfile, docker-compose e workflow) riporta il digest `sha256`. Per aggiornarla si risolve il nuovo digest con `docker buildx imagetools inspect <immagine>:<tag>`, lo si sostituisce e si riesegue la CI. Il test `repo-policy` impedisce di tornare a riferimenti senza digest
- **Dependabot**: apre le proposte di aggiornamento ogni lunedì. Patch e minor di npm arrivano in un'unica pull request, mentre gli aggiornamenti major restano separati e vanno valutati uno per uno

Ogni modifica ai pin va accompagnata dall'esecuzione completa di `npm run check` e dalla CI verde.

## Convenzioni per i commit

Messaggi in italiano, verbo all'infinito, massimo 72 caratteri nel titolo:

```
Aggiunge validazione email lato server
Migliora gestione stato form dopo salvataggio
Rimuove dipendenza non più necessaria
```

L'hook `commit-msg` di Husky rifiuta i messaggi con titolo vuoto o più lungo di 72 caratteri.

## Testing

Il progetto ha una suite di **test automatici** con **Vitest**:

- **Test unitari** su `src/lib/` (funzioni pure e moduli di servizio, incluse le verifiche su client Prisma, SMTP, protocollo, path guard, validazione e demo mode)
- **Test di integrazione** su tutte le API routes in `src/app/api/__tests__/`, con mock di DB (Prisma), next/headers, nodemailer, bcryptjs, fs/promises
- **Test di sicurezza informatica** in `src/__tests__/security-attack-suite.test.ts`, organizzati per OWASP Top 10 (IDOR, injection, CSRF, XSS, path traversal, brute force, session fixation, file upload spoofing, GDPR, TOTP 2FA)
- **Test di funzionalità enterprise** in `src/__tests__/enterprise-features.test.ts` (health, docs, metrics, logger Pino, TOTP anti-lockout, backup encryption)
- **Test su `src/proxy.ts`** (security headers, CSRF, fail-closed, matcher), su `src/hooks/use-toast.ts`, su componenti UI shadcn/ui, sui componenti app e su `scripts/cron-jobs.ts`
- **Test di policy del repository** in `src/__tests__/repo-policy.test.ts`: action e immagini Docker fissate a SHA o digest, file di governance presenti, Node.js coerente tra `.nvmrc`, `engines` e `.npmrc`, Dependabot, CodeQL e Scorecard configurati, lint dei workflow con actionlint, npm dell'immagine aggiornato e verificato nel Dockerfile

La soglia globale di coverage (statements, branches, functions, lines) è del 100% e viene verificata da `npm run test:coverage` in CI. Non va abbassata: il codice nuovo deve essere coperto dai test.

Quando si contribuisce:

- Eseguire i test: `npm run test`
- Eseguire con coverage: `npm run test:coverage`
- Aggiungere test per ogni nuova funzionalità in:
  - `src/lib/__tests__/` (per funzioni pure)
  - `src/app/api/__tests__/` (per route handler)
  - `src/components/app/__tests__/` (per componenti React)
  - `src/components/ui/__tests__/` (per componenti UI)
- Mantenere la coverage globale al 100% (soglia in `vitest.config.mts`); le uniche esclusioni dichiarate nel file sono i file di test (`*.test.*`, `*.spec.*`, cartelle `__tests__`), il setup dei test (`src/setup-tests.ts`) e le dichiarazioni di tipo (`*.d.ts`)
- Per i componenti app complessi, ogni nuovo ramo condizionale deve essere coperto da almeno un test
- Per le API routes, ogni nuovo endpoint deve avere test di integrazione che coprono: 401 (sessione assente), 403 (sessione senza permesso), 400 (validazione), 404 (not found), 409 (race condition se applicabile), 200/201 (successo), 500 (errore DB)
- Verificare la responsività mobile (viewport 375px)
- Verificare che lint, typecheck, formattazione e analisi del codice inutilizzato passino, con `npm run check`, che esegue tutti questi controlli insieme

I test usano mock per DB (Prisma), nodemailer, bcryptjs, next/headers, fs/promises e fetch globale, con fake timers per testare il rate limiting. Per esporre funzioni interne ai test, usare il prefisso `__` (es. `__resetRateLimitStoreForTests`, `__resetTransporterCacheForTests`, `__resetToastStateForTests`) come già fatto per rate-limit, SMTP, notifiche e use-toast.

### Test end-to-end

I test end-to-end sono in `e2e/` e usano Playwright (`@playwright/test`) con axe-core (`@axe-core/playwright`). Girano sulla build statica: prima `npm run build:pages`, poi `npm run test:e2e`, che avvia un server locale su `out/`. Ogni vista principale viene controllata con i criteri WCAG 2.0, 2.1 e 2.2 di livello A e AA, in tema chiaro e scuro, su desktop e su mobile. Il progetto mobile salta il percorso di navigazione con il tasto indietro, perché la navigazione mobile passa dal drawer.

I test end-to-end non fanno parte della copertura unitaria e non sono inclusi in `npm run check`. Il job `e2e` della CI li esegue ad ogni push e pull request e pubblica il report Playwright come artefatto.

## Licenze delle dipendenze

Il progetto distribuisce tecnologie open source con licenze permissive, con poche eccezioni elencate sotto. Lo script `npm run licenze` controlla le licenze di tutti i pacchetti di produzione, esclusi quelli del progetto stesso, e fallisce se compare una licenza non ammessa. Sono ammesse: MIT, Apache-2.0, ISC, MIT and ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Unlicense e MIT-0. Lo stesso controllo gira in `npm run check` e nella CI.

Alla versione 1.0.0 le eccezioni, dichiarate per nome nello script, sono queste:

| Pacchetto | Licenza | Come entra nel progetto | Note |
| --- | --- | --- | --- |
| `@img/sharp-libvips-linux-x64`, `@img/sharp-libvips-linuxmusl-x64` | LGPL-3.0-or-later | `sharp`, dipendenza opzionale di `next` per l'ottimizzazione delle immagini | Libreria libvips, usata senza modifiche |
| `caniuse-lite` | CC-BY-4.0 | `next` (tramite browserslist) | Dati sui browser, usati in fase di build |
| `elkjs` | EPL-2.0 | `prisma`, dipendenza di Prisma Studio | Strumento di sviluppo |

Le dipendenze di sviluppo non entrano nel controllo perché non vengono distribuite con l'applicazione. Fanno eccezione per lo stesso motivo `@axe-core/playwright` e `axe-core` (MPL-2.0), usati solo dai test end-to-end. Il font Inter è un asset incluso nel repository (`src/fonts/inter/`) con licenza SIL OFL 1.1, il cui testo è in `src/fonts/inter/LICENSE.txt`.

Le eccezioni sono escluse per nome, quindi lo script non rilegge automaticamente la licenza dopo un aggiornamento. Quando una di queste dipendenze cambia versione, la licenza va riverificata a mano (per esempio con `npm view <pacchetto> license`) prima di accettare l'aggiornamento. I binari di piattaforma non installati sulla macchina di sviluppo non vengono letti dallo script: nel registry npm, i pacchetti `@img/sharp-libvips-*` sono LGPL-3.0-or-later; alcuni pacchetti `@img/sharp-*` per Windows e WebAssembly dichiarano Apache-2.0 insieme a LGPL-3.0-or-later; gli altri binari `@img/sharp-*` sono Apache-2.0, mentre i binari `@esbuild` e `@next/swc` sono MIT.


## Domande?

Per qualsiasi domanda tecnica o organizzativa, aprire una issue con label
"question" su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues,
oppure scrivi a fabiot2801@gmail.com. Per le vulnerabilità di sicurezza non aprire issue pubbliche: usa la procedura privata descritta in [SECURITY.md](SECURITY.md).

---

Grazie per contribuire alla protezione del cielo notturno.

[Fabio Tempera](https://ft2801.github.io/Portfolio), 2026
