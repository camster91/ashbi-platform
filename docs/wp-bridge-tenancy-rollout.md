# WordPress bridge tenancy rollout

The staged migration adds organization ownership to every WordPress bridge
table without guessing ownership for orphaned production rows. It backfills
sites through their client or project, then propagates that ownership to
backups, reports, alerts, support hours, fleet operations, and magic-login
logs. Nullable ownership is temporary: tenant-scoped reads exclude unmapped
rows until an operator resolves them.

Before enabling per-site signed writes:

1. Back up the production database and apply the staged migration.
2. Run `npm run audit:wp-bridge-ownership`. Exit status 2 means manual mapping
   remains. Assign every listed site to the correct organization and rerun
   until every `unowned` count is zero.
3. Deploy a plugin version that signs the exact raw body as
   `timestamp.nonce.rawBody`, with `X-Ashbi-Timestamp`, `X-Ashbi-Nonce`, and
   `X-Ashbi-Signature: sha256=...` headers.
4. Provision and store a distinct random credential for each site. The hub
   stores only AES-GCM ciphertext protected by `CREDENTIALS_KEY`.
5. Smoke-test health, backup, report, alert, and hours writes for two sites in
   different organizations. Confirm a wrong-site signature and reused nonce
   both return 401.
6. Remove the fleet-wide write secret from all plugins and rotate it after the
   final site is migrated.
7. Only after the audit is clean, add a follow-up migration making every
   bridge `organizationId` and each site credential non-null.

The current foundation deliberately does not infer ownership from caller
headers. Organization identity comes from stored site ownership, while human
reads use the organization in the verified JWT.
