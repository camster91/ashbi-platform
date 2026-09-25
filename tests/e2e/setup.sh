#!/usr/bin/env bash
# tests/e2e/setup.sh
#
# Boots the full-stack smoke environment from docker-compose.test.yml
# (Postgres + Redis + migrate + seed + worker + hub), waits for the hub's
# readiness check, and verifies the seeded admin can log in.
#
# Idempotent: re-runs reuse existing containers; teardown.sh wipes them.
#
# Env knobs:
#   HOST_PORT — host port for hub (default 3001)
#
# Exit codes: 0 when the stack is healthy, 1 on boot failure (diagnostics on stderr).

set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

log() { printf '[e2e-setup] %s\n' "$*" >&2; }
fail() { log "FATAL: $*"; exit 1; }

command -v docker >/dev/null || fail "docker not on PATH"

cd "$REPO_ROOT"
export HOST_PORT="${HOST_PORT:-3001}"

log "booting hub stack on host port $HOST_PORT"
docker compose \
  -f "$E2E_DIR/docker-compose.test.yml" \
  --project-name ashbi-e2e up -d --build

HUB_URL="http://localhost:${HOST_PORT}"
log "waiting for hub /api/health at $HUB_URL"
DEADLINE=$(( $(date +%s) + 180 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -fsS "$HUB_URL/api/health" >/dev/null 2>&1; then
    log "hub healthy at $HUB_URL"
    break
  fi
  sleep 2
done
if ! curl -fsS "$HUB_URL/api/health" >/dev/null 2>&1; then
  log "last /api/health report:"
  curl -sS "$HUB_URL/api/health" >&2 || true
  printf '\n' >&2
  for svc in hub worker; do
    log "docker logs ashbi-e2e-${svc}-1 (tail):"
    docker logs --tail 80 "ashbi-e2e-${svc}-1" >&2 2>&1 || true
  done
  fail "hub never became healthy at $HUB_URL"
fi

log "verifying admin login works (cameron@ashbi.ca)"
LOGIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$HUB_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"cameron@ashbi.ca","password":"TestPass123!"}')
if [ "$LOGIN_STATUS" != "200" ]; then
  fail "admin login failed (status $LOGIN_STATUS) — check: docker logs ashbi-e2e-seed-1"
fi
log "admin login verified"

log "ready — run \`npm run test:e2e\`"
