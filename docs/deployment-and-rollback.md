# Immutable deployment and rollback

Production has one deployment controller: the reviewed direct-VPS release
script at `scripts/deploy-vps-direct.sh`. GitHub Actions and Coolify do not
deploy production. Coolify may monitor the service, but it must not have an
automatic deployment webhook or mutate the production container.

Before upload, the operator runs the release gates, builds once with the full
Git revision, and records both the Docker image ID and archive SHA-256. The
same archive is uploaded to each environment. The VPS script verifies both
identifiers before starting anything, takes an exclusive deployment lock,
runs migration deployment plus status and ownership preflight checks, retains the prior API and worker containers,
and requires both the strict detailed readiness view
(`/api/health/details?strict=1`, read through `docker exec` inside the API
container) and the Redis-backed worker heartbeat to report the approved revision.
The strict view must also report healthy database, Redis, and worker
dependencies plus the approved image digest. Queue failures, a stale worker and
missing alert ownership are surfaced as a degraded state without incorrectly
taking an otherwise usable API offline.

The host must already contain its root-owned, mode-0600 environment file at
`/opt/ashbi-platform/.env`. Runtime data is bind-mounted from the corresponding
`data/uploads` and `data/config` directories.

Example release preparation from the reviewed checkout:

```bash
npm run check:release-gates
npm run lint && npm run typecheck && npm test && npm --prefix web test && npm run build
REVISION=$(git rev-parse HEAD)
IMAGE="ashbi-platform:deploy-${REVISION:0:7}"
ARCHIVE="ashbi-platform-${REVISION:0:7}.tar"
docker build --build-arg APP_REVISION="$REVISION" -t "$IMAGE" .
IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
docker save -o "$ARCHIVE" "$IMAGE"
ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | awk '{print $1}')
scp "$ARCHIVE" scripts/deploy-vps-direct.sh root@HOST:/opt/ashbi-platform/releases/
ssh root@HOST "bash /opt/ashbi-platform/releases/deploy-vps-direct.sh \
  --archive /opt/ashbi-platform/releases/$ARCHIVE \
  --archive-sha256 $ARCHIVE_SHA256 --image $IMAGE --image-id $IMAGE_ID \
  --revision $REVISION"
```

After the public route is switched, run the revision-aware synthetic check:

```bash
EXPECTED_REVISION="$REVISION" npm run smoke:production-health -- https://hub.ashbi.ca
```

See `docs/observability-and-slos.md` for ownership, alert drills, telemetry
data handling, and initial service objectives.

The script appends every deployment, readiness failure, and rollback to
`/opt/ashbi-platform/releases/history.tsv`. Upload archives may be deleted
after public verification because the immutable image and retained rollback
container remain on the host.

Use `--environment staging` or `--environment rehearsal` for non-production
records; the environment is included in every history outcome field.

## Health endpoints

| Endpoint | Access | Status code | Body |
| --- | --- | --- | --- |
| `GET /api/live` | public | 200 while the process serves HTTP; checks no dependency | `status`, `revision`, `timestamp` |
| `GET /api/health` | public | 200 when database **and** Redis are ok, else 503. A missing, stale or wrong-revision worker heartbeat keeps 200 with `status: "degraded"` | `ready`, `status`, `degraded`, `checks.{database,redis,worker}.status`, `revision`, `timestamp` |
| `GET /api/health?strict=1` | public | as above, but 503 unless the worker heartbeat is also ok | same public body |
| `GET /api/health/details[?strict=1]` | ADMIN/TEAM session, or a loopback caller inside the API container | same rules as `/api/health` (`strictReady` with `?strict=1`) | full report: failure details, `failedJobs`/`failedJobTotal`, backup and alerting state, `imageDigest`, `strictReady` |

- The Docker `HEALTHCHECK` probes `/api/live`: a database, Redis or worker
  outage should not make the runtime mark (and Traefik drop) an API container
  that can still answer requests. Restarting the API does not fix those
  dependencies.
- The public probe never exposes failed-job counts, failure messages, backup
  state or the image digest. The detailed view is for operators: sign in as
  staff, or on the host run
  `docker exec ashbi-platform wget -qO- 'http://127.0.0.1:3002/api/health/details?strict=1'`.
  Loopback access needs `HEALTH_DETAILS_LOOPBACK=true` (set only by the
  Dockerfile; development and host-level proxies never enable it), a loopback
  TCP peer judged from the raw socket (never `X-Forwarded-For`), and no
  forwarding headers (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, ...) on the
  request. Traefik and the published host port reach the container from a
  Docker network address, so only a process inside the container qualifies.
- `deploy-vps-direct.sh` gates on the strict detailed view (worker ok, exact
  revision and image digest). If that read fails (for example an operator
  rollback to an image built before `/api/health/details` existed, which
  answers 404), it falls back to the public `/api/health`. Those older images
  publish `imageDigest`, `worker` and `revision` there, so the same checks
  apply; current images keep `imageDigest` out of the public body, so the
  fallback cannot pass the gate for them. On a readiness failure the script
  prints the non-strict detailed and public health bodies before restoring
  the previous release (busybox `wget` prints nothing on a 503). The API
  container gets `--stop-timeout 30`, above the API's 10 s shutdown drain. `npm run smoke:production-health` gates on the
  public `/api/health?strict=1` (worker ok, exact revision); the digest is
  verified on the host by the deploy script.
- Uptime monitors should alert on `/api/health` 503 (API cannot reach its
  database or Redis) and separately on `status: "degraded"` (background jobs
  are delayed).

## Database connections and timeouts

The API and worker each hold a `pg` pool through the Prisma adapter.
`DATABASE_POOL_MAX` (default 10, clamped to 1–100) caps connections per
process; size it so `(API replicas + worker replicas) × DATABASE_POOL_MAX`
stays below the server's `max_connections` minus superuser and maintenance
headroom. `DATABASE_POOL_IDLE_TIMEOUT_MS` (default 30000) closes idle pool
connections and `DATABASE_POOL_CONNECT_TIMEOUT_MS` (default 5000) bounds
waiting for a new connection.

Statement and idle-transaction limits belong on the database role, not in
application code (Prisma migrations and long exports run through the same role
and the adapter cannot scope a per-query override safely). Recommended owner
action on production, run once as a superuser:

```sql
ALTER ROLE ashbihub SET statement_timeout = '30s';
ALTER ROLE ashbihub SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE ashbihub SET lock_timeout = '10s';
```

New sessions pick these up; restart the API and worker to recycle pooled
connections. Run `npx prisma migrate deploy` with a session override if a
future migration needs longer (for example
`PGOPTIONS='-c statement_timeout=0' npx prisma migrate deploy`).

`REQUEST_TIMEOUT_MS` (default 120000, clamped to 10s-15min) is Node's
`requestTimeout`: the time a client has to finish *sending* a request, which
closes slow-body connections. It does not cap handler time (the AI session has
its own 90s deadline), and it must stay long enough for 50 MB uploads on slow
links. Job enqueues fail within 5s with 503 `QUEUE_UNAVAILABLE` while Redis is
down instead of hanging the request.

## Process lifecycle

API (`src/server.js`) and worker (`src/jobs/worker.js`) share
`src/utils/process-lifecycle.js`:

- SIGTERM/SIGINT run one idempotent drain (API: HTTP, health Redis, queues,
  Prisma; worker: heartbeat, BullMQ workers, queues, Prisma), flush Sentry,
  then exit 0. A second signal joins the running drain. The drain is forced
  to exit after 10 s (API; container `--stop-timeout 30`) or 110 s (worker;
  `--stop-timeout 120`).
- `uncaughtException` is logged, reported to Sentry and exits 1 after the
  drain, so the container restarts instead of idling half-dead.
- `unhandledRejection` is logged, reported and counted
  (`process.unhandledRejections` in `/api/health/details`) but is **not fatal
  yet**: some fire-and-forget paths may still reject unobserved, and each would
  otherwise become an outage. Plan: fix what the counter and Sentry surface;
  once it stays at zero in production for two weeks, set
  `fatalUnhandledRejection: true` in `installProcessHandlers` so a rejection
  exits like an uncaught exception.

## API rate limits

The global `/api` limiter keys signed-in traffic (a verified staff or portal
session cookie/bearer token) by user id at `API_USER_RATE_LIMIT_MAX` requests
per minute (default 600, clamped to 100–5000), and anonymous traffic by client
IP at 100 per minute. Route-level limits (login, MFA, public intake, review
share links) keep their own keys. Counters live in Redis (`ashbi-rate-limit:*`
keys) when `REDIS_URL` is set, so all API replicas share them; tests and a
Redis-less development setup use the in-memory store. A Redis outage skips the
limiter rather than failing requests. The SPA treats a 429 from
`/api/auth/me` as "retry later" (keeps the session and shows a notice).

## Realtime across replicas (Socket.IO)

When `REDIS_URL` is set (always, in staging and production), every API
replica attaches the Socket.IO Redis adapter (`@socket.io/redis-adapter`,
`src/realtime/adapter.js`) on two dedicated reconnecting connections, so:

- a room emit (`user:<id>`, `project:<id>`, ...) reaches that room's sockets on
  every replica, whichever replica or process produced it;
- `io.in(room).fetchSockets()` (call signalling) returns sockets connected to
  other replicas, and `disconnectSockets()` drops them cluster-wide;
- the worker delivers the notifications it writes (notification queue jobs,
  SLA escalations, automations such as overdue invoices) live through the
  Redis emitter (`@socket.io/redis-emitter`, `src/realtime/emitter.js`), with
  the same `notification:new` / `notification` events as `fastify.notify`.
  Escalation rows are emitted only after their transaction commits.

There is no separate toggle. Without `REDIS_URL` (a Redis-less development
setup) and in tests, the API keeps the in-memory adapter (one instance) and
the emitter is a no-op; the web app's 30-second notification poll still shows
worker notifications. The web app connects over WebSocket first
(`transports: ['websocket', 'polling']`); a client that falls back to HTTP
long-polling needs sticky sessions at the proxy when more than one API
replica serves traffic, because the adapter shares rooms, not a polling
session's handshake.

A Redis outage delays realtime delivery (commands queue until Redis is back;
the rows are already persisted and the poll still shows them), and a
`fetchSockets()` that gets no reply from a replica in time drops that call
signal. Adding or removing API replicas needs no realtime configuration. The
channels use the adapter's default `socket.io` key prefix, so do not point
two unrelated deployments at the same Redis database.

## Client IP behind a proxy (`TRUST_PROXY`)

Production is reached through Traefik (`docker-compose.prod.yml`), so every
request arrives at the API from Traefik's address. Unless the API trusts that
one hop, `request.ip` is the proxy and **every per-IP rate limit is a single
bucket shared by all visitors**: login, two-factor, re-authentication, the
public intake form and the media review share-link routes. Audit IP prefixes
also record the proxy instead of the client.

`TRUST_PROXY` in `/opt/ashbi-platform/.env` sets how many proxy hops Fastify
trusts (`src/config/trust-proxy.js`):

| Value | Effect |
| --- | --- |
| unset, empty, `false`, `0` | Default. Trust no proxy; `request.ip` is the TCP peer (current behaviour). |
| `1` | **The value for the Traefik deployment.** Trust exactly one hop: the client address is the last `X-Forwarded-For` entry, the one Traefik appended. Entries a client sends itself are further left and are ignored. |
| `2`–`5` | Only if another proxy (CDN or load balancer) sits in front of Traefik and appends its own entry. |
| Addresses/CIDRs, comma-separated (e.g. `172.16.0.0/12`), or `loopback`, `linklocal`, `uniquelocal` | Stricter alternative: trust only peers on the proxy's network (the Docker network Traefik reaches the API through), then use the last untrusted `X-Forwarded-For` entry. |

Anything else (for example `true`, which would trust any client-supplied
`X-Forwarded-For`) is ignored with a startup warning, and no proxy is trusted.
Fastify refuses bare numeric hop counts because it cannot check that the peer
is really a proxy; a hop count here is applied as a trust function, so it is
only safe when the API port is reachable exclusively through Traefik.

Operator action: this change does not edit `docker-compose.prod.yml` or the
production environment. The owner sets `TRUST_PROXY=1` in the production
`.env` and redeploys, then checks that two clients on different networks no
longer share a login rate limit. Set it only when the API port is reachable
exclusively through Traefik; if the container port is also published to the
internet, a direct caller could forge `X-Forwarded-For`.

## Automated rollback test

The direct release script captures the prior API and worker containers plus
their immutable image metadata before replacement. Readiness succeeds only
when `/api/health/details?strict=1` (read inside the candidate container)
reports the expected full commit and image digest and
`npm run health:worker` sees a fresh heartbeat from that revision. A timeout
automatically restores both previous processes and fails the release.

Before enabling production promotion, rehearse this in staging:

1. Deploy a known-good digest and confirm it appears in `releases/history.tsv`.
2. Temporarily supply a test image whose health response has the wrong
   revision, or stop its application process.
3. Confirm the release command fails and the prior API and worker containers are restored.
4. Confirm the database and persistent upload/config directories are intact.
5. Save the release-history entries and resulting health response on issue
   #294 as the rehearsal record. Never induce this failure on the live
   production container; use an isolated staging container and port.

## Manual rollback

**Rollback floor.** Some migrations close a confidentiality gap that older
images do not know about. `20260927030000_chat_message_visibility` is one:
images that predate it serve every project chat message, internal ones
included, to client sessions. Once the release script applies such a
migration it records it in `$ROOT_DIR/releases/rollback-floor`, and from then
on it refuses to deploy an image that lacks it (`rollback_floor_blocked` in
`history.tsv`). The automatic rollback is refused as well and the release fails
closed, leaving the API down rather than serving the older image. Roll
forward with a fixed image instead. The floor list lives in
`ROLLBACK_FLOOR_MIGRATIONS` in `scripts/deploy-vps-direct.sh`.


Use the last known-good immutable image reference and image ID from
`$ROOT_DIR/releases/history.tsv`; never roll back with a mutable `main` or
`latest` tag. The release script automatically restores the retained previous
container when startup or readiness fails. For an operator-requested rollback,
rerun the script (the current version works with older artifacts; see
"Health endpoints") using the recorded previous artifact, revision, and image ID,
then verify both fields at `/api/health/details` (staff session, or
`docker exec ashbi-platform wget -qO- 'http://127.0.0.1:3002/api/health/details'`) and run `docker exec ashbi-platform-worker npm run health:worker`. Record the operator, timestamp,
source release, target image ID, reason, and verification result.
