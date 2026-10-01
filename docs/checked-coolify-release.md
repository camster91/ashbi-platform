# Checked Coolify release adoption

Production still uses `scripts/deploy-vps-direct.sh`. Merging this preparation
does not transfer deployment ownership. `COOLIFY_RELEASE_ENABLED` must remain
unset or false until the adoption below is verified and recorded in
`deployment-and-rollback.md`.

The workflow releases only successful `Required release gates` runs from a
same-repository push to the current default branch `main`. PR and manually
dispatched checks cannot release. Releases serialize, skip superseded SHAs,
pin the exact CI SHA, validate the resource again, await the matching Coolify
deployment and check `https://hub.ashbi.ca/api/health?strict=1`. PostgreSQL,
Redis and the same-revision worker must all report healthy. HTTP 200 alone
does not approve a release. Public probes never carry the Coolify token.

## Adoption checklist

1. Preserve the live API/worker revision, immutable image IDs, rollback floor,
   release history and current direct-controller configuration. Keep one
   production owner throughout the transfer.
2. Restore a current database, uploads and configuration backup into an
   isolated environment. Test migrations and relevant authenticated workflows
   there; prove off-server recovery. Preserve `JWT_SECRET` and
   `CREDENTIALS_KEY` when copying existing production data. Do not create an
   empty production database or rotate these keys as part of adoption.
3. Configure a Coolify Docker Compose application for
   `camster91/ashbi-platform`, `main`, `/docker-compose.coolify-production.yml`, with
   source-commit build metadata enabled and direct Git auto-deploy disabled.
   Reconcile routing with the existing Traefik owner before cutover. The API
   service `app` must own `https://hub.ashbi.ca` with port override 3002;
   the worker, migration runner and stores have no public route.
   This production file runs only API, worker and migrations. It joins the
   existing external `ashbi-hub-src_default` network, uses the preserved
   `DATABASE_URL` and `REDIS_URL`, and binds the existing
   `/opt/ashbi-platform/data/uploads` and `data/config` directories. It does
   not create a database, Redis instance or empty data volumes. The five-service
   `docker-compose.coolify.yml` remains for isolated staging/new installations.
   Verify both connection URLs against the live containers before configuration.
   Preserve an unset `ADMIN_INVITE_TOKEN`; adoption must not enable bootstrap
   registration. Fill missing link origins with the existing effective
   `https://hub.ashbi.ca` origin, and preserve any explicitly configured values.
   Stop the old worker during the handoff before the new worker starts; their
   shared Redis heartbeat cannot represent two source revisions simultaneously.
4. Rehearse database/upload/configuration backups and rollback for this exact
   resource. Configure a fail-closed pre-deployment backup hook before
   automated migrations; the direct script's backup and rollback-floor
   protections do not transfer automatically to Compose. Verify its behavior
   on both successful and failed backup attempts. Keep provider test/sending
   restrictions from the live environment. Coolify Compose migrations can
   cause downtime, and failed migrations can leave services unavailable.
   Coolify's built-in pre-deployment command skips when no application container
   is running, so that command alone cannot enforce a backup before the first
   adoption or after an outage. The release controller must verify a successful
   fresh backup before queueing a deployment, including those cases.
5. Confirm existing `production` GitHub environment policy. Configure
   `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_APP_UUID` securely; existing secret
   names do not prove correct values. Use the normal authorized Coolify API,
   never database edits to create access or alter resources.
6. Perform and verify the first cutover: exact serving SHA, strict readiness,
   API/worker parity, sign-in, files and representative workflows. Record the
   controller transfer and retained rollback procedure in the deployment
   runbook. Stop using the direct controller for normal releases.
7. Set `COOLIFY_RELEASE_ENABLED=true` only after these gates pass. Confirm the
   next checked merge deploys automatically and no competing trigger fires.

This adoption iteration builds the pinned source in Coolify. It does not
promote the byte-identical CI-built image. Immutable registry-image promotion
for API, worker and migration runner remains a follow-up. No database restore
or migration reversal is automated on failure: inspect the specific release,
preserve writes, and use the rehearsed rollback/fix-forward procedure.
