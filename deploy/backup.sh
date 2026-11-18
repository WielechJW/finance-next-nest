#!/usr/bin/env bash
set -euo pipefail
umask 077
deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_directory="${BACKUP_DIRECTORY:-$deploy_directory/backups}"
mkdir -p -- "$backup_directory"
temporary="$(mktemp "$backup_directory/.backup.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
"$deploy_directory/compose.sh" exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$temporary"
test -s "$temporary"
archive="$backup_directory/finance-$(date -u +%Y%m%dT%H%M%SZ)-$(basename -- "$temporary").dump"
mv -- "$temporary" "$archive"
sha256sum "$archive" > "$archive.sha256"
printf '%s\n' "$archive"
