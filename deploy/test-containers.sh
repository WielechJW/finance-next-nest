#!/usr/bin/env bash
# Uses already-built images and an isolated database; never starts market/Telegram egress.
set -euo pipefail
temporary="$(mktemp -d)"
project="finance-container-test-$$"
cleanup() { docker compose -p "$project" -f "$temporary/compose.yaml" down -v >/dev/null 2>&1 || true; rm -rf -- "$temporary"; }
trap cleanup EXIT
cat > "$temporary/compose.yaml" <<'COMPOSE'
services:
  db:
    image: postgres:18
    environment: { POSTGRES_USER: finance, POSTGRES_PASSWORD: synthetic_only, POSTGRES_DB: container_test }
    tmpfs: [/var/lib/postgresql]
    healthcheck:
      test: [CMD, pg_isready, -U, finance, -d, container_test]
      interval: 1s
      timeout: 3s
      retries: 30
  migrate:
    image: finance-version-b-migrate:check
    environment: { DATABASE_URL: 'postgresql://finance:synthetic_only@db:5432/container_test' }
    depends_on: { db: { condition: service_healthy } }
  api:
    image: finance-version-b-api:check
    environment:
      DATABASE_URL: postgresql://finance:synthetic_only@db:5432/container_test
      SESSION_SECRET: synthetic_local_test_session_secret_32_bytes
      FRONTEND_ORIGIN: https://finance.example.com
      MARKET_DATA_ENABLED: '0'
    depends_on: { migrate: { condition: service_completed_successfully } }
    healthcheck:
      test: [CMD, node, -e, 'fetch("http://127.0.0.1:3001/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))']
      interval: 2s
      timeout: 5s
      retries: 30
  frontend:
    image: finance-version-b-frontend:check
    depends_on: { api: { condition: service_healthy } }
    healthcheck:
      test: [CMD, node, -e, 'fetch("http://127.0.0.1:3000/login").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))']
      interval: 2s
      timeout: 5s
      retries: 30
COMPOSE
docker compose -p "$project" -f "$temporary/compose.yaml" up -d --wait --wait-timeout 90
docker compose -p "$project" -f "$temporary/compose.yaml" exec -T api node --input-type=module -e '
const {hash, verify} = await import("argon2");
const value = await hash("synthetic-password");
if (!await verify(value, "synthetic-password")) process.exit(1);
const r = await fetch("http://127.0.0.1:3001/health/ready");
if (!r.ok || !(await r.json()).ready) process.exit(1);
'
echo 'Container checks passed: migrations, readiness, native password hashing and standalone frontend.'
