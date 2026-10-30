# CieloBuio Segnalazioni - Dockerfile multi-stage
# Build standalone Next.js, poi runtime minimale
# Autore: Fabio Tempera (2026)
#
# Nota su HOSTNAME=0.0.0.0 (stage runtime):
# In questo contesto Docker, il container app binda 0.0.0.0:3000 sulla
# rete Docker interna, ma la porta è mappata sull'host solo su
# 127.0.0.1:3000:3000 nel docker-compose.yml. Quindi dall'esterno la
# porta 3000 NON è raggiungibile direttamente, ed è protetta dal
# reverse proxy Caddy. Questo è diverso dal deploy "systemd bare-metal"
# dove invece serve HOSTNAME=127.0.0.1 direttamente nel processo Node
# (vedi SETUP.md sezione 8.8), perché in quel caso manca l'isolamento
# della rete Docker.

# Stage 1: Build e dipendenze di produzione
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS builder
WORKDIR /app

# NEXT_PUBLIC_BASE_URL è inlineata nel bundle client in fase di build.
# Non esiste un valore di default: il dominio reale va sempre passato
# come build arg (docker-compose.yml lo rende obbligatorio).
ARG NEXT_PUBLIC_BASE_URL
RUN test -n "$NEXT_PUBLIC_BASE_URL" || { echo "NEXT_PUBLIC_BASE_URL obbligatoria (build arg)" >&2; exit 1; }
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL

# Copia file di dipendenze e lockfile per installazione riproducibile.
# npm ci richiede package-lock.json e fallisce se non è sincronizzato
# con package.json, garantendo che l'installazione sia deterministica.
# L'ordine (deps prima, sorgenti dopo) sfrutta la cache dei layer Docker:
# solo i cambiamenti a package.json, allo schema Prisma o alla sua
# configurazione invalidano il layer npm ci.
COPY package.json package-lock.json ./

# Schema e configurazione Prisma servono già durante npm ci: il postinstall
# esegue `prisma generate`, che senza schema termina con errore.
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Installa dipendenze in modalità deterministica, poi genera il client Prisma
# (richiede lo schema, già copiato sopra).
RUN npm ci && npx prisma generate

# Copia sorgenti (questo layer cambia spesso, ma la dipendenza npm ci
# è già cachata dal layer precedente).
COPY . .

# Build standalone, poi rimozione delle devDependencies: nel runtime restano
# le dipendenze di produzione, compresi la CLI Prisma (per le migrazioni) e
# tsx (per gli script CLI di db:seed, db:create-admin, db:backup, cron:reminder).
RUN npx next build && npm prune --omit=dev

# Stage 2: Runtime
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Crea utente non-root e le directory di storage e backup con permessi
# corretti (in una sola istruzione per ridurre i layer).
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs \
    && mkdir -p storage/uploads /backups \
    && chown -R nextjs:nodejs storage /backups \
    && chmod 0700 storage storage/uploads /backups

# Output standalone (server.js e il sottoinsieme di node_modules tracciato)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Dipendenze di produzione complete: CLI Prisma, adapter PostgreSQL, tsx.
COPY --from=builder /app/node_modules ./node_modules

# Schema, migrazioni e configurazione Prisma per `prisma migrate deploy`.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Script CLI (TypeScript che importano src/lib), con la configurazione TypeScript.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json

# npm serve ai comandi di manutenzione (db:migrate, db:seed, cron:reminder).
# L'npm incluso nell'immagine base porta undici 6.28.0 e brace-expansion 5.0.9,
# che hanno vulnerabilità corrette in versioni successive: si aggiornano npm
# (versione fissata) e undici, poi il build verifica le versioni minime.
RUN npm install -g npm@11.21.1 --no-audit --no-fund \
    && npm pack undici@6.29.1 --silent --pack-destination /tmp > /dev/null \
    && mkdir /tmp/undici-fix \
    && tar -xzf /tmp/undici-6.29.1.tgz -C /tmp/undici-fix \
    && rm -rf "$(npm root -g)/npm/node_modules/undici" \
    && mv /tmp/undici-fix/package "$(npm root -g)/npm/node_modules/undici" \
    && rm -rf /tmp/undici-fix /tmp/undici-6.29.1.tgz /root/.npm \
    && node -e 'const d = process.argv[1] + "/npm/node_modules/"; \
const ver = (p) => require(d + p + "/package.json").version; \
const min = (v, m) => { const a = v.split(".").map(Number); const b = m.split(".").map(Number); \
for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; }; \
const u = ver("undici"); const b = ver("brace-expansion"); \
if (!min(u, "6.29.1") || u.split(".")[0] !== "6") throw new Error("undici non aggiornato: " + u); \
if (!min(b, "5.0.11") || b.split(".")[0] !== "5") throw new Error("brace-expansion non aggiornato: " + b); \
console.log("npm " + require(process.argv[1] + "/npm/package.json").version + " ok: undici " + u + ", brace-expansion " + b);' "$(npm root -g)"

USER nextjs

EXPOSE 3000

# Health check con Node.js: nessun pacchetto aggiuntivo nell'immagine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
