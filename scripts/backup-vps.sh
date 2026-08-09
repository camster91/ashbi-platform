#!/usr/bin/env bash
set -Eeuo pipefail

# Root-only, fail-closed production backup for the direct-VPS deployment.
# The age recipient file contains public material only. The matching identity
# must not be readable by either application container.

ROOT_DIR=${ASHBI_ROOT_DIR:-/opt/ashbi-platform}
BACKUP_DIR=${ASHBI_BACKUP_DIR:-$ROOT_DIR/backups/encrypted}
RECIPIENT_FILE=${ASHBI_BACKUP_RECIPIENT_FILE:-/etc/ashbi-backup/recipients.txt}
POSTGRES_CONTAINER=${ASHBI_POSTGRES_CONTAINER:-ashbi-hub-postgres}
DATABASE_NAME=${ASHBI_DATABASE_NAME:-ashbihub}
DATABASE_USER=${ASHBI_DATABASE_USER:-ashbihub}
RETENTION_DAYS=${ASHBI_BACKUP_RETENTION_DAYS:-30}
STATUS_FILE=${ASHBI_BACKUP_STATUS_FILE:-$ROOT_DIR/data/config/backup-status.json}

die() { printf 'backup error: %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || die 'must run as root'
[[ $ROOT_DIR == /opt/* && $ROOT_DIR != /opt ]] || die 'root directory must be a child of /opt'
[[ $BACKUP_DIR == "$ROOT_DIR"/backups/* ]] || die 'backup directory must be below the application backup directory'
[[ $RETENTION_DAYS =~ ^[0-9]+$ ]] && ((RETENTION_DAYS >= 7 && RETENTION_DAYS <= 365)) || die 'retention must be 7-365 days'
[[ -s $RECIPIENT_FILE ]] || die "age recipient file is missing or empty: $RECIPIENT_FILE"
[[ -f $ROOT_DIR/.env && -d $ROOT_DIR/data ]] || die 'runtime configuration or persistent data directory is missing'
[[ $STATUS_FILE == "$ROOT_DIR"/data/config/* ]] || die 'status file must be inside the mounted configuration directory'
for command in age docker pg_restore sha256sum tar flock; do command -v "$command" >/dev/null || die "missing command: $command"; done
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || die 'PostgreSQL container is unavailable'

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$STATUS_FILE")"
chmod 0700 "$ROOT_DIR/backups" "$BACKUP_DIR"
exec 9>"$ROOT_DIR/backups/backup.lock"
flock -n 9 || die 'another backup is already running'

started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
stamp=$(date -u +%Y%m%d_%H%M%S)
revision=$(docker inspect ashbi-platform --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^APP_REVISION=//p' | head -1)
revision=${revision:-unknown}
work=$(mktemp -d "$ROOT_DIR/backups/.work-${stamp}-XXXXXX")
archive="$BACKUP_DIR/ashbi-full-${stamp}-${revision:0:7}.tar.age"
status_tmp="$STATUS_FILE.tmp"
trap 'rm -rf -- "$work" "$status_tmp"; rm -f -- "$archive.tmp"' EXIT

chmod 0700 "$work"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DATABASE_USER" -d "$DATABASE_NAME" --format=custom --no-owner --no-acl > "$work/database.dump"
[[ -s $work/database.dump ]] || die 'database dump is empty'
pg_restore -l "$work/database.dump" >/dev/null || die 'database dump catalog is invalid'

mkdir "$work/runtime"
cp -a "$ROOT_DIR/data" "$work/runtime/data"
install -m 0600 "$ROOT_DIR/.env" "$work/runtime/environment"
printf '%s\n' "$revision" > "$work/revision.txt"
printf '%s\n' "$started" > "$work/created-at.txt"
(cd "$work" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256)

tar -C "$work" -cf - . | age --encrypt --recipients-file "$RECIPIENT_FILE" -o "$archive.tmp"
[[ -s $archive.tmp ]] || die 'encrypted archive is empty'
chmod 0600 "$archive.tmp"
mv "$archive.tmp" "$archive"

completed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
bytes=$(stat -c %s "$archive")
sha256=$(sha256sum "$archive" | awk '{print $1}')
printf '{"status":"ok","startedAt":"%s","completedAt":"%s","revision":"%s","archive":"%s","bytes":%s,"sha256":"%s","retentionDays":%s}\n' \
  "$started" "$completed" "$revision" "$(basename "$archive")" "$bytes" "$sha256" "$RETENTION_DAYS" > "$status_tmp"
chmod 0600 "$status_tmp"
mv "$status_tmp" "$STATUS_FILE"

# Delete only successfully named encrypted archives after a new archive exists.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ashbi-full-????????_??????-???????.tar.age' -mtime "+$RETENTION_DAYS" -delete
printf 'BACKUP_ARCHIVE=%s\nBACKUP_SHA256=%s\nBACKUP_BYTES=%s\n' "$archive" "$sha256" "$bytes"
