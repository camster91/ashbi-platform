# Isolated workspace recovery rehearsal

This is a **source-level synthetic rehearsal**, not an operated backup service, hosted restore, production runbook approval or proof that issue #282 is complete. Existing systems remain the fallback. No new application backup endpoint is introduced; the staff JSON export remains bounded and redacted.

From `apps/workspace`, with locked dependencies installed:

```sh
npm run test:recovery
npm run build
npm run test:recovery-built
```

Both recovery commands create fresh temporary source and target configurations with fixed dummy D1/R2 names. `getPlatformProxy` uses explicit configuration and persistence paths, no env files, and `remoteBindings:false`. Child Wrangler commands inherit only OS/path variables, disable metrics and always specify `--local`. The real workspace configuration, real credentials, hosted database and bucket are not used. Temporary SQL, checkpoint and signing-key files contain synthetic data only. Their paths live under the operating-system temporary directory; the tests do not recursively remove arbitrary directories.

## What is exercised

The joined fixture uses signed identities and the actual application routes: canonical client/project/task, shared/private notes and original files, document revision/comment, a running timer, approved reserved time, a client-approved proposal, a related typed-signed contract with JSON/PDF evidence, native invoice draft and reviewed issuance. The HTTP provider is an injected test fixture, not Stripe's network sandbox. It remains alive independently of both application stores.

The checkpoint contains every application table and explicit schema definition, including identities and finance grants, source claims, request keys/receipts, cancellation tombstones, history, journals and active leases. All R2 objects are inventoried through `truncated`/cursor pagination, including staged orphans and zero-length data. Original bytes, lengths, independent SHA-256 values and HTTP/custom metadata are serialized and restored. HTTP expiry dates are rehydrated; original service-generated R2 upload timestamps, versions and ETags are not restored or represented as original.

Historical signing keys are written and read separately from the database/object checkpoint. This tests application recovery with retained synthetic keys; it does not implement secret backup, encryption, key custody or production access separation.

Native schema and data SQL are exported separately from the same stopped source storage. A combined native dump failed this schema's real import because explicit parent unique indexes appeared after child INSERTs (`task_comments` referencing `actors`). The rehearsal installs the complete native schema, including those indexes, into a fresh empty target before importing native data. It does not split exported SQL on semicolons, rewrite JSON, rerun data-backfilling migrations, disable foreign keys or drop constraints.

Before restored application use, all 60 current tables and 45 explicit indexes, all rows/fields and exact JSON text must equal the trusted source image. D1's supported `PRAGMA quick_check` and `PRAGMA foreign_key_check` must pass. The separate literal-data probe covers more than 100 rows, NULL/zero, Unicode, quotes, embedded semicolons/newlines and the largest safe JavaScript integer. Unsafe numeric images are rejected rather than accepted after number rounding. See [D1 SQL checks](https://developers.cloudflare.com/d1/sql-api/sql-statements/) and [native import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Fault checks remove cancellation records, an empty table, a unique index and required signature/PDF/issuance/delivery journals; delete/corrupt object bytes and metadata; and remove/substitute historical signing keys. The independent image comparison rejects missing complete records that the application could not otherwise distinguish from never-existing records. Retained evidence rows with missing required objects, keys or journals fail closed through application routes. No damaged image is accepted as a valid checkpoint.

After complete restoration, authenticated reads verify exact original file and signed JSON/PDF bytes, own-client scope, other-client/foreign-staff denial, both staff identities, private records, the active timer, revoked financial access, inactive actors and changed project visibility. Cancelled delayed requests remain cancelled; approved source time cannot be billed again. Completed native receipts do not POST again. A restored active lease blocks another attempt without being reset. Provider state newer than the checkpoint reconciles by GET, while an explicit retry of a genuinely unexecuted request retains the original provider key and first-attempt timestamp. Writes/faults in the target must leave the source checkpoint unchanged.

Delivery recovery also retains a completed FULL Send receipt, an uncertain child Send, a signed pending invoice.sent inbox record, cancellation tombstones and an active Send lease. Provider-disabled reads perform no provider IO. Explicit reconciliation can consume the restored matching signed event; a native invoice GET alone never proves Send. Subsequent event processing is idempotent, and a separately unexecuted Send retries its original key and first-attempt timestamp after its preserved lease is released. These test-mode receipts explicitly report TEST_MODE_NO_EMAIL; no inbox delivery is claimed.

CI runs both source and compiled route checks in a dedicated job and requires it in the existing integration gate. Existing API and built-browser suites retain their commands, assertions and budgets.

## Gates before an actual recovery service or hosted drill

A complete coherent synthetic image does not prove a coherent hosted snapshot. Before any hosted backup/restore work, establish the exact approved account/database/bucket, backend and plan capabilities, owners, recovery scope, write fence, source bookmark/delta strategy, historical key custody and separated restore credentials. Native D1 recovery does not recover R2 or the signing key ring, and restoring the application never rewinds external Stripe records.

Issue #282 still requires owner-approved RPO/RTO and retention, encrypted/access-controlled scheduled backups, monitoring and failure alerts, a reviewed restore procedure, and an authorized isolated hosted drill with measured results. The trusted source comparison in this test is not an authenticated or tamper-resistant backup manifest. Production backup artifacts must not be stored in Git or CI logs. The legacy application's PostgreSQL/files/integration history also remains in scope until source reconciliation and cutover acceptance.

After an authorized restore, keep client access and outbound effects fenced until full image, key and object validation, current authorization, external-provider reconciliation and owner acceptance succeed. Validate current identities/grants against the approved checkpoint and any post-checkpoint revocations before opening access; a restored historical grant is not proof of current permission. Review any source delta before rollback/cutover. Deployment, remote migration, real data/grants, invitations/messages, actual signatures or provider actions, source cancellation and final cutover retain their separate approvals. PR #684 remains open; Coolify is unchanged.
