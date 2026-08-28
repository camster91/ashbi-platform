# Isolated migration sandbox deployment

## Boundary

This procedure prepares a private rehearsal target for verified Notion and Bonsai imports. It does not change production, publish a DNS route, configure live Stripe, cancel Bonsai, or authorize migration. The committed compose file contains only dedicated PostgreSQL and Redis services. Neither datastore has a host port, every volume and network has a migration-sandbox name, and the application is deployed separately on loopback port `13002`.

Do not reuse `/opt/ashbi-platform`, the production containers, production database/Redis, the production Docker network, or any production secret. Initial browser access is through an SSH tunnel. A public sandbox hostname, reverse-proxy route, provider webhook, or DNS change is a separate action-time approval.

## Prepare the isolated data stack

On the VPS, resolve and verify the exact new root before creating it:

```text
mkdir -p /opt/ashbi-platform-migration-sandbox/releases /opt/ashbi-platform-migration-sandbox/data/uploads /opt/ashbi-platform-migration-sandbox/data/config
```

Copy `docker-compose.migration-sandbox.yml` and the reviewed environment derived from `docs/migration-sandbox.env.example` into that root. Replace all required placeholders with newly generated sandbox-only values, keep `ASHBI_SANDBOX_ORGANIZATION_ID`, backup, approval, and provider fields blank initially, then set owner-only permissions:

```text
chmod 0600 /opt/ashbi-platform-migration-sandbox/.env
npm run check:migration-sandbox-infrastructure
docker compose --env-file /opt/ashbi-platform-migration-sandbox/.env -f /opt/ashbi-platform-migration-sandbox/docker-compose.migration-sandbox.yml config
docker compose --env-file /opt/ashbi-platform-migration-sandbox/.env -f /opt/ashbi-platform-migration-sandbox/docker-compose.migration-sandbox.yml up -d
```

Verify the network is exactly `ashbi-migration-sandbox`, both volumes have the `ashbi-migration-sandbox-` prefix, both services are healthy, and neither container publishes a port. Retain the redacted compose config, container/image IDs, volume names, network ID, health output, and a database backup reference.

## Deploy one immutable application artifact

Build and checksum the same reviewed image/archive process documented in [deployment-and-rollback.md](deployment-and-rollback.md). Copy the archive and deployment script into the new release directory. After recording Cameron's sandbox deployment approval in the owner-only environment, deploy with every isolation override explicit:

```text
bash /opt/ashbi-platform-migration-sandbox/releases/deploy-vps-direct.sh \
  --archive /opt/ashbi-platform-migration-sandbox/releases/<archive.tar> \
  --archive-sha256 <sha256> --image <immutable-image> --image-id <sha256:image-id> \
  --revision <full-git-sha> --environment migration-sandbox \
  --root-dir /opt/ashbi-platform-migration-sandbox \
  --container ashbi-platform-migration-sandbox \
  --worker-container ashbi-platform-migration-sandbox-worker \
  --host-port 13002 --network ashbi-migration-sandbox
```

The deployment script applies and checks migrations on the sandbox database, starts distinct API/worker containers, binds the API only to `127.0.0.1:13002`, validates revision/image/database/Redis/worker health, and retains a sandbox-only rollback container. It never changes the production route or container names when the exact overrides above are used.

The controller also fails closed before loading the image unless `--environment migration-sandbox` is paired with the exact sandbox root, API container, worker container, port, and network above. Conversely, those sandbox root/container/network identities are rejected under any other environment label. The runbook and executable controller are checked together by `npm run check:migration-sandbox-infrastructure`.

## Private validation and evidence

Open a tunnel from Cameron's workstation and use `http://localhost:13002`:

```text
ssh -L 13002:127.0.0.1:13002 coolify
```

Run `npm run check:sandbox-readiness` and `npm run check:migration-sandbox-target -- --organization-id <id>` inside the deployed application environment. The first migration-only phase is expected to keep provider checks pending. Bootstrap and replay the synthetic workspace only after the exact backup and approval references are present. Then perform dry-run imports, review, confirmed sandbox imports, fresh inventories, and reconciliation in the documented order.

Do not expose the sandbox publicly or configure Stripe/Mailgun until the migration-only rehearsal is healthy and Cameron separately approves the restricted provider-sandbox route. Bonsai remains available throughout the later parallel run and cannot be retired without the complete cutover manifest and Cameron's final post-evidence financial approval.
