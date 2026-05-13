#!/bin/bash
# Database backup script for ashbi-platform
# Dumps the PostgreSQL database specified in DATABASE_URL to a timestamped file.
#
# Usage:
#   ./scripts/db-backup.sh                    # uses .env in project root
#   DATABASE_URL=postgresql://... ./scripts/db-backup.sh  # explicit URL
#
# Exit codes:
#   0 - backup succeeded
#   1 - .env not found and no DATABASE_URL set
#   2 - pg_dump failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Determine DATABASE_URL — prefer explicit env var, fall back to .env
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f "$PROJECT_ROOT/.env" ]; then
    # shellcheck disable=SC1091
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
    DB_URL="${DATABASE_URL:-}"
  else
    echo "ERROR: No DATABASE_URL set and no .env found at $PROJECT_ROOT/.env" >&2
    exit 1
  fi
else
  DB_URL="$DATABASE_URL"
fi

if [ -z "${DB_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is empty after resolution" >&2
  exit 1
fi

# Create backup directory
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
mkdir -p "$BACKUP_DIR"

# Timestamped filename
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S_UTC)"
BACKUP_FILE="$BACKUP_DIR/ashbi-db-$TIMESTAMP.sql"
ARCHIVE_FILE="$BACKUP_FILE.gz"

echo "Backing up database to $BACKUP_FILE ..."

# Dump and compress
pg_dump --no-owner --no-acl "$DB_URL" > "$BACKUP_FILE"
gzip -f "$BACKUP_FILE"

echo "Backup complete: $ARCHIVE_FILE ($(du -h "$ARCHIVE_FILE" | cut -f1))"

# Print the raw file path (useful for GitHub Actions or other automation)
echo "BACKUP_PATH=$ARCHIVE_FILE"
