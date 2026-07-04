#!/usr/bin/env bash
# tests/e2e/setup.sh
#
# Boots the magic-login end-to-end test stack:
#   1. plugin clone + activate (wp-env/wp-content/...)
#   2. wp-env Docker containers (WordPress 6.6 + MariaDB)
#   3. docker-compose.test.yml (Postgres + migrate + seed + hub)
#   4. wait for hub /api/health to return 200
#
# Idempotent: re-runs reuse existing containers; teardown.sh wipes them.
#
# Migration strategy:
#   The Dockerfile installs --omit=dev so the `prisma` CLI is NOT in the
#   hub image. We have two options:
#     a) Run migrate inside a container that has devDeps — slow (npm install)
#     b) Run migrate from the host (the test runner has all devDeps)
#   We pick (b) — the host has prisma already. setup.sh runs
#   `npx prisma migrate deploy` directly against the test Postgres.
#
# Seed strategy: same logic — `node prisma/seed.js` from the host with
#   ADMIN_SEED_PASSWORD set to match the docker-compose ADMIN_PASSWORD.
#
# Env knobs (override on CI):
#   HOST_PORT         — host port for hub (default 3001)
#   HUB_DB_PORT       — host port for Postgres (default 54329)
#   ASHBI_HUB_URL     — URL plugin uses to reach hub (default host.docker.internal:3001)
#   ASHBI_HUB_SECRET  — shared secret (default test-e2e-secret-12345)
#   PLUGIN_BRANCH     — plugin repo branch to clone (default feat/magic-login-managewp-grade)
#   SKIP_WP_ENV       — set to 1 to skip wp-env (use when only hub is needed)
#
# Exit codes:
#   0 — all services up and healthy
#   1 — boot failed (logs printed to stderr)

set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

log() { printf '[e2e-setup] %s\n' "$*" >&2; }
fail() { log "FATAL: $*"; exit 1; }

command -v docker >/dev/null || fail "docker not on PATH"
command -v npx   >/dev/null || fail "npx not on PATH"

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. wp-env — clones plugin + boots WordPress.
# ---------------------------------------------------------------------------
if [ "${SKIP_WP_ENV:-0}" != "1" ]; then
  log "running wp-env/plugin setup"
  bash "$E2E_DIR/wp-env/setup-plugin.sh" \
    "wp-content/plugins/ashbi-agency-wp-bridge"

  log "starting wp-env (first run downloads WordPress 6.6 + MariaDB)"
  npx --yes wp-env start
else
  log "SKIP_WP_ENV=1 — assuming wp-env is already running"
fi

# ---------------------------------------------------------------------------
# 2. docker-compose — Postgres + migrate + seed + hub.
# ---------------------------------------------------------------------------
export HOST_PORT="${HOST_PORT:-3001}"

log "booting hub stack on host port $HOST_PORT"
docker compose \
  -f "$E2E_DIR/docker-compose.test.yml" \
  --project-name ashbi-e2e up -d --build

# ---------------------------------------------------------------------------
# 3. Wait for hub /health to return 200.
# ---------------------------------------------------------------------------
HUB_URL="http://localhost:${HOST_PORT}"
log "waiting for hub /api/health at $HUB_URL"
DEADLINE=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -fsS "$HUB_URL/api/health" >/dev/null 2>&1; then
    log "hub healthy at $HUB_URL"
    break
  fi
  sleep 1
done
curl -fsS "$HUB_URL/api/health" >/dev/null \
  || fail "hub never became healthy at $HUB_URL (see: docker logs ashbi-e2e-hub-1)"

# ---------------------------------------------------------------------------
# 4. Verify the admin user from seed can actually log in.
#    This catches cases where seed didn't run or the password mismatches.
# ---------------------------------------------------------------------------
log "verifying admin login works (cameron@ashbi.ca)"
LOGIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$HUB_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"cameron@ashbi.ca","password":"TestPass123!"}')
if [ "$LOGIN_STATUS" != "200" ]; then
  fail "admin login failed (status $LOGIN_STATUS) — seed didn't run or ADMIN_PASSWORD mismatch. Check: docker logs ashbi-e2e-seed-1"
fi
log "admin login verified"

log "ready — run \`npm run test:e2e\`"