#!/usr/bin/env bash
# Installs a pinned ashbi-agency-wp-bridge fixture into wp-env and activates it.
# The fixture avoids private-repository access and moving branch dependencies.

set -euo pipefail

PLUGIN_DIR="${1:-wp-content/plugins/ashbi-agency-wp-bridge}"
MODE="${2:-all}"
HUB_SECRET="${ASHBI_HUB_SECRET:-test-e2e-secret-12345}"
HUB_URL="${ASHBI_HUB_URL:-http://host.docker.internal:3001}"
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/tests/e2e/fixtures/ashbi-agency-wp-bridge"

log() { printf '[plugin-setup] %s\n' "$*" >&2; }

# --clone-only is retained as a compatibility name for the install-only phase.
if [ "$MODE" = "all" ] || [ "$MODE" = "--clone-only" ]; then
  [ -f "$FIXTURE_DIR/ashbi-agency-wp-bridge.php" ] \
    || { log "FATAL: pinned plugin fixture missing at $FIXTURE_DIR"; exit 1; }

  mkdir -p "$PLUGIN_DIR"
  log "installing pinned plugin fixture into $PLUGIN_DIR"
  cp -R "$FIXTURE_DIR/." "$PLUGIN_DIR/"

  MAGIC_LOGIN_FILE="$PLUGIN_DIR/includes/class-ashbi-magic-login.php"
  log "verifying pinned plugin magic-login contract"
  grep -q "OPTION_AUDIT_LOG     = 'ashbi_magic_login_log'" "$MAGIC_LOGIN_FILE" \
    || { log "FATAL: plugin source missing OPTION_AUDIT_LOG constant"; exit 2; }
  grep -q "TRANSIENT_PREFIX     = 'ashbi_ml_active_'" "$MAGIC_LOGIN_FILE" \
    || { log "FATAL: plugin source missing TRANSIENT_PREFIX constant"; exit 2; }
  grep -q "magic_token_hash" "$MAGIC_LOGIN_FILE" \
    || { log "FATAL: plugin source missing magic_token_hash audit field"; exit 2; }
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "--activate-only" ]; then
  command -v npx >/dev/null || { log "FATAL: npx not on PATH"; exit 1; }
  cd "$REPO_ROOT"
  [ -f "$REPO_ROOT/.wp-env.json" ] \
    || { log "FATAL: repo-root .wp-env.json not found"; exit 3; }

  log "activating plugin via wp-env wp-cli"
  npx --yes @wordpress/env run tests-cli wp plugin activate ashbi-agency-wp-bridge
  npx --yes @wordpress/env run tests-cli wp option update ashbi_hub_url "$HUB_URL"
  npx --yes @wordpress/env run tests-cli wp option update ashbi_secret_key "$HUB_SECRET"
fi

log "plugin-setup phase done ($MODE)"
