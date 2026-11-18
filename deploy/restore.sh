#!/usr/bin/env bash
set -euo pipefail
deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ne 3 || "$3" != '--confirm-new-database' || ! "$2" =~ ^[a-z][a-z0-9_]{0,62}$ || ! -s "$1" ]]; then
  echo 'Usage: deploy/restore.sh ARCHIVE NEW_DATABASE --confirm-new-database' >&2
  exit 1
fi
archive="$1"
target_database="$2"
if [[ -f "$archive.sha256" ]]; then
  expected_hash="$(cut -d ' ' -f 1 -- "$archive.sha256")"
  actual_hash="$(sha256sum "$archive")"
  [[ "$expected_hash" =~ ^[0-9a-f]{64}$ && "${actual_hash%% *}" == "$expected_hash" ]]
fi
# createdb refuses an existing name. Never drop/clean an existing database.
"$deploy_directory/compose.sh" exec -T db sh -c 'exec createdb -U "$POSTGRES_USER" -- "$1"' sh "$target_database"
"$deploy_directory/compose.sh" exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --no-owner --no-acl' sh "$target_database" < "$archive"
echo 'Restored into the new database. Verify it before changing DATABASE_URL.'
