#!/usr/bin/env bash
# tests/e2e/setup.sh
#
# Boots the magic-login end-to-end test stack:
#   1. plugin clone (no wp-env yet — git clone only)
#   2. wp-env start (boots WordPress 6.6 + MariaDB containers)
#   3. activate plugin + write options via wp-env wp-cli
#   4. docker-compose.test.yml (Postgres + migrate + seed + hub)
#   5. wait for hub /api/health + verify admin login works
#
# Idempotent: re-runs reuse existing containers; teardown.sh wipes them.
#
# Migration strategy:
#   The Dockerfile installs --omit=dev so the `prisma` CLI is NOT in the
#   hub image. We have two options:
#     a) Run migrate inside a container that has devDeps — slow (npm ci)
#     b) Run migrate from the host (the test runner has all devDeps)
#   We pick (a) — docker-compose.test.yml has its own migrate + seed
#   services that run locked `npm ci` installs first, mirroring production's
#   one-shot pattern. setup.sh waits for both to complete.
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
WP_ENV_CONFIG="$E2E_DIR/wp-env/.wp-env.json"
export WP_ENV_CONFIG

# ---------------------------------------------------------------------------
# 1. wp-env — clones plugin (no container boot yet).
# ---------------------------------------------------------------------------
if [ "${SKIP_WP_ENV:-0}" != "1" ]; then
  log "running wp-env plugin clone"
  bash "$E2E_DIR/wp-env/setup-plugin.sh" \
    "wp-content/plugins/ashbi-agency-wp-bridge" --clone-only

  log "starting wp-env (first run downloads WordPress 6.6 + MariaDB)"
  # .wp-env.json at repo root is the canonical config; --config is a fallback.
  cd "$REPO_ROOT"
  if [ -f "$REPO_ROOT/.wp-env.json" ]; then
    npx --yes @wordpress/env start
  else
    npx --yes @wordpress/env start --config "$WP_ENV_CONFIG"
  fi

  log "activating plugin + writing plugin options"
  bash "$E2E_DIR/wp-env/setup-plugin.sh" \
    "wp-content/plugins/ashbi-agency-wp-bridge" --activate-only
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

# ---------------------------------------------------------------------------
# 4. Verify the admin user from seed can actually log in.
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
