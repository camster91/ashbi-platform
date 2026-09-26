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
and requires both `/api/health` and the Redis-backed worker heartbeat to report the approved revision.
The readiness response must also report healthy database, Redis, and worker
dependencies. Queue failures and missing alert ownership are surfaced as a
degraded state without incorrectly taking an otherwise usable API offline.

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
when `/api/health` reports the expected full commit and image digest and
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

Use the last known-good immutable image reference and image ID from
`$ROOT_DIR/releases/history.tsv`; never roll back with a mutable `main` or
`latest` tag. The release script automatically restores the retained previous
container when startup or readiness fails. For an operator-requested rollback,
rerun the script using the recorded previous artifact, revision, and image ID,
then verify both fields at `/api/health` and run `docker exec ashbi-platform-worker npm run health:worker`. Record the operator, timestamp,
source release, target image ID, reason, and verification result.
