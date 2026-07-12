# Contribuire a CieloBuio, segnalazioni

Grazie per il tuo interesse nel contribuire al progetto CieloBuio. Questo documento raccoglie le linee guida per chi vuole proporre modifiche, segnalare bug o aggiungere funzionalità.

## Contesto del progetto

Prima di contribuire, leggere con attenzione il file [README.md](README.md), in particolare:

- i **vincoli non negoziabili** (bassa manutenzione, open source, formato dati portatile, nessun lock-in)
- il principio di **architettura dati separata dalla logica applicativa**
- il principio del **motore a regole/flag configurabili**

Questi vincoli sono la ragione d'essere del progetto e qualsiasi contributo che li violi non potrà essere accettato.

## Come segnalare un bug

1. Verificare che il bug non sia già segnalato nelle issue aperte su
   https://github.com/Ft2801/CieloBuio-Segnalazioni/issues
2. Aprire una nuova issue con:
   - titolo descrittivo
   - passi per riprodurre il problema
   - comportamento atteso
   - comportamento osservato
   - versione del software, browser, sistema operativo
   - eventuali screenshot o log
3. In alternativa, scrivere a fabiot2801@gmail.com (privato, per bug sensibili
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
2. Creare un branch descrittivo (`fix/bug-login`, `feature/export-csv`, ecc.)
3. Scrivere codice seguendo le convenzioni esistenti (TypeScript strict, componenti funzionali React, prefisso `use-` per gli hook)
4. Verificare che il codice compili senza errori:
   ```bash
   npm run lint
   npm run typecheck
   ```
5. Verificare che i test passino con coverage 100%:
   ```bash
   npm run test:coverage
   ```
6. Verificare che l'applicazione si avvii e funzioni nei flussi principali (login, nuova segnalazione, approvazione, invio PEC)
7. Scrivere un messaggio di commit descrittivo (in italiano, con verbo all'infinito)
8. Aprire la pull request collegandola alla issue originale

## Regole architetturali inviolabili

### 1. Nessun testo normativo nel codice

**Vietato** inserire nel codice riferimenti a leggi, articoli, numeri di decreto. Tutto deve passare per la tabella `regioni_leggi` (vedi `prisma/schema.prisma`). Se una regione cambia la sua norma, si aggiorna una riga del database, non il software.

### 2. Nessuna dipendenza da servizi a pagamento

Non aggiungere librerie o servizi che richiedono licenze a pagamento ricorrenti o con pricing che può cambiare. Solo open source con licenza permissiva (MIT, Apache 2.0, ISC, BSD).

### 3. Nessuna automazione di decisioni legali

L'escalation verso la Procura della Repubblica, la generazione automatica di diffide formali o altre azioni con conseguenze legali **non vanno mai automatizzate**. Il sistema segnala, l'essere umano decide.

### 4. Nessun hard-coding di dati di configurazione

Nomi di sindaci, indirizzi PEC, riferimenti regionali non devono mai finire nel codice. Vivono nelle tabelle di configurazione editabili dal pannello admin.

### 5. Formato dati portatile

Qualsiasi nuovo campo nel database deve essere facilmente esportabile in CSV/Excel. Evitare campi JSON annidati complessi quando una relazione esplicita è più chiara.

## Stile del codice

- **TypeScript** strict mode, nessun `any` se non strettamente necessario
- **Componenti funzionali** React, hook personalizzati con prefisso `use-`
- **API Routes** con gestione errori esplicita e risposte JSON coerenti (`{ ok: true }` o `{ error: "..." }`)
- **Commenti** in italiano, concisi, solo dove servono
- **Nomi** in italiano per concetti di business (segnalazione, referente, volontario), in inglese per utility tecniche
- **Niente emoji** nel codice o nei messaggi di commit

## Convenzioni per i commit

Messaggi in italiano, verbo all'infinito, massimo 72 caratteri nel titolo:

```
Aggiunge validazione email lato server
Corregge bug di svuotamento form dopo salvataggio
Rimuove dipendenza non più necessaria
```

## Testing

Il progetto ha una suite di **1561 test automatici** con **Vitest**:

- **482 test unitari** su `src/lib/` con coverage 100% (statements, branches, functions, lines)
- **460 test di integrazione** su tutte le 30 API routes in `src/app/api/__tests__/` con mock di DB (Prisma), next/headers, nodemailer, bcryptjs, fs/promises
- **80 test di sicurezza informatica** in `src/__tests__/security-attack-suite.test.ts` organizzati per OWASP Top 10 (IDOR, injection, CSRF, XSS, path traversal, brute force, session fixation, file upload spoofing, GDPR, TOTP 2FA)
- **25 test** su `src/middleware.ts` (security headers, CSRF, fail-closed)
- **38 test** su 12 componenti UI shadcn/ui
- **20 test** su `src/hooks/use-toast.ts`
- **530 test** su 9 componenti app (AutoreLink, LoginScreen, VistaReminder, Dashboard, ListaSegnalazioni, AppShell, DettaglioSegnalazione, FormSegnalazione, PannelloAdmin)
- **15 test** su `src/app/layout.tsx` e `src/app/page.tsx`
- **7 test** su `scripts/cron-jobs.ts`

Quando si contribuisce:

- Eseguire i test: `npm run test`
- Eseguire con coverage: `npm run test:coverage`
- Aggiungere test per ogni nuova funzionalità in:
  - `src/lib/__tests__/` (per funzioni pure)
  - `src/app/api/__tests__/` (per route handler)
  - `src/components/app/__tests__/` (per componenti React)
  - `src/components/ui/__tests__/` (per componenti UI)
- Mantenere la coverage al 100% su `src/lib/`, `src/middleware.ts`, `src/hooks/`, `src/components/ui/`, `src/app/api/`, `src/app/layout.tsx`, `src/app/page.tsx`, `scripts/cron-jobs.ts`
- Per i componenti app complessi, ogni nuovo ramo condizionale deve essere coperto da almeno un test
- Per le API routes, ogni nuovo endpoint deve avere test di integrazione che coprono: 401/403 (autenticazione), 400 (validazione), 404 (not found), 409 (race condition se applicabile), 200/201 (successo), 500 (errore DB)
- Verificare la responsività mobile (viewport 375px)
- Verificare che il lint passi senza errori: `npm run lint`
- Verificare che il typecheck passi: `npm run typecheck`

I test usano mock per DB (Prisma), nodemailer, bcryptjs, next/headers, fs/promises e fetch globale, con fake timers per testare il rate limiting. Per esporre funzioni interne ai test, usare il prefisso `__` (es. `__resetRateLimitStoreForTests`, `__resetTransporterCacheForTests`, `__resetToastStateForTests`) come già fatto per rate-limit, notifiche e use-toast.

## Domande?

Per qualsiasi domanda tecnica o organizzativa, aprire una issue con label
"question" su https://github.com/Ft2801/CieloBuio-Segnalazioni/issues,
oppure scrivi a fabiot2801@gmail.com.

---

Grazie per contribuire alla protezione del cielo notturno.

[Fabio Tempera](https://ft2801.github.io/Portfolio), 2026
