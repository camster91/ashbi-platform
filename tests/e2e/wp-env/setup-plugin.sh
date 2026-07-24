#!/usr/bin/env bash
# tests/e2e/wp-env/setup-plugin.sh
#
# Clones the ashbi-agency-wp-bridge plugin (feat/magic-login-managewp-grade
# branch — which carries PR #37 + the c42795b revoke_by_hash fix and the
# PR-F dispatch fix `revoke_by_hash` vs `revoke`) into the wp-env plugin
# mount directory, then activates it via wp-cli.
#
# Source-of-truth plugin constants (verified against the live plugin
# source at includes/class-ashbi-magic-login.php):
#   - OPTION_AUDIT_LOG     = 'ashbi_magic_login_log'   (NOT _audit_log)
#   - TRANSIENT_PREFIX     = 'ashbi_ml_active_'        (NOT ashbi_magic_active_)
#   - audit field          = magic_token_hash          (NOT tokenHash)
#   - hash_token           = sha256(token)             (lowercase hex 64)
#   - revoke_by_hash       = validates ^[0-9a-f]{64}$  strict, then deletes
#                            the transient directly (no re-hash).
#
# Usage (called by tests/e2e/setup.sh in two phases):
#   setup-plugin.sh <PLUGIN_DIR> --clone-only      # git clone only
#   setup-plugin.sh <PLUGIN_DIR> --activate-only   # activate + write options
#   setup-plugin.sh <PLUGIN_DIR>                   # both phases (legacy)

set -euo pipefail

PLUGIN_DIR="${1:-wp-content/plugins/ashbi-agency-wp-bridge}"
MODE="${2:-all}"
PLUGIN_REPO="https://github.com/camster91/ashbi-agency-wp-bridge.git"
PLUGIN_BRANCH="${PLUGIN_BRANCH:-feat/magic-login-managewp-grade}"
PLUGIN_COMMIT="${PLUGIN_COMMIT:-}"
HUB_SECRET="${ASHBI_HUB_SECRET:-test-e2e-secret-12345}"
HUB_URL="${ASHBI_HUB_URL:-http://host.docker.internal:3001}"
WP_ENV_CONFIG="${WP_ENV_CONFIG:-tests/e2e/wp-env/.wp-env.json}"

log() { printf '[plugin-setup] %s\n' "$*" >&2; }

command -v git >/dev/null    || { log "FATAL: git not on PATH"; exit 1; }
command -v curl >/dev/null   || { log "FATAL: curl not on PATH"; exit 1; }
command -v npx >/dev/null    || { log "FATAL: npx not on PATH"; exit 1; }

mkdir -p "$(dirname "$PLUGIN_DIR")"

# ---------------------------------------------------------------------------
# Phase 1: clone
# ---------------------------------------------------------------------------
if [ "$MODE" = "all" ] || [ "$MODE" = "--clone-only" ]; then
  if [ ! -d "$PLUGIN_DIR/.git" ]; then
    log "cloning $PLUGIN_REPO @ $PLUGIN_BRANCH into $PLUGIN_DIR"
    git clone --depth 1 --branch "$PLUGIN_BRANCH" "$PLUGIN_REPO" "$PLUGIN_DIR"
  else
    log "plugin already cloned at $PLUGIN_DIR — fast-forwarding to origin/$PLUGIN_BRANCH"
    (cd "$PLUGIN_DIR" && git fetch origin "$PLUGIN_BRANCH" --depth 1 && \
      git checkout "origin/$PLUGIN_BRANCH" -- . 2>/dev/null || \
      git checkout "$PLUGIN_BRANCH")
  fi

  if [ -n "$PLUGIN_COMMIT" ]; then
    log "pinning plugin to commit $PLUGIN_COMMIT"
    (cd "$PLUGIN_DIR" && git checkout "$PLUGIN_COMMIT")
  fi

  # Pre-flight: confirm the plugin source actually contains the magic-login
  # constants we test against. Fail-fast here so setup.sh exits non-zero
  # with a clear diagnostic rather than waiting for vitest to fail later.
  log "verifying plugin source carries ManageWP-grade magic-login"
  grep -q "OPTION_AUDIT_LOG     = 'ashbi_magic_login_log'" \
    "$PLUGIN_DIR/includes/class-ashbi-magic-login.php" \
    || { log "FATAL: plugin source missing OPTION_AUDIT_LOG constant"; exit 2; }
  grep -q "TRANSIENT_PREFIX     = 'ashbi_ml_active_'" \
    "$PLUGIN_DIR/includes/class-ashbi-magic-login.php" \
    || { log "FATAL: plugin source missing TRANSIENT_PREFIX constant"; exit 2; }
  grep -q "magic_token_hash" \
    "$PLUGIN_DIR/includes/class-ashbi-magic-login.php" \
    || { log "FATAL: plugin source missing magic_token_hash audit field"; exit 2; }
fi

# ---------------------------------------------------------------------------
# Phase 2: activate + write options (requires wp-env start to have run)
# ---------------------------------------------------------------------------
if [ "$MODE" = "all" ] || [ "$MODE" = "--activate-only" ]; then
  log "activating plugin via wp-env wp-cli"
  # .wp-env.json at repo root is canonical; --config is a fallback for
  # users who only have tests/e2e/wp-env/.wp-env.json checked out.
  REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
  cd "$REPO_ROOT"
  if [ -f "$REPO_ROOT/.wp-env.json" ]; then
    npx --yes @wordpress/env run tests-cli wp plugin activate ashbi-agency-wp-bridge
    npx --yes @wordpress/env run tests-cli wp option update ashbi_hub_url    "$HUB_URL"
    npx --yes @wordpress/env run tests-cli wp option update ashbi_secret_key "$HUB_SECRET"
  else
    log "FATAL: repo-root .wp-env.json not found at $REPO_ROOT/.wp-env.json"
    exit 3
  fi
fi

log "plugin-setup phase done ($MODE)"