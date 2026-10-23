# Ashbi workspace — private Cloudflare pilot

This is the deployable successor to the isolated local foundation proof. It uses verified Cloudflare Access JWTs and active D1 actors; there is no fixture-code login endpoint. It does not replace the current application or migrate production records.

## Local checks

`npm ci`, `npm test`, `npm run build` from this directory. Build is a dry-run only. `auth.test.mjs` verifies real RSA signatures and claims; `test.mjs` runs the application handler with real local D1 through Miniflare. This is not a hosted identity/MFA login test. Tests inject a signing key into the exported handler factory; the deployed default handler always uses Cloudflare's JWKS. Fixture identities are never configured in the hosted Worker.

Scope: clients, projects, tasks, plain text project documents, one timer per staff user, manual time and bounded record export. Staff records are organization scoped; clients are limited to own, deliberately shared projects and child records. Project visibility also gates children. All mutations require the same Origin and bounded input; edits require a revision. Lists paginate at 50 records; time shows the latest 100 own entries. No delete endpoint. The current UI supports create/list, task completion and time; the edit API does not imply a complete editing UI.

Finance/contract signing and private files are explicitly unavailable in the interface. R2 is disabled in the owning account and requires dashboard activation. No public bucket or alternative storage is substituted. Stripe credentials and webhook endpoint acceptance remain outstanding. No customers, invitations, charges or source imports are created by deployment.

## Access and recovery

Separate app at `ashbi-workspace.camster915391.workers.dev`; explicitly permit Cameron and Bianca's Ashbi addresses only. One-hour JWT/session maximum; verify issuer, audience, RS256 signature, expiry, issued time, subject and email. Check actor activity on every request; deactivate the actor to immediately remove app access. Do not grant a client by email domain or put JWTs in browser storage. Client activation requires explicit provisioning plus a reviewed Access policy, never a role from user input.

The Access app requires independent MFA. Organisation capability is enabled for TOTP/biometrics/security keys; global enforcement stays off so existing app policies are unchanged. Staff must enrol a device at the Access App Launcher. A retained enrolled backup security key and verified Cloudflare administrator recovery are required before real-data acceptance. Recover a lost device through the Cloudflare administrator process with verified ownership; never disable the app's policy to recover it. Local JWT tests do not prove successful human enrolment or account recovery.

## Data, deployment and rollback

A new D1 database is independent of the existing PostgreSQL application. Schema is additive in this new database; never replay it over existing data. No business data is seeded. Access actors are provisioned through an approved administrative operation. Runtime configuration stores only public identifiers. Tokens/secret keys do not belong here.

Deployment uses the reviewed dry-run bundle via the connected Cloudflare API. Keep workers.dev disabled until schema, actor mapping and Access policy are verified; disable version preview URLs. Production release metadata must record bundle SHA-256, source tree, Worker version and D1 ID. Enable observability at 10%, with invocation logs disabled and query strings redacted; app code never logs content or tokens. `/health` returns status and release only; Access may intercept it at the edge.

Rollback the isolated pilot by disabling its workers.dev route; preserve the D1 database and Access configuration for investigation. Do not roll back the existing Hub or restore exposed historical seed data. Export is limited to 1,000 records per table and explicitly refuses larger exports; it omits identities and does not include private objects. It is not a complete backup. D1 Time Travel/administrative export plus isolated restore rehearsal and R2 original-byte recovery remain release gates before real customer data/cutover. No source-system deletion or cancellation is authorised by this pilot.

Owner direction is now Cloudflare deployment. Existing Coolify configuration and held #684 remain unchanged; no main merge is needed for this isolated release.
