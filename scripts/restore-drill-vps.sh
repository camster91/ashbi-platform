#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'Usage: restore-drill-vps.sh --archive PATH --identity PATH' >&2; }
ARCHIVE=
IDENTITY=
RESTORE_IMAGE=${ASHBI_RESTORE_IMAGE:-pgvector/pgvector:pg16}
while (($#)); do
  case "$1" in
    --archive) ARCHIVE=${2:-}; shift 2 ;;
    --identity) IDENTITY=${2:-}; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

die() { printf 'restore drill error: %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || die 'must run as root'
[[ $ARCHIVE == /opt/ashbi-platform/backups/encrypted/*.tar.age && -f $ARCHIVE ]] || die 'archive must be an encrypted Ashbi backup'
[[ -f $IDENTITY && $(stat -c %a "$IDENTITY") == 600 ]] || die 'identity must exist with mode 0600'
for command in age docker sha256sum tar; do command -v "$command" >/dev/null || die "missing command: $command"; done

stamp=$(date -u +%Y%m%d_%H%M%S)
container="ashbi-restore-drill-$stamp"
work=$(mktemp -d /opt/ashbi-platform/backups/.restore-drill-XXXXXX)
password=$(openssl rand -hex 24)
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT
chmod 0700 "$work"

age --decrypt --identity "$IDENTITY" "$ARCHIVE" | tar -C "$work" -xf -
(cd "$work" && sha256sum --check manifest.sha256)
pg_restore -l "$work/database.dump" >/dev/null
[[ -f $work/runtime/environment && -d $work/runtime/data ]] || die 'configuration or persistent data is absent'
[[ $(stat -c %a "$work/runtime/environment") == 600 ]] || die 'restored environment permissions are unsafe'

docker run -d --name "$container" --network none --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1g \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=ashbi_restore "$RESTORE_IMAGE" >/dev/null
stable_ready_count=0
for _ in $(seq 1 90); do
  if docker exec "$container" pg_isready -U postgres -d ashbi_restore >/dev/null 2>&1; then
    stable_ready_count=$((stable_ready_count + 1))
    ((stable_ready_count >= 3)) && break
  else
    # The official image briefly starts and stops an initialization server.
    # Reset the streak so that transient readiness cannot pass the drill.
    stable_ready_count=0
  fi
  sleep 1
done
((stable_ready_count >= 3)) || die 'isolated PostgreSQL did not become stably ready'
docker cp "$work/database.dump" "$container:/tmp/database.dump" >/dev/null
docker exec "$container" pg_restore -U postgres -d ashbi_restore --no-owner --no-acl /tmp/database.dump

# Prove schema readability and record representative domain counts without
# printing tenant content or identifiers.
counts=$(docker exec "$container" psql -U postgres -d ashbi_restore -At -v ON_ERROR_STOP=1 -c \
  "SELECT json_build_object('organizations',(SELECT count(*) FROM organizations),'users',(SELECT count(*) FROM users),'clients',(SELECT count(*) FROM clients),'projects',(SELECT count(*) FROM projects),'invoices',(SELECT count(*) FROM invoices),'notes',(SELECT count(*) FROM internal_notes),'attachments',(SELECT count(*) FROM attachments));")
completed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"status":"passed","completedAt":"%s","archive":"%s","counts":%s,"isolation":"network-none,tmpfs"}\n' \
  "$completed" "$(basename "$ARCHIVE")" "$counts"
