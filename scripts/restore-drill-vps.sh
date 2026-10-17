#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo 'Usage: restore-drill-vps.sh --archive PATH --identity PATH' >&2; }
ARCHIVE=
IDENTITY=
RESTORE_IMAGE=${ASHBI_RESTORE_IMAGE:-pgvector/pgvector@sha256:2358fcba361ed2233a5ed81b5fe4ca779ccb304120ce531a3bf51c0ed7e2bc11}
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
[[ -f $work/runtime/environment && -d $work/runtime/data ]] || die 'configuration or persistent data is absent'
[[ $(stat -c %a "$work/runtime/environment") == 600 ]] || die 'restored environment permissions are unsafe'

# An explicit legacy PG16 image remains supported for PG16 archives. Inspect
# the selected binary instead of guessing its major from a mutable tag.
restore_version=$(docker run --rm --network none --entrypoint postgres "$RESTORE_IMAGE" --version)
[[ $restore_version =~ PostgreSQL\)\ (16|18)\. ]] || die 'restore image must provide PostgreSQL 16 or 18'
restore_major=${BASH_REMATCH[1]}
if [[ $restore_major == 16 ]]; then
  restore_pgdata=/var/lib/postgresql/data
  restore_tmpfs=/var/lib/postgresql/data
else
  restore_pgdata=/var/lib/postgresql/18/docker
  restore_tmpfs=/var/lib/postgresql
fi
docker run -d --name "$container" --network none --tmpfs "$restore_tmpfs:rw,noexec,nosuid,size=1g" \
  -e PGDATA="$restore_pgdata" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=ashbi_restore "$RESTORE_IMAGE" >/dev/null
stable_ready_count=0
for _ in $(seq 1 90); do
  if docker exec "$container" sh -ec 'test "$(head -n 1 "$PGDATA/postmaster.pid")" = 1; exec pg_isready -h 127.0.0.1 -U postgres -d ashbi_restore' >/dev/null 2>&1; then
    stable_ready_count=$((stable_ready_count + 1))
    ((stable_ready_count >= 3)) && break
  else
    # The socket-only initialization server may stay ready for several seconds.
    # Require the final PID1 postmaster and TCP readiness, then a stable streak.
    stable_ready_count=0
  fi
  sleep 1
done
((stable_ready_count >= 3)) || die 'isolated PostgreSQL did not become stably ready'
# The selected engine must first accept the catalog: a PG18 dump offered to a
# legacy PG16 override fails before any database restore is attempted.
docker exec -i "$container" pg_restore -l < "$work/database.dump" >/dev/null 2>&1 || die 'selected restore engine cannot read the dump catalog'
docker exec -i "$container" pg_restore -U postgres -d ashbi_restore --no-owner --no-acl --exit-on-error --single-transaction < "$work/database.dump" >/dev/null 2>&1 || die 'isolated database restore failed'

# Prove schema readability and record representative domain counts without
# printing tenant content or identifiers.
counts=$(docker exec "$container" psql -U postgres -d ashbi_restore -At -v ON_ERROR_STOP=1 -c \
  "SELECT json_build_object('organizations',(SELECT count(*) FROM organizations),'users',(SELECT count(*) FROM users),'clients',(SELECT count(*) FROM clients),'projects',(SELECT count(*) FROM projects),'invoices',(SELECT count(*) FROM invoices),'notes',(SELECT count(*) FROM internal_notes),'attachments',(SELECT count(*) FROM attachments));")
completed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"status":"passed","completedAt":"%s","archive":"%s","counts":%s,"isolation":"network-none,tmpfs"}\n' \
  "$completed" "$(basename "$ARCHIVE")" "$counts"
