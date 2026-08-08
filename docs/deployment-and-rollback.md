# Immutable deployment and rollback

Production has one deployment controller: the GitHub release-promotion
workflow using Docker over SSH. Coolify may monitor the service, but it must
not have an automatic deployment webhook or mutate the production container.

The pipeline runs the required release gates, publishes one multi-platform
GHCR manifest, deploys that exact `image@sha256:digest` to staging, verifies
the reported commit and digest, and only then promotes the identical reference
to the protected production environment. Concurrent releases queue instead of
cancelling a deployment midway.

Required environment secrets:

- staging: `STAGING_VPS_HOST`, `STAGING_VPS_SSH_KEY`
- production: `VPS_HOST`, `VPS_SSH_KEY`

Each host must already contain its root-owned, mode-0600 environment file:
`/opt/ashbi-platform-staging/.env` or `/opt/ashbi-platform/.env`. Runtime data
is bind-mounted from the corresponding `data/uploads` and `data/config`
directories. On the first managed deployment, data from the existing
container is copied into those persistent directories before replacement.

## Automated rollback test

The reusable deployment workflow captures the prior image, revision, and
digest before replacement. Readiness succeeds only when `/api/health` reports
the expected full commit and image digest. A timeout automatically recreates
the previous image with its previous revision metadata and fails the release.

Before enabling production promotion, rehearse this in staging:

1. Deploy a known-good digest and confirm it appears in `releases/history.tsv`.
2. Temporarily supply a test image whose health response has the wrong
   revision, or stop its application process.
3. Confirm the workflow fails and the prior container is restored.
4. Confirm the database and persistent upload/config directories are intact.
5. Save the failed workflow URL and the resulting health response on issue
   #294 as the rehearsal record.

## Manual rollback

Use the last known-good immutable image reference from
`$ROOT_DIR/releases/history.tsv`; never roll back with a mutable `main` or
`latest` tag. Re-run the reusable deployment procedure with that digest and
its recorded revision. If GitHub Actions is unavailable, an infrastructure
owner may run the equivalent `docker pull image@digest` and container restart
on the host, then verify both fields at `/api/health`. Record who performed the
rollback, timestamp, source release, target digest, reason, and verification
result in the incident and GitHub release record.
