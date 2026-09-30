# Workspace export (offboarding)

Status: **code-present, not target verified** (#412, "a workspace export
usable by a leaving customer, including files").

`scripts/export-workspace.js` produces a complete, tenant-scoped export of one
organization: its business records as JSON Lines plus the files its members
uploaded, with a manifest of row counts and SHA-256 checksums. It is an
**operator-only** tool: it runs on a host with database credentials and read
access to the upload directory, never from a user session, and there is no
HTTP route for it (see [privileged-actions.md](privileged-actions.md)).

Code: `src/services/workspace-export.service.js` (entity list, exclusions,
export and offline verification). Tests:
`src/tests/unit/workspace-export.test.js`,
`src/tests/integration/workspace-export.database.test.js`.

## Running an export

1. Confirm the request: the organization id, who asked, and where the export
   will be delivered. Record it in the offboarding ticket.
2. Prefer a quiet workspace (for example after the customer has stopped using
   it). The export reads everything inside one `REPEATABLE READ` database
   transaction, so records are a consistent snapshot even if people keep
   working; files are copied during that transaction.
3. On the application host, from the repository root, with `DATABASE_URL`
   exported (the scripts do not load `.env` themselves):

   ```bash
   node scripts/export-workspace.js \
     --organization-id <organizationId> \
     --output-dir /secure/exports/<organizationId>-<date> \
     [--include-files | --no-files] \
     [--uploads-dir /path/to/uploads] \
     [--page-size 500]
   ```

   - `--output-dir` must not exist or must be an empty directory. A non-empty
     directory (or a file at that path) is refused and left untouched. The
     directory is created `0700` and every file `0600`.
   - Files are included by default (`--include-files`); `--no-files` exports
     the records (including attachment metadata) without copying files.
   - `--uploads-dir` defaults to `./uploads` relative to the working
     directory, which is where the application stores uploads. Stored paths
     are `/uploads/<name>`.
   - `--page-size` (1 to 5000, default 500) is the number of rows read per
     query.
4. The command prints a JSON summary (row, file and exception totals and the
   manifest SHA-256). Exit code `0` means the export completed; it may still
   contain exceptions (for example a missing file), which it also reports on
   stderr. Exit code `1` means it failed; exit code `2` means invalid
   arguments. A directory without `manifest.json` is an incomplete export:
   delete it and run again into a new directory.
5. Review `manifest.json` `exceptions` (below) and decide with the customer
   whether anything needs follow-up before delivery.
6. Verify, package and deliver (below). Delete the operator copy once the
   customer confirms receipt, per the retention decision (#310).

The previous single-file snapshot (`--output <new-file.json> --confirm`,
clients, contacts, projects, tasks, notes and milestones only, verified with
`scripts/verify-workspace-export.js --input`) still works for migration
rehearsals; use the directory export for offboarding.

## What the export contains

```
<output-dir>/
  README.md             for the customer: layout and how to read it
  manifest.json         format, organization, counts, checksums, exclusions, exceptions
  SHA256SUMS            `sha256sum -c` list of every other file
  data/<entity>.jsonl   one JSON object per line, one file per record type
  files/attachments/<attachmentId>/<original file name>
  files/expense-receipts/<expenseId>/<file name>
  files/brand/<brandSettingsId>/<file name>
```

Every record keeps its database `id`, so relations between files are preserved
(`tasks.projectId` → `projects.id`, `invoice_line_items.invoiceId` →
`invoices.id`, `attachments.id` → `files/attachments/<id>/`, and so on).
Dates are ISO 8601 UTC; 64-bit integers are strings.

Included record types (the authoritative list is `EXPORT_ENTITIES` in the
service; `README.md` in each export lists them with descriptions):

| Area | Records |
| --- | --- |
| Workspace | organization, users (members, without credentials), brand settings, pipeline stages, assignment rules, reply/task/project/line-item templates, outreach sequences, snippets |
| Clients | clients, contacts, client email mappings, pipeline deals, intake forms and responses, creative briefs, reports, asset library entries, website inquiries |
| Projects | projects, project context, milestones, tasks, task comments, revision rounds, approvals, activity feed, calendar events and attendees |
| Documents | notes, meeting notes, wiki pages and docs |
| Finance | invoices, invoice line items, payments, proposals, proposal line items and versions, contracts (with signature evidence), estimates, expenses, retainer plans, rate cards, time entries, timer sessions, support hours, revenue snapshots |
| Communication | email threads, messages, internal notes, drafted/sent responses, project chat (both `INTERNAL` and `CLIENT` visibility; the `visibility` column says which), chat reactions, project email, unmatched inbound email, email triage items and drafts, assistant conversations, AI team messages |
| Media review | review sessions, annotations (comments and markup), decisions, share links (metadata only) |
| Files | attachment metadata, the stored attachment files, and uploaded expense receipts |

### Tenant isolation

Every query is filtered by the organization id, directly
(`organizationId = <id>`) or through a parent that is (for example an invoice
line item through its invoice's client, a review annotation through its
session). A unit test checks every entity's filter names the organization,
and the integration test seeds a second organization and asserts none of its
ids, names or file bytes appear anywhere in the output. Rows that have no
relation to any organization (untriaged threads with neither client nor
project, rate cards without a client, approvals without a project) cannot be
attributed and are not exported.

### Excluded, and why

`manifest.json` `exclusions` lists every excluded table and column with its
reason. In summary:

- **Secrets, never exported:** password hashes, password-reset tokens, TOTP
  secrets and recovery codes (`users`); API key hashes (`api_keys`);
  credential-vault ciphertext (`credentials`; the customer can reveal and copy
  entries through the vault UI before leaving); bring-your-own-key AI provider
  keys; accounting, Google Calendar and Slack OAuth/bot tokens; browser push
  keys; client invitation tokens; break-glass token hashes; public link
  capabilities (`viewToken`, `signToken`) and review share-link token hashes.
- **Internal ledgers:** audit events, the domain event outbox, AI tool
  approvals/receipts and usage metering, credential access audits,
  impersonation records, invoice number counters, migration-import ledgers,
  Slack event receipts. Audit history can be provided separately on request
  under the retention policy (#310).
- **Derived or transient data:** vector embeddings, weekly AI digests, AI
  context and prompt configuration, per-user notifications, onboarding state,
  unsaved form drafts (`draftData`), the verbatim MIME source of emails
  (`rawEmail`; the parsed subject, bodies and headers are exported), and
  internal idempotency keys.
- **Trash:** soft-deleted records, and the children of trashed clients and
  projects. Restore anything the customer wants before exporting.
  Attachments are the exception: every attachment of the organization is
  exported with its file, including those of trashed projects, tasks and
  notes and chat uploads not yet sent (`CHAT_PENDING`), because they are the
  customer's files. `data/attachments.jsonl` names each owner
  (`entityType`, `entityId`).
- **Records with no organization link:** intake forms without a client,
  assets without a client and approvals without a project cannot be
  attributed to the organization safely, so they are not exported.
- **WordPress bridge tables** (`wp_*`): the feature was removed on 2026-09-24
  and the tables are retained unread pending the retention decision (#310).
- **Other organizations and global tables:** never read.

Signature evidence on contracts (`clientSigHash`, `signedContentHash`,
`signatureDataHash`, signer IP and user agent) is exported: it is the
customer's proof of what was signed, not a credential.

### File handling

For each attachment of the organization, each expense receipt and the brand
logo, the stored path is resolved inside the upload directory. Only the names
the application writes are accepted: a flat `/uploads/<name>`, or
`/uploads/brand/<name>` for logos, and an expense receipt only when it is
named `receipt-<uuid>.<ext>` (`Expense.receiptUrl` is free text, so another
value could name a file that is not this organization's). The file is opened
without following symbolic links, its real path must stay inside the upload
directory, it is streamed into `files/…` while hashing it, and the copy is
re-read and hashed again; the SHA-256 and size go into `manifest.json` `files` and
`SHA256SUMS`. A file that cannot be exported is recorded in `exceptions`
instead of failing the run silently:

| Code | Meaning |
| --- | --- |
| `FILE_MISSING` | The record points to a file that is not in the upload directory |
| `FILE_QUARANTINED` | The file failed the upload policy (`/uploads/quarantine/`); not copied. Review it before releasing it by hand |
| `FILE_NOT_LOCAL` | The stored path is not a local upload (for example a remote URL) |
| `FILE_PATH_INVALID` / `FILE_PATH_MISSING` | The stored path is empty, escapes the upload directory, or is not a name the application writes (nested, hidden or relative) |
| `FILE_NOT_RECEIPT` | An expense's receipt path is not a receipt name the application writes; not copied |
| `FILE_NOT_REGULAR` | The path is not a regular file, or reaches outside the upload directory through a symbolic link |
| `FILE_UNREADABLE` | The file could not be opened or read (for example permissions); any partial copy is removed and the export continues |
| `FILE_SIZE_MISMATCH` | Copied, but its size differs from the size recorded at upload |
| `FILE_COPY_MISMATCH` | The copy did not match the source hash; removed from the export |

### Scale

Rows are read in primary-key order `--page-size` at a time (keyset
pagination) and streamed to disk; files are streamed too. Memory use does not
grow with table size, except the manifest's list of copied files. The export
uses its own Prisma client, not the application's soft-delete wrapper (which
caps `findMany` at 100 rows), and applies the `deletedAt IS NULL` filter
explicitly.

## Verification

Before delivery, on the operator host:

```bash
node scripts/verify-workspace-export.js --input-dir /secure/exports/<dir> \
  --manifest-sha256 <manifest SHA-256 printed by the export>
(cd /secure/exports/<dir> && sha256sum -c SHA256SUMS)
```

The verifier needs no database. It checks that:
- `SHA256SUMS` lists every other file exactly once, and each hash matches.
  This covers `manifest.json` and `README.md`.
- Every data file and copied file matches `manifest.json`: row counts,
  sizes and SHA-256.
- The manifest totals match its own lists, and no manifest path leaves the
  export directory.
- No unexpected file is present.

With `--manifest-sha256` it also detects a manifest rewritten together with its
checksum list. Exit code `0` means valid. Also spot-check a few records
against the application (for example the number of clients and the latest
invoice).

Package for delivery with `tar -czf <dir>.tar.gz -C /secure/exports <dir>` and
send it over an encrypted channel agreed with the customer; share the
`manifest.json` SHA-256 printed by the export separately so they can confirm
the archive they received.

## How the customer uses it

- `README.md` in the export explains the layout.
- `sha256sum -c SHA256SUMS` (macOS: `shasum -a 256 -c SHA256SUMS`) proves the
  files are intact.
- Each `data/*.jsonl` opens in spreadsheet and data tools, for example
  `pandas.read_json("data/invoices.jsonl", lines=True)` or
  `jq -s . data/clients.jsonl`.
- Files are under `files/attachments/<attachmentId>/`; `data/attachments.jsonl`
  says which project, task, note or chat message each belongs to
  (`entityType`, `entityId`).
