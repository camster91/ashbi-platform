#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: deploy-vps-direct.sh \
  --archive PATH --archive-sha256 SHA256 --image IMAGE --image-id SHA256_ID \
  --revision GIT_SHA [--environment NAME] [--root-dir PATH] \
  [--container NAME] [--worker-container NAME] [--host-port PORT]

Runs on the VPS as root. The archive must already be present on the host.
EOF
}

ROOT_DIR=/opt/ashbi-platform
CONTAINER=ashbi-platform
WORKER_CONTAINER=ashbi-platform-worker
HOST_PORT=3002
NETWORK=ashbi-hub-src_default
ENVIRONMENT=production
ARCHIVE=
ARCHIVE_SHA256=
IMAGE=
IMAGE_ID=
REVISION=

while (($#)); do
  case "$1" in
    --archive) ARCHIVE=${2:-}; shift 2 ;;
    --archive-sha256) ARCHIVE_SHA256=${2:-}; shift 2 ;;
    --image) IMAGE=${2:-}; shift 2 ;;
    --image-id) IMAGE_ID=${2:-}; shift 2 ;;
    --revision) REVISION=${2:-}; shift 2 ;;
    --root-dir) ROOT_DIR=${2:-}; shift 2 ;;
    --container) CONTAINER=${2:-}; shift 2 ;;
    --worker-container) WORKER_CONTAINER=${2:-}; shift 2 ;;
    --host-port) HOST_PORT=${2:-}; shift 2 ;;
    --network) NETWORK=${2:-}; shift 2 ;;
    --environment) ENVIRONMENT=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "release error: $*" >&2; exit 1; }
record() {
  local outcome=$1 detail=${2:-}
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT:$outcome" "$REVISION" "$IMAGE" \
    "$IMAGE_ID" "$ARCHIVE_SHA256" "$detail" >> "$HISTORY"
}

[[ $(id -u) == 0 ]] || die 'must run as root'
[[ -d $ROOT_DIR ]] || die 'root directory not found'
[[ -f $ARCHIVE ]] || die 'release archive not found'
ROOT_DIR=$(realpath -e "$ROOT_DIR")
ARCHIVE=$(realpath -e "$ARCHIVE")
[[ $ROOT_DIR == /opt/* && $ROOT_DIR != /opt ]] || die 'root directory must be a child of /opt'
[[ $ARCHIVE == "$ROOT_DIR"/releases/* ]] || die 'archive must be inside the release directory'
[[ $REVISION =~ ^[0-9a-f]{40}$ ]] || die 'revision must be a full lowercase Git SHA'
[[ $ARCHIVE_SHA256 =~ ^[0-9a-f]{64}$ ]] || die 'archive checksum must be lowercase SHA-256'
[[ $IMAGE_ID =~ ^sha256:[0-9a-f]{64}$ ]] || die 'image ID must be an immutable sha256 identifier'
[[ $CONTAINER =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || die 'invalid container name'
[[ $WORKER_CONTAINER =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || die 'invalid worker container name'
[[ $WORKER_CONTAINER != "$CONTAINER" ]] || die 'worker container must differ from API container'
[[ $ENVIRONMENT =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || die 'invalid environment name'
[[ $HOST_PORT =~ ^[0-9]+$ ]] && ((HOST_PORT >= 1024 && HOST_PORT <= 65535)) || die 'invalid host port'
ENV_FILE="$ROOT_DIR/.env"
DATA_DIR="$ROOT_DIR/data"
RELEASE_DIR="$ROOT_DIR/releases"
HISTORY="$RELEASE_DIR/history.tsv"
LOCK_FILE="$RELEASE_DIR/deploy.lock"
[[ -f $ENV_FILE ]] || die 'environment file not found'
[[ $(stat -c '%a' "$ENV_FILE") == 600 ]] || die 'environment file must be mode 0600'
mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/config" "$RELEASE_DIR"
touch "$HISTORY" "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -n 9 || die 'another deployment is already running'

ACTUAL_ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')
[[ $ACTUAL_ARCHIVE_SHA256 == "$ARCHIVE_SHA256" ]] || die 'release archive checksum mismatch'
docker load -i "$ARCHIVE" >/dev/null
ACTUAL_IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
[[ $ACTUAL_IMAGE_ID == "$IMAGE_ID" ]] || die 'loaded image ID does not match the approved artifact'

docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" "$IMAGE" npx prisma migrate deploy
docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" "$IMAGE" npx prisma migrate status

PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)
PREVIOUS_REVISION=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null | sed -n 's/^APP_REVISION=//p' | tail -1 || true)
PREVIOUS_DIGEST=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null | sed -n 's/^APP_IMAGE_DIGEST=//p' | tail -1 || true)
PREVIOUS_WORKER_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$WORKER_CONTAINER" 2>/dev/null || true)
STAMP=$(date -u +%Y%m%d_%H%M%S_%N)
ROLLBACK_CONTAINER="$CONTAINER-rollback-$STAMP"
ROLLBACK_WORKER_CONTAINER="$WORKER_CONTAINER-rollback-$STAMP"
CUTOVER_STARTED=false

emergency_rollback() {
  local status=$?
  trap - EXIT
  if ((status != 0)) && [[ $CUTOVER_STARTED == true ]] && docker inspect "$ROLLBACK_CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker rm -f "$WORKER_CONTAINER" >/dev/null 2>&1 || true
    docker rename "$ROLLBACK_CONTAINER" "$CONTAINER" >/dev/null 2>&1 || true
    docker start "$CONTAINER" >/dev/null 2>&1 || true
    if docker inspect "$ROLLBACK_WORKER_CONTAINER" >/dev/null 2>&1; then
      docker rename "$ROLLBACK_WORKER_CONTAINER" "$WORKER_CONTAINER" >/dev/null 2>&1 || true
      docker start "$WORKER_CONTAINER" >/dev/null 2>&1 || true
    fi
    record emergency_rollback "previous=$PREVIOUS_IMAGE" || true
  fi
  exit "$status"
}

start_worker_container() {
  local name=$1 image=$2 revision=$3 digest=$4
  docker run -d --name "$name" --restart unless-stopped \
    --network "$NETWORK" \
    -v "$DATA_DIR/uploads:/app/uploads" \
    -v "$DATA_DIR/config:/app/config" \
    --env-file "$ENV_FILE" \
    -e APP_REVISION="$revision" -e APP_IMAGE_DIGEST="$digest" \
    --health-cmd 'npm run health:worker' --health-interval 15s \
    --health-timeout 5s --health-start-period 20s --health-retries 3 \
    --stop-timeout 120 \
    --label ashbi.release.managed=true --label ashbi.release.role=worker \
    "$image" npm run start:worker >/dev/null
}
trap emergency_rollback EXIT

start_container() {
  local name=$1 image=$2 revision=$3 digest=$4
  docker run -d --name "$name" --restart unless-stopped \
    --network "$NETWORK" \
    -p "127.0.0.1:${HOST_PORT}:3002" \
    -v "$DATA_DIR/uploads:/app/uploads" \
    -v "$DATA_DIR/config:/app/config" \
    --env-file "$ENV_FILE" \
    -e APP_REVISION="$revision" -e APP_IMAGE_DIGEST="$digest" \
    --label ashbi.release.managed=true \
    "$image" >/dev/null
}

restore_previous() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$WORKER_CONTAINER" >/dev/null 2>&1 || true
  if [[ -n $PREVIOUS_IMAGE ]]; then
    docker rename "$ROLLBACK_CONTAINER" "$CONTAINER"
    docker start "$CONTAINER" >/dev/null
    if [[ -n $PREVIOUS_WORKER_IMAGE ]] && docker inspect "$ROLLBACK_WORKER_CONTAINER" >/dev/null 2>&1; then
      docker rename "$ROLLBACK_WORKER_CONTAINER" "$WORKER_CONTAINER"
      docker start "$WORKER_CONTAINER" >/dev/null
    fi
    for _ in $(seq 1 30); do
      body=$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/health" || true)
      worker_restored=true
      if [[ -n $PREVIOUS_WORKER_IMAGE ]]; then
        worker_health=$(docker exec "$WORKER_CONTAINER" npm run --silent health:worker 2>/dev/null || true)
        [[ -n $worker_health ]] && { [[ -z $PREVIOUS_REVISION ]] || [[ $worker_health == *"\"revision\":\"$PREVIOUS_REVISION\""* ]]; } || worker_restored=false
      fi
      if [[ -n $body ]] && [[ $worker_restored == true ]] && { [[ -z $PREVIOUS_REVISION ]] || [[ $body == *"\"revision\":\"$PREVIOUS_REVISION\""* ]]; }; then
        record rollback "restored=$PREVIOUS_IMAGE"
        CUTOVER_STARTED=false
        return 0
      fi
      sleep 2
    done
  fi
  record rollback_failed "previous=$PREVIOUS_IMAGE"
  return 1
}

if [[ -n $PREVIOUS_IMAGE ]]; then
  docker rename "$CONTAINER" "$ROLLBACK_CONTAINER"
  CUTOVER_STARTED=true
  docker stop "$ROLLBACK_CONTAINER" >/dev/null
fi
if [[ -n $PREVIOUS_WORKER_IMAGE ]]; then
  docker rename "$WORKER_CONTAINER" "$ROLLBACK_WORKER_CONTAINER"
  docker stop --time 120 "$ROLLBACK_WORKER_CONTAINER" >/dev/null
fi

if ! start_container "$CONTAINER" "$IMAGE" "$REVISION" "$IMAGE_ID"; then
  record start_failed "previous=$PREVIOUS_IMAGE"
  restore_previous || true
  die 'candidate container failed to start'
fi
if ! start_worker_container "$WORKER_CONTAINER" "$IMAGE" "$REVISION" "$IMAGE_ID"; then
  record worker_start_failed "previous=$PREVIOUS_WORKER_IMAGE"
  restore_previous || true
  die 'candidate worker container failed to start'
fi

READY=false
for _ in $(seq 1 30); do
  BODY=$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/health" || true)
  WORKER_HEALTH=$(docker exec "$WORKER_CONTAINER" npm run --silent health:worker 2>/dev/null || true)
  if [[ $BODY == *"\"ready\":true"* \
    && $BODY == *"\"database\":{\"status\":\"ok\"}"* \
    && $BODY == *"\"redis\":{\"status\":\"ok\"}"* \
    && $BODY == *"\"worker\":{\"status\":\"ok\""* \
    && $BODY == *"\"revision\":\"$REVISION\""* \
    && $BODY == *"\"imageDigest\":\"$IMAGE_ID\""* \
    && $WORKER_HEALTH == *"\"revision\":\"$REVISION\""* ]]; then
    READY=true
    break
  fi
  sleep 5
done

if [[ $READY != true ]]; then
  record readiness_failed "previous=$PREVIOUS_IMAGE"
  restore_previous || die 'candidate failed readiness and rollback also failed'
  die 'candidate failed revision-aware readiness; previous release restored'
fi

RETAINED_ROLLBACK=${PREVIOUS_IMAGE:+$ROLLBACK_CONTAINER}
RETAINED_WORKER_ROLLBACK=${PREVIOUS_WORKER_IMAGE:+$ROLLBACK_WORKER_CONTAINER}
record deployed "rollback=${RETAINED_ROLLBACK:-none};worker_rollback=${RETAINED_WORKER_ROLLBACK:-none};previous_digest=$PREVIOUS_DIGEST"
CUTOVER_STARTED=false
echo "deployed revision $REVISION as $IMAGE_ID; API rollback: ${RETAINED_ROLLBACK:-none}; worker rollback: ${RETAINED_WORKER_ROLLBACK:-none}"
