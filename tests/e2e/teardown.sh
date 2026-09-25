#!/usr/bin/env bash
# tests/e2e/teardown.sh
#
# Tears down everything setup.sh booted. Removes Docker volumes so the
# next run starts on a fresh DB. Safe to run when containers don't exist.

set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

log() { printf '[e2e-teardown] %s\n' "$*" >&2; }

cd "$REPO_ROOT"

log "stopping hub stack (with -v to wipe Postgres volume)"
docker compose \
  -f "$E2E_DIR/docker-compose.test.yml" \
  --project-name ashbi-e2e down -v --remove-orphans || log "WARN: hub compose down failed"

log "pruning ashbi-e2e-* orphan containers"
docker ps -a --filter "label=com.docker.compose.project=ashbi-e2e" -q \
  | xargs -r docker rm -f >/dev/null 2>&1 || true

log "done"
