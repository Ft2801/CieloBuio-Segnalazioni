#!/usr/bin/env bash
#
# CieloBuio Segnalazioni - Deploy script
# Automatizza il deploy su VPS: pull, build, migrate, restart
#
# Uso: ./scripts/deploy.sh [production|staging] [branch]
# Esempio: ./scripts/deploy.sh staging develop
#
# Variabili d'ambiente opzionali:
#   FORCE_DEPLOY=1  Forza il deploy anche se il backup fallisce (uso rischioso,
#                   da limitare a situazioni di emergenza).
#
# Autore: Fabio Tempera (2026)

set -euo pipefail

ENVIRONMENT="${1:-production}"
BRANCH="${2:-main}"
PROJECT_DIR="/opt/cielobuio-segnalazioni"
SERVICE_NAME="cielobuio-segnalazioni"

# Trap per cleanup in caso di uscita anomala: logga sempre l'esito
# finale, sia in caso di successo che di errore. Aiuta a diagnosticare
# deploy falliti che altrimenti lascerebbero log troncati.
trap 'EXIT_CODE=$?; if [ $EXIT_CODE -ne 0 ]; then echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy FALLITO con codice $EXIT_CODE"; fi' EXIT

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Inizio deploy ambiente: $ENVIRONMENT (branch: $BRANCH)"

# 1. Verifica prerequisiti
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERRORE: File .env non trovato in $PROJECT_DIR"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "ERRORE: Node.js non installato"
  exit 1
fi

# Verifica che sudo sia configurato passwordless per systemctl:
# in modalità non interattiva (CI, cron) sudo senza password resterebbe
# in attesa bloccando il deploy.
if ! sudo -n true 2>/dev/null; then
  echo "ERRORE: sudo richiede password. Configurare passwordless sudo per systemctl:"
  echo "  echo 'cielobuio ALL=(ALL) NOPASSWD: /bin/systemctl restart $SERVICE_NAME' | sudo tee /etc/sudoers.d/cielobuio-deploy"
  exit 1
fi

# 2. Backup del database prima del deploy.
# Fail-closed: se il backup fallisce, interrompiamo il deploy per evitare
# perdita di dati in caso di migrazione destructiva. Un deploy senza backup
# è un rischio accettabile solo se esplicitamente forzato con FORCE_DEPLOY=1.
echo "[1/7] Backup database..."
cd "$PROJECT_DIR"
if ! npm run db:backup; then
  if [ "${FORCE_DEPLOY:-0}" = "1" ]; then
    echo "WARNING: Backup fallito ma FORCE_DEPLOY=1, procedo comunque (RISCHIO PERDITA DATI)"
    sleep 5
  else
    echo "ERRORE: Backup fallito. Deploy interrotto per sicurezza."
    echo "Per forzare il deploy nonostante il backup fallito: FORCE_DEPLOY=1 ./scripts/deploy.sh"
    exit 1
  fi
fi

# 3. Pull del codice
echo "[2/7] Pull codice (branch: $BRANCH)..."
git pull origin "$BRANCH"

# 4. Installa dipendenze
echo "[3/7] Installazione dipendenze..."
npm ci

# 5. Genera Prisma client
echo "[4/7] Generazione Prisma client..."
npx prisma generate

# 6. Sincronizza schema database
# Usa db:push invece di migrate: il progetto non ha una directory
# prisma/migrations/ (setup iniziale gestito a mano con seed.ts).
# db:push applica le modifiche dello schema al database in modo diretto,
# senza creare migration files. In produzione, per cambiamenti schema
# futuri che richiedono data migration, valutare l'introduzione di
# prisma/migrations/ e passare a `prisma migrate deploy`.
echo "[5/7] Sincronizzazione schema database..."
npx prisma db push --skip-generate

# 7. Build
echo "[6/7] Build applicazione..."
npm run build

# 8. Restart del servizio
echo "[7/7] Restart servizio systemd..."
sudo systemctl restart "$SERVICE_NAME"
sleep 3

# 9. Verifica health check.
# Aumentato a 20 tentativi × 3s = 60s max: una cold start con Prisma
# client generation può superare i 30s del default precedente.
echo "Verifica health check..."
HEALTH_URL="http://localhost:3000/api/health"
for i in {1..20}; do
  # Proviamo prima con jq (parsing robusto), fallback a grep per sistemi senza jq
  if command -v jq &> /dev/null; then
    if curl -sf "$HEALTH_URL" | jq -e '.status == "ok"' > /dev/null 2>&1; then
      echo "Health check: OK"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy completato con successo"
      exit 0
    fi
  else
    if curl -sf "$HEALTH_URL" | grep -q '"status":"ok"'; then
      echo "Health check: OK"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy completato con successo"
      exit 0
    fi
  fi
  echo "Tentativo $i/20: servizio non ancora pronto..."
  sleep 3
done

echo "ERRORE: Health check fallito dopo 20 tentativi"
echo "Controlla i log: sudo journalctl -u $SERVICE_NAME -f"
exit 1
