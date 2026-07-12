#!/usr/bin/env bash
#
# CieloBuio Segnalazioni - Deploy script
# Automatizza il deploy su VPS: pull, build, migrate, restart
#
# Uso: ./scripts/deploy.sh [production|staging]
# Autore: Fabio Tempera (2026)

set -euo pipefail

ENVIRONMENT="${1:-production}"
PROJECT_DIR="/opt/cielobuio-segnalazioni"
SERVICE_NAME="cielobuio-segnalazioni"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Inizio deploy ambiente: $ENVIRONMENT"

# 1. Verifica prerequisiti
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "ERRORE: File .env non trovato in $PROJECT_DIR"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "ERRORE: Node.js non installato"
  exit 1
fi

# 2. Backup del database prima del deploy
echo "[1/7] Backup database..."
cd "$PROJECT_DIR"
npm run db:backup || {
  echo "WARNING: Backup fallito, procedo comunque (CTRL+C per annullare)"
  sleep 5
}

# 3. Pull del codice
echo "[2/7] Pull codice..."
git pull origin main

# 4. Installa dipendenze
echo "[3/7] Installazione dipendenze..."
npm ci

# 5. Genera Prisma client
echo "[4/7] Generazione Prisma client..."
npx prisma generate

# 6. Esegui migrazioni database
echo "[5/7] Migrazioni database..."
npx prisma migrate deploy

# 7. Build
echo "[6/7] Build applicazione..."
npm run build

# 8. Restart del servizio
echo "[7/7] Restart servizio systemd..."
sudo systemctl restart "$SERVICE_NAME"
sleep 3

# 9. Verifica health check
echo "Verifica health check..."
HEALTH_URL="http://localhost:3000/api/health"
for i in {1..10}; do
  if curl -sf "$HEALTH_URL" | grep -q '"status":"ok"'; then
    echo "Health check: OK"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy completato con successo"
    exit 0
  fi
  echo "Tentativo $i/10: servizio non ancora pronto..."
  sleep 3
done

echo "ERRORE: Health check fallito dopo 10 tentativi"
echo "Controlla i log: sudo journalctl -u $SERVICE_NAME -f"
exit 1
