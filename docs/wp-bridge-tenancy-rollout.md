# WordPress bridge tenancy rollout

Every WordPress bridge table has required organization ownership. Human reads
use the organization in the verified JWT. Plugin writes derive ownership from
the provisioned site's encrypted credential and never trust caller-provided
organization headers.

Production rollout:

1. Back up the production database and apply the staged migration.
2. Run `npm run audit:wp-bridge-ownership`. Exit status 2 means manual mapping
   remains. Assign every listed site to the correct organization and rerun
   until every `unowned` count is zero.
3. In the authenticated WordPress Sites screen, provision the site URL under
   the current organization. Copy the one-time credential into that site's
   plugin settings; the hub stores only AES-GCM ciphertext.
4. Deploy a plugin version that signs the exact raw body as
   `timestamp.nonce.rawBody`, with `X-Ashbi-Timestamp`, `X-Ashbi-Nonce`, and
   `X-Ashbi-Signature: sha256=...` headers.
5. Smoke-test health, backup, report, alert, and hours writes for two sites in
   different organizations. Confirm a wrong-site signature and reused nonce
   both return 401.
6. Remove the fleet-wide write secret from all plugins and rotate it after the
   final site is migrated.
7. Retain the database backup until the post-rollout audit and restore drill
   are complete.
