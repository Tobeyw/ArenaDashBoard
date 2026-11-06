#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
ACTION="${1:-start}"
case "$ACTION" in
  start|restart|stop|status|logs|check|build) ;;
  *) echo 'Usage: ./scripts/docker.sh [start|restart|stop|status|logs|check|build] [env-file]' >&2; exit 2 ;;
esac
command -v docker >/dev/null 2>&1 || { echo 'Docker is required.' >&2; exit 1; }
docker compose version >/dev/null
DASHBOARD_ENV_FILE="${2:-${DASHBOARD_ENV_FILE:-.env}}"
if [[ "$DASHBOARD_ENV_FILE" != /* ]]; then DASHBOARD_ENV_FILE="$PROJECT_DIR/$DASHBOARD_ENV_FILE"; fi
export DASHBOARD_ENV_FILE
if [[ ! -f "$DASHBOARD_ENV_FILE" ]]; then
  echo 'Environment file missing. Copy .env.docker.example to .env.production and fill in the database URL and Clerk key.' >&2
  exit 1
fi
COMPOSE=(docker compose --project-name arena-dashboard --env-file "$DASHBOARD_ENV_FILE" -f "$PROJECT_DIR/compose.yaml")
# Quiet validation deliberately avoids printing expanded secrets.
"${COMPOSE[@]}" config --quiet
case "$ACTION" in
  start) "${COMPOSE[@]}" up -d --build --wait --wait-timeout 120 ;;
  restart) "${COMPOSE[@]}" up -d --build --force-recreate --wait --wait-timeout 120 ;;
  stop) "${COMPOSE[@]}" stop ;;
  status) "${COMPOSE[@]}" ps ;;
  logs) "${COMPOSE[@]}" logs --follow --tail=100 dashboard ;;
  check) echo 'Compose configuration is valid. This does not verify database or Clerk connectivity.' ;;
  build) "${COMPOSE[@]}" build ;;
esac
