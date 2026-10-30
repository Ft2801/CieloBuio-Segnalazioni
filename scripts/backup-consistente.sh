#!/usr/bin/env bash
# Da eseguire come root tramite cron su un host con servizio systemd.
# Durante il backup nessun processo deve scrivere nel database o nello storage.
set -euo pipefail

APP_DIR="${CIELOBUIO_APP_DIR:-/opt/cielobuio-segnalazioni}"
SERVICE_NAME="${CIELOBUIO_SERVICE:-cielobuio-segnalazioni}"
APP_USER="${CIELOBUIO_APP_USER:-www-data}"

if [[ ! -d "$APP_DIR" ]]; then
  printf 'Directory applicativa non trovata: %s\n' "$APP_DIR" >&2
  exit 1
fi
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  printf 'Servizio non attivo: %s. Backup non avviato.\n' "$SERVICE_NAME" >&2
  exit 1
fi

riavvia_servizio() {
  local esito=$?
  trap - EXIT
  if ! systemctl start "$SERVICE_NAME"; then
    printf 'Avvio del servizio fallito: %s. Intervento immediato necessario.\n' "$SERVICE_NAME" >&2
    exit 1
  fi
  exit "$esito"
}

trap riavvia_servizio EXIT
systemctl stop "$SERVICE_NAME"
cd "$APP_DIR"
runuser -u "$APP_USER" -- npm run db:backup
