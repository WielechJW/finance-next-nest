#!/usr/bin/env bash
# Isolated smoke test, no application databases or real secrets. Requires Docker.
set -euo pipefail
umask 077
deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temporary="$(mktemp -d)"
project="finance-backup-test-$$"
cleanup() { docker compose -p "$project" --env-file "$temporary/.env" -f "$temporary/compose.yaml" down -v >/dev/null 2>&1 || true; rm -rf -- "$temporary"; }
trap cleanup EXIT
cat > "$temporary/.env" <<'ENV'
POSTGRES_USER=backup_test
POSTGRES_PASSWORD=synthetic_local_test_only
POSTGRES_DB=backup_source_test
ENV
cat > "$temporary/compose.yaml" <<'COMPOSE'
services:
  db:
    image: postgres:18
    env_file: .env
    tmpfs: [/var/lib/postgresql]
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 1s
      timeout: 3s
      retries: 30
COMPOSE
export DEPLOY_ENV_FILE="$temporary/.env" DEPLOY_COMPOSE_FILE="$temporary/compose.yaml" COMPOSE_PROJECT_NAME="$project" BACKUP_DIRECTORY="$temporary/backups"
"$deploy_directory/compose.sh" up -d --wait --wait-timeout 60 db >/dev/null
"$deploy_directory/compose.sh" exec -T db psql -U backup_test -d backup_source_test -v ON_ERROR_STOP=1 -c "CREATE TABLE restore_probe (id integer PRIMARY KEY, amount numeric(28,10)); INSERT INTO restore_probe VALUES (1, 9007199254740993.1234567890);" >/dev/null
archive="$("$deploy_directory/backup.sh")"
"$deploy_directory/restore.sh" "$archive" backup_restored_test --confirm-new-database >/dev/null
value="$("$deploy_directory/compose.sh" exec -T db psql -U backup_test -d backup_restored_test -At -c 'SELECT amount::text FROM restore_probe WHERE id=1')"
[[ "$value" == '9007199254740993.1234567890' ]]
if "$deploy_directory/restore.sh" "$archive" backup_source_test --confirm-new-database >/dev/null 2>&1; then echo 'Restore must refuse existing databases.' >&2; exit 1; fi
echo 'Backup/restore passed: exact decimal restored; existing database protected.'
