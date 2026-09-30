# Controlled Loom recordings migration

Ashbi supports a **one-way, controlled import** of Loom recordings into
existing Ashbi projects as project media attachments. It is not a Loom sync
and never writes back to Loom. The importer follows the same contract as the
[Slack export importer](slack-export-migration.md): dry run first, durable
source reconciliation, changed sources reported rather than overwritten,
reruns that never duplicate, a live run that rolls back completely on any
blocking finding, and a per-run ledger so a completed import can be rolled
back by run id.

> **Operator-prepared input.** Loom has no documented bulk export. The input
> format below is an Ashbi template that the workspace owner fills in by hand
> (or with their own tooling) after downloading each recording. It is not a
> Loom file format, and nothing here depends on an undocumented Loom API.

## Prerequisites

- An Ashbi organization with the target projects already created, and the
  organization id and project ids at hand.
- An **operator**: an active ADMIN or TEAM user of that organization, named
  with `--operator-email`. Recordings whose owner cannot be matched are
  attributed to the operator.
- Ashbi staff users (ADMIN or TEAM, active) for the Loom owners whose
  recordings should be attributed to them, with the **same email address** as
  in the manifest (compared case-insensitively). Anyone else is flagged
  (`UNKNOWN_OWNER`) and attributed to the operator.
- The application's environment (at least `DATABASE_URL`), the committed
  migrations applied (`import_runs` and `loom_import_records` tables), and an
  approved backup with its manifest/checksum recorded
  ([backup-and-restore.md](backup-and-restore.md)). The backup must include
  the `uploads/` directory: a live run writes files there.
- Run the importer **from the application directory** (the API's working
  directory). Files are stored under `./uploads`, exactly like uploads made in
  the app.
- The Loom workspace owner, to download the recordings.

## Supported input

A directory containing `loom-manifest.csv` and the downloaded recordings it
names. An example ships at
[examples/loom-manifest.example.csv](examples/loom-manifest.example.csv).

| Column | Required | Format |
| --- | --- | --- |
| `loom_url` | yes | `https://www.loom.com/share/<id>` (or `loom.com`, or `/embed/<id>`); a title slug before a 32-hex id and any `?query` or `#fragment` are accepted and dropped |
| `title` | yes | Plain text, at most 200 characters (control and bidi characters are stripped; longer is an invalid row, never truncated) |
| `created_at` | yes | ISO 8601 with an explicit offset, e.g. `2025-03-04T10:15:00-05:00` or `…Z` |
| `owner_email` | yes (may be blank) | The recording owner's email address |
| `file_name` | yes | A file directly inside the input directory (no folders, no `..`) |
| `project_id` | yes | An Ashbi project id of this organization |
| `description` | optional column | Plain text, at most 5,000 characters (longer is an invalid row) |

The CSV is RFC 4180: comma separated, UTF-8 (a BOM is accepted), fields with
commas, quotes or line breaks in double quotes, `""` for a quote. The header
must contain every required column; extra columns are reported
(`UNKNOWN_COLUMN`) and ignored. The CSV itself is capped at 16 MiB.

Recordings must be **MP4** (Loom's download format) or **WebM**, and pass the
same upload policy as every upload ([upload-security.md](upload-security.md)):
extension, MIME type and file signature must agree, and each file is at most
**50 MB**. The limit is unchanged for imports; larger recordings are reported
and not imported (trim or re-export them, or keep them in Loom).

## Mapping

Each manifest row becomes one **project attachment** (`entityType =
PROJECT`, `entityId = project_id`), the same row `POST /api/attachments`
creates, so the recording appears in the project's files and can be put up
for [media review](media-review.md). The file is stored through the upload
code path (`storeValidatedUpload`: policy re-checked on the exact bytes,
random storage name under `uploads/`).

| Loom manifest | Ashbi |
| --- | --- |
| `title` + file extension | `Attachment.originalName` (e.g. `Kickoff walkthrough.mp4`) |
| file bytes | stored upload; `mimeType` `video/mp4` or `video/webm`, `size` |
| `created_at` | `Attachment.createdAt` (the recording sorts by when it was made) and `loom_import_records.sourceCreatedAt` |
| `owner_email` | `Attachment.uploadedById` (matched staff user, else the operator) |
| `loom_url` | `loom_import_records.loomUrl` (canonical share URL) |
| `project_id` | `Attachment.entityId`, `loom_import_records.projectId` |
| `description` | part of the source hash; not shown in the app |

Provenance (source URL and original timestamp) is kept in
`loom_import_records`, one row per recording, with the source key
`loom:<videoId>`, the file's SHA-256, a SHA-256 of the row's fields plus the
file hash, the target project, the created attachment and the run. The key is
unique per organization, so re-running the same manifest, or a later manifest
that lists some of the same videos, never creates a second copy.

## Exceptions

Every item is either imported, unchanged, or listed in the report; nothing is
dropped silently. The report is **incomplete** (and a live run is refused)
only for the findings marked *blocking*. `exceptions` counts every finding by
code.

| Finding | Report field | Blocking |
| --- | --- | --- |
| File named in the manifest is not in the directory (`MISSING_FILE`) | `errors` | yes |
| File is a link or a directory (`UNSAFE_PATH`), or `file_name` is not a plain file name | `errors` | yes |
| `project_id` is not a project of this organization (`UNKNOWN_PROJECT`) | `errors` | yes |
| Invalid row: bad URL, blank title or project, bad timestamp, wrong field count (`INVALID_ROW`) | `errors` | yes |
| Same video twice (`DUPLICATE_SOURCE`) or the same file for two rows (`DUPLICATE_FILE`) | `errors` | yes |
| Recording or row changed since its import (`SOURCE_CHANGED`) | `errors` | yes |
| Recording imported into a different project than the manifest now says (`PROJECT_MAPPING_CHANGED`) | `errors` | yes |
| File changed between inspection and storage (`FILE_CHANGED_DURING_IMPORT`) | `errors` | yes |
| File over 50 MB (`FILE_TOO_LARGE`) | `unsupported` | no: reported, not imported |
| Not MP4/WebM (`UNSUPPORTED_TYPE`) | `unsupported` | no: reported, not imported |
| Signature/MIME/extension mismatch, e.g. a saved error page or a double extension (`INVALID_CONTENT`) | `unsupported` | no: reported, not imported |
| Owner email blank or not an active staff user (`UNKNOWN_OWNER`, plus `ATTRIBUTED_TO_OPERATOR` per row) | `owners.unmapped`, `warnings` | no: imported, attributed to the operator |
| Imported attachment deleted in the Hub (`DELETED_IN_HUB`; it stays deleted) | `totals.deletedInHub`, `warnings` | no |
| Imported file since quarantined by `npm run quarantine:uploads` (`QUARANTINED_IN_HUB`) | `warnings` | no |
| Column not in the template (`UNKNOWN_COLUMN`) | `warnings` | no |

### Command failures

These stop the command (exit status `1`, message on stderr). They are thrown
errors; the code in parentheses is the error's `code`, and no report file is
written.

| Failure | Code |
| --- | --- |
| `--input-dir` does not exist | `MISSING_INPUT` |
| `--input-dir` is an archive (`.zip`) | `ZIP_NOT_SUPPORTED` |
| `--input-dir` is not a directory | `NOT_A_DIRECTORY` |
| `loom-manifest.csv` is missing | `MISSING_FILE` |
| `loom-manifest.csv` is a link or a directory | `UNSAFE_PATH` |
| `loom-manifest.csv` is over 16 MiB | `FILE_TOO_LARGE` |
| `loom-manifest.csv` is empty, has a stray or unterminated quote, or repeats a header | `INVALID_CSV` |
| The header lacks a required column | `MISSING_COLUMNS` |
| `--operator-email` is not an active ADMIN or TEAM user of the organization | `UNKNOWN_OPERATOR` |
| No organization id reached the service | `MISSING_ORGANIZATION` |
| A live run found blocking findings; everything was rolled back, stored files removed, and the errors are printed | `IMPORT_BLOCKED` |
| `--rollback` without an organization or run id reaching the service | `MISSING_ARGUMENT` |
| `--rollback` names a run that is not in this organization | `RUN_NOT_FOUND` |
| `--rollback` names a run that is already rolled back with no files left to remove | `ALREADY_ROLLED_BACK` |
| Rollback refused because later work depends on the run (see *Rollback*) | `ROLLBACK_BLOCKED` |
| Rollback committed but some stored files could not be removed (see *Rollback*) | `FILE_CLEANUP_INCOMPLETE` |

## Dry run

A dry run is the default and writes nothing (no rows, no files):

```text
node scripts/import-loom.mjs --organization-id <id> --operator-email <email> --input-dir <loom-dir> --dry-run --summary-file <new-report.json>
```

Review the planned count and bytes per project, unchanged records, the
`unsupported` list, unmapped owners, warnings and errors. Do not proceed if
the report is incomplete.

## Live run

After a human reconciliation approval, rerun with `--apply` and a new report
filename:

```text
node scripts/import-loom.mjs --organization-id <id> --operator-email <email> --input-dir <loom-dir> --apply --summary-file <new-report.json>
```

All reads and writes run in the organization's tenant context
(`runTenantJob`). The attachments and ledger rows are written in one database
transaction that rolls back completely if any blocking finding is
encountered; files stored before the rollback are deleted again, and a
refused run records nothing and writes no report file. A completed run is
recorded in `import_runs` (`source = LOOM_MANIFEST`, counts only), its id is
in the report's `run.id`, and a `migration_import.applied` audit event is
written ([audit-events.md](audit-events.md)).

Each live run is one transaction (10-minute limit) and reads each file once to
store it. Keep a run to a few hundred recordings; split larger libraries into
several manifests (a rerun of an already-imported row is a no-op).

## Reconciliation

- `totals`: rows, planned/created, unchanged, skipped, conflicts,
  `deletedInHub`, planned and imported bytes.
- `files`: one entry per manifest row with its source key, file name, size,
  **SHA-256** and outcome. Compare the hashes with the downloaded files (for
  example `sha256sum *.mp4`) and with the stored uploads.
- Rerun the same dry run: every imported row should be `unchanged`, with
  `planned: 0`.
- Open a sample of recordings in the project's files and play them.

## Rollback

```text
node scripts/import-loom.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>
```

Rollback deletes exactly the attachments that run created (the database rows
and, after the transaction commits, the stored files) and its reconciliation
records, marks the run `ROLLED_BACK`, and writes a
`migration_import.rolled_back` audit event. It is refused while any review
session uses one of the files (a reviewed file is kept as evidence); remove
those reviews first. The files are locked before that check, so a review
started while the rollback runs waits for it instead of losing its file. A rolled-back manifest can be imported again.

If a stored file cannot be removed after the commit (a filesystem error or
a stopped process), the run stays `ROLLED_BACK` with the remaining paths
recorded in its summary (`pendingFileCleanup`) and the command exits with
an error. Rerun the same `--rollback <runId>` to retry them; once every file
is gone a further rerun reports that the run was already rolled back.

Live imports and rollbacks of this source in one organization run one at a
time (a database advisory lock): a second operator's `--apply` or
`--rollback` waits for the first to commit and then works from its result.

If a live run is refused or fails, the files it already stored are removed
again. Any file that cannot be removed then (a filesystem or permission
error) is listed by path in the command's error message; delete it by hand.

## Known limits

- The manifest is operator-prepared; Ashbi cannot verify that a file is the
  recording at `loom_url`. The URL and timestamp are recorded as provenance.
- Loom comments, reactions, transcripts, chapters, view counts and call-to-
  action links are not imported.
- Recordings over 50 MB are not imported (the limit is deliberately kept).
- Changes after import are conflicts, not updates. To take a newer version,
  roll back the run and import again.
- An attachment deleted in the Hub after import is never re-imported, even
  after a rerun; roll back its run to import it again.
- Imports do not create activity-feed entries or notifications.

The report file is created once with owner-only permissions. Do not reuse or
overwrite a prior report; retain it with the related backup evidence.
