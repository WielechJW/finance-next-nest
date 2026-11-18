#!/usr/bin/env bash
set -euo pipefail
deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
environment_file="${DEPLOY_ENV_FILE:-$deploy_directory/.env.production}"
compose_file="${DEPLOY_COMPOSE_FILE:-$deploy_directory/compose.production.yaml}"
if [[ ! -f "$environment_file" ]]; then
  echo 'Prepare deploy/.env.production from the example first.' >&2
  exit 1
fi
exec docker compose --env-file "$environment_file" -f "$compose_file" "$@"
