#!/usr/bin/env bash
# Deploy systemd della versione 1.0.0: backup coerente, build e migrazioni.
# Uso: ./scripts/deploy.sh [production|staging] [branch]
# CIELOBUIO_APP_DIR e CIELOBUIO_SERVICE consentono percorsi e unità dedicati.
# Il codice applicativo, cron e gli altri writer devono essere gestiti sullo
# stesso host; sospendere i job esterni durante la finestra di manutenzione.
set -euo pipefail

ENVIRONMENT="${1:-production}"
BRANCH="${2:-main}"
case "$ENVIRONMENT" in
  production) SUFFIX="" ;;
  staging) SUFFIX="-staging" ;;
  *) printf 'Ambiente non valido: %s\n' "$ENVIRONMENT" >&2; exit 1 ;;
esac
PROJECT_DIR="${CIELOBUIO_APP_DIR:-/opt/cielobuio-segnalazioni${SUFFIX}}"
SERVICE_NAME="${CIELOBUIO_SERVICE:-cielobuio-segnalazioni${SUFFIX}}"
RIAVVIARE=0
HEALTH_URL="${CIELOBUIO_HEALTH_URL:-http://localhost:3000/api/health}"
if [ "$ENVIRONMENT" = "staging" ] && [ -z "${CIELOBUIO_HEALTH_URL:-}" ]; then
  printf 'Configurare CIELOBUIO_HEALTH_URL per verificare il servizio staging, non quello di produzione.\n' >&2
  exit 1
fi

finalizza() {
  local esito=$?
  trap - EXIT
  if [ "$RIAVVIARE" = "1" ]; then
    if ! sudo -n systemctl start "$SERVICE_NAME"; then
      printf 'Avvio del servizio fallito: %s. Intervento necessario.\n' "$SERVICE_NAME" >&2
      esito=1
    fi
  fi
  if [ "$esito" -ne 0 ]; then
    printf 'Deploy non completato. Verificare database, artefatti e servizio prima di riprovare.\n' >&2
  fi
  exit "$esito"
}
trap finalizza EXIT

for comando in node npm npx git curl sudo; do
  if ! command -v "$comando" >/dev/null 2>&1; then
    printf 'Comando richiesto non disponibile: %s\n' "$comando" >&2
    exit 1
  fi
done
if [ ! -f "$PROJECT_DIR/.env" ]; then
  printf 'File .env non trovato in %s\n' "$PROJECT_DIR" >&2
  exit 1
fi
cd "$PROJECT_DIR"
git check-ref-format --branch "$BRANCH" >/dev/null
if [ "$(git branch --show-current)" != "$BRANCH" ]; then
  printf 'Il ramo attivo non è %s. Nessun deploy eseguito.\n' "$BRANCH" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  printf 'La directory di lavoro contiene file locali non registrati o modificati. Deploy interrotto.\n' >&2
  exit 1
fi
# Verifica i permessi sui soli comandi necessari, senza richiedere sudo generico.
for azione in stop start; do
  if ! sudo -n -l systemctl "$azione" "$SERVICE_NAME" >/dev/null 2>&1; then
    printf 'Permesso sudo non interattivo richiesto: systemctl %s %s\n' "$azione" "$SERVICE_NAME" >&2
    exit 1
  fi
done
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  printf 'Servizio non attivo: %s. Verificare lo stato prima del deploy.\n' "$SERVICE_NAME" >&2
  exit 1
fi

printf 'Deploy ambiente %s, ramo %s, servizio %s\n' "$ENVIRONMENT" "$BRANCH" "$SERVICE_NAME"
RIAVVIARE=1
sudo -n systemctl stop "$SERVICE_NAME"
# Nessuna opzione consente di ignorare un backup fallito.
npm run db:backup
git pull --ff-only origin "$BRANCH"
npm ci
# Una build fallita non deve lasciare il database con uno schema nuovo.
npm run build
npx prisma migrate deploy
sudo -n systemctl start "$SERVICE_NAME"
RIAVVIARE=0

for i in {1..20}; do
  # Il timeout effettivo è limitato anche se il server non chiude la connessione.
  BODY="$(curl --connect-timeout 2 --max-time 3 -sf "$HEALTH_URL" || true)"
  if printf '%s' "$BODY" | node -e '
    let s = "";
    process.stdin.on("data", c => s += c);
    process.stdin.on("end", () => {
      try { process.exit(JSON.parse(s).status === "ok" ? 0 : 1); }
      catch { process.exit(1); }
    });
  '; then
    printf 'Deploy completato. Health check: OK\n'
    exit 0
  fi
  printf 'Tentativo %s/20: servizio non ancora pronto.\n' "$i"
  sleep 3
done
printf 'Health check fallito. Controllare: journalctl -u %s\n' "$SERVICE_NAME" >&2
exit 1
