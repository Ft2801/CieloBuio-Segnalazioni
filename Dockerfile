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

# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

# Variabili NEXT_PUBLIC_* sono inlineate da Next.js nel bundle client
# in fase di build. Per averle disponibili nel bundle, vanno passate
# come ARG e rese disponibili come ENV prima di `next build`.
ARG NEXT_PUBLIC_BASE_URL=https://segnalazioni.esempio.it
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL

# Copia file di dipendenze e lockfile per installazione riproducibile.
# npm ci richiede package-lock.json e fallisce se non è sincronizzato
# con package.json, garantendo che l'installazione sia deterministica.
# L'ordine (deps prima, sorgenti dopo) sfrutta la cache dei layer Docker:
# solo i cambiamenti a package.json invalidano il layer npm ci.
COPY package.json package-lock.json ./

# Installa dipendenze in modalità deterministica (--ci).
RUN npm ci

# Genera Prisma client (richiede schema)
COPY prisma ./prisma/
RUN npx prisma generate

# Copia sorgenti (questo layer cambia spesso, ma la dipendenza npm ci
# è già cachata dal layer precedente).
COPY . .

# Build standalone
RUN npx next build

# Stage 2: Runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Crea utente non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# curl per health check più affidabile di wget --spider (BusyBox).
RUN apk add --no-cache curl

# Copia standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Copia tsx e le sue dipendenze per permettere l'esecuzione degli script
# TypeScript (db:seed, db:create-admin, db:backup, cron:reminder) anche
# nel container Docker, senza richiedere bun. tsx è un runner TypeScript
# zero-config basato su esbuild, leggero e compatibile con Node.js.
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=builder /app/node_modules/get-ts-avx-wasm ./node_modules/get-ts-avx-wasm
COPY --from=builder /app/package.json ./package.json

# Crea directory storage e backups con permessi corretti per l'utente non-root
RUN mkdir -p storage/uploads /backups && \
    chown -R nextjs:nodejs storage /backups

USER nextjs

EXPOSE 3000

# Health check con curl: più affidabile di wget --spider su Alpine BusyBox,
# dove il flag --spider ha comportamenti inconsistenti tra versioni.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
