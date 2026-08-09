# Credential vault security and key rotation

Vault ciphertext uses AES-256-GCM envelopes tagged with a key version. Legacy
three-part ciphertext remains readable through `CREDENTIALS_KEY`; new envelopes
resolve their version from `CREDENTIALS_KEYRING`. `CREDENTIALS_ACTIVE_KEY_VERSION`
selects the key used for new writes. `CREDENTIALS_KEY_OWNER` must name the person
or security rotation accountable for custody and emergency action. It has no
invented default, and production clearance requires it to be configured.

The application never returns a credential unless it first commits an immutable
audit row containing organization, actor, credential ID, purpose, outcome,
route, trace ID, and key version. Audit rows contain no username, password,
notes, URL, ciphertext, client payload, or reusable secret. Database triggers
reject audit updates/deletes and reject unowned or cross-organization credentials.
The ownership trigger derives organization ID from a verified client/project
for the retained legacy rollback image, so the schema expansion does not make
the documented immutable rollback path write-incompatible.
Missing-record and decryption failures are sent to the operational alert channel
using the payload-free alert schema.
Purpose is selected from a fixed application allowlist rather than stored as
free text, preventing an operator from accidentally placing secret material in
the audit trail.

## Scheduled access review

The key owner reviews access at least monthly and after every incident:

```bash
npm run audit:credential-access -- --since-hours 720
```

Review every failed outcome, unfamiliar actor, unusual purpose, and sudden
volume change. Actor IDs are identifiers, not proof of intent; verify them
against the current organization membership and session audit evidence. Do not
copy secret values or credential metadata into tickets.

## Staged rotation

1. Name the change owner and second reviewer. Create a fresh encrypted database
   backup and verify restore access before touching keys.
2. Add the new version to `CREDENTIALS_KEYRING` in the secret store while
   retaining every version currently present in ciphertext. Do not commit keys.
3. Run `npm run check:credential-key-config -- --production`, then dry-run:
   `npm run rotate:credential-keys -- --target <new-version>`.
4. In an isolated database, run
   `npm run drill:credential-rotation -- --confirm-disposable`. Attach only its
   payload-free summary to the change record.
5. Run the production rotation with `--apply`. The transaction updates vault
   credentials and WordPress bridge secrets atomically. Any error rolls all
   writes back.
6. Set `CREDENTIALS_ACTIVE_KEY_VERSION` to the new version, restart API and
   worker using the immutable release procedure, and verify representative
   reveal and bridge authentication flows plus the access audit.
7. Retain the old key through the approved rollback window and backup-retention
   horizon. Remove it only after the key owner and reviewer confirm no ciphertext
   or restorable backup still depends on it.

## Rollback and emergency procedure

If verification fails, keep both keys configured and run the rotation command
with the prior version as `--target ... --apply`; then restore the prior active
version and immutable application release. If the transaction itself fails, no
partial database rotation is committed. Never restore only an environment file
while ciphertext remains on a different version.

For suspected key exposure, notify the named owner, restrict vault access,
preserve immutable audit evidence, revoke affected downstream credentials,
generate a new key version in the approved secret manager, and execute the
staged rotation. Do not print environment files, keyring JSON, plaintext,
ciphertext, or provider credentials in logs, terminals captured for tickets, or
GitHub. Production key generation, storage, escrow, and destruction require the
organization's security approval; repository code cannot supply that approval.
