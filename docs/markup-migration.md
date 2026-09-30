# Controlled MarkUp.io review migration

Ashbi supports a **one-way, controlled import** of MarkUp.io review comments
into Ashbi [media review](media-review.md) in one existing project. It is not
a MarkUp.io sync and never writes back to MarkUp.io. The importer follows the
same contract as the [Slack export importer](slack-export-migration.md): dry
run first, durable source reconciliation, changed sources reported rather
than overwritten, reruns that never duplicate, a live run that rolls back
completely on any blocking finding, and a per-run ledger so a completed
import can be rolled back by run id.

> **Operator-prepared input.** MarkUp.io has no documented bulk export. The
> input format below is an Ashbi template that the operator fills in by hand
> (or with their own tooling) from what they can see and download in
> MarkUp.io. It is not a MarkUp.io file format, and nothing here depends on an
> undocumented MarkUp.io API.

## Prerequisites

- An Ashbi organization with the target project already created, and the
  organization id and project id at hand. **One project per run**, given with
  `--project-id` (see *Mapping*).
- An **operator**: an active ADMIN or TEAM user of that organization, named
  with `--operator-email`. The operator creates the review sessions and is
  recorded as the resolver of resolved threads.
- Ashbi staff users (ADMIN or TEAM, active) for the MarkUp.io reviewers whose
  comments should be attributed to them, with the **same email address**
  (compared case-insensitively). Anyone else, including clients, is imported
  by display name and flagged (`UNKNOWN_AUTHOR`).
- The application's environment (at least `DATABASE_URL`), the committed
  migrations applied (`import_runs` and `markup_import_records` tables, and the
  review tables), and an approved backup with its manifest/checksum recorded
  ([backup-and-restore.md](backup-and-restore.md)). The backup must include
  the `uploads/` directory: a live run writes files there.
- Run the importer **from the application directory** (the API's working
  directory). Files are stored under `./uploads`, exactly like uploads made in
  the app.

## Supported input

A directory containing `markup-comments.csv` and the reviewed source files it
names (download the originals you uploaded to MarkUp.io). An example ships at
[examples/markup-comments.example.csv](examples/markup-comments.example.csv).

| Column | Format |
| --- | --- |
| `markup_project` | The MarkUp.io project (or review) name, at most 200 characters |
| `file_name` | A file directly inside the input directory (no folders, no `..`) |
| `comment_id` | A stable id for this comment, unique per file (at most 200 characters) |
| `page` | 1-based page number for a PDF; blank for an image |
| `x_percent`, `y_percent` | Pin position from the top-left corner, 0 to 100; both blank for an unpinned comment |
| `author_email` | The commenter's email (may be blank) |
| `author_name` | The commenter's display name, at most 120 characters (longer is an invalid row) |
| `comment` | Plain text, 1 to 5,000 characters; line breaks allowed in a quoted field |
| `status` | `open` or `resolved` (applies to thread roots) |
| `created_at` | ISO 8601 with an explicit offset, e.g. `2025-06-01T10:00:00+02:00` |
| `thread_id` | The thread the comment belongs to |
| `parent_comment_id` | The `comment_id` it replies to; blank for a thread root |

Every column must be present in the header, in any order (blank values where
allowed). `comment_id` is an addition to the MarkUp.io fields: replies name
their parent by it, and it is the durable key that makes reruns safe. Any
stable value works (MarkUp.io's own comment id when you have it, otherwise
e.g. `<thread_id>-<n>`); never renumber comments between runs.

The CSV is RFC 4180: comma separated, UTF-8 (a BOM is accepted), fields with
commas, quotes or line breaks in double quotes, `""` for a quote. Extra
columns are reported (`UNKNOWN_COLUMN`) and ignored. The CSV itself is capped
at 16 MiB.

Reviewed files must be **JPEG, PNG, GIF, WebP or PDF** and pass the same
upload policy as every upload ([upload-security.md](upload-security.md)):
extension, MIME type and file signature must agree, at most **50 MB** each.

## Mapping

The target project comes from the **`--project-id` flag**, not from a CSV
column: a run imports one MarkUp.io export into one Ashbi project, so a typo
in one row cannot scatter reviews across projects. Split the CSV by project
and run once per project.

| MarkUp.io | Ashbi |
| --- | --- |
| each distinct (`markup_project`, `file_name`) | one review session (`title` "`<markup_project>` — `<file_name>`", status `open`, version 1, **`sharedWithClient = false`**), on a new project attachment holding the file |
| thread root (`parent_comment_id` blank) | top-level comment; pinned (`shape = pin`, `regionX/Y` = `x/y_percent ÷ 100`, `regionW/H = 0`) when it has coordinates, with `pageNumber` on a PDF |
| reply | reply in the same thread (`parentId` = the thread root); a reply to a reply joins the same thread, since Ashbi threads are one level deep |
| `status = resolved` on a root | `resolvedAt` = import time, `resolvedById` = the operator |
| author email of an active staff user | `authorType = staff`, that user and their name |
| any other author | `authorType = guest`, `authorName` = display name, `authorEmail` = the email |
| `created_at` | comment `createdAt` |

Pins are validated by the review API's own rules (`annotationPositionError`)
and satisfy the CHECK constraints of migration
`20260929120000_review_markup`. Imported reviews stay internal until staff
share them from the review screen.

Each session and each comment has a stable source key:
`markup:<markup_project>/<file_name>` for a session and
`markup:<markup_project>/<file_name>/<comment_id>` for a comment (each part
URI-encoded). `markup_import_records` stores the key, a SHA-256 of the file
(session) or of the comment's fields (comment), the target project, the
created session, attachment or comment, and the run (unique per organization
and source key). A rerun never creates a second copy; a later CSV with new
comments on an already imported file adds only those comments to the
existing session (as a new run).

## Exceptions

Every row is either imported, unchanged, or listed in the report; nothing is
dropped silently. The report is **incomplete** (and a live run is refused)
only for the findings marked *blocking*. `exceptions` counts every finding by
code.

| Finding | Report field | Blocking |
| --- | --- | --- |
| File named in the CSV is not in the directory (`MISSING_FILE`) | `errors` | yes |
| File is a link or a directory (`UNSAFE_PATH`), or `file_name` is not a plain file name | `errors` | yes |
| `--project-id` is not a project of this organization (`UNKNOWN_PROJECT`) | `errors` | yes |
| Invalid row: missing id, bad status, page or timestamp, empty or over-long comment, page on an image, PDF pin without a page, reply loop, wrong field count (`INVALID_ROW`) | `errors` | yes |
| The same `comment_id` twice for one file (`DUPLICATE_SOURCE`) | `errors` | yes |
| File or comment changed since its import (`SOURCE_CHANGED`) | `errors` | yes |
| Imported into a different project than `--project-id` (`PROJECT_MAPPING_CHANGED`) | `errors` | yes |
| More than 2,000 comments in one session (`TOO_MANY_COMMENTS`) | `errors` | yes |
| Media scanner still scanning the file (`MEDIA_SCAN_PENDING`, live run only) | `errors` | yes |
| Coordinates outside 0–100 (`COORDINATES_OUT_OF_RANGE`) or not a pair of numbers (`INVALID_COORDINATES`) | `warnings` | no: imported **without a pin** |
| Reply whose parent is not in the CSV or the Hub (`PARENT_MISSING`) | `warnings` | no: imported as a top-level comment without a pin |
| Reply with a page or coordinates (`REPLY_POSITION_IGNORED`) | `warnings` | no: imported as a reply |
| Author email blank or not an active staff user (`UNKNOWN_AUTHOR`, once per author) | `users.unmapped`, `warnings` | no: imported by display name |
| File type not reviewable (`UNSUPPORTED_TYPE`), over 50 MB (`FILE_TOO_LARGE`), or signature mismatch (`INVALID_CONTENT`) | `unsupported` | no: the file and its comments are reported, not imported |
| Media scanner blocked the file (`MEDIA_BLOCKED`, live run only) | `unsupported` | no: reported, not imported |
| Imported session or comment deleted in the Hub (`DELETED_IN_HUB`; it stays deleted) | `totals.deletedInHub`, `warnings` | no |
| Imported session closed in the Hub by a newer version (`SESSION_CLOSED`) | `warnings` | no: new comments are not added |
| Column not in the template (`UNKNOWN_COLUMN`) | `warnings` | no |

## Dry run

A dry run is the default and writes nothing (no rows, no files):

```text
node scripts/import-markup.mjs --organization-id <id> --project-id <id> --operator-email <email> --input-dir <markup-dir> --dry-run --summary-file <new-report.json>
```

Review, per session, the planned, unchanged and skipped comments, the pins,
replies and resolved threads, the `unsupported` list, unmapped authors,
warnings and errors. Do not proceed if the report is incomplete. The media
scan ([media-review.md](media-review.md#scanning-seam)) runs only in a live
run, on the stored file.

## Live run

After a human reconciliation approval, rerun with `--apply` and a new report
filename:

```text
node scripts/import-markup.mjs --organization-id <id> --project-id <id> --operator-email <email> --input-dir <markup-dir> --apply --summary-file <new-report.json>
```

All reads and writes run in the organization's tenant context
(`runTenantJob`). Attachments, sessions, comments and ledger rows are written
in one database transaction that rolls back completely if any blocking
finding is encountered; files stored before the rollback are deleted again,
and a refused run records nothing and writes no report file. A completed run
is recorded in `import_runs` (`source = MARKUP_CSV`, counts only, never
comment text), its id is in the report's `run.id`, and a
`migration_import.applied` audit event is written
([audit-events.md](audit-events.md)). Imports do not send @mention or review
notifications.

Each live run is one transaction (10-minute limit). Keep a run to a few
thousand comments; split larger exports into several CSVs by MarkUp.io
project.

## Reconciliation

- `totals`: rows, sessions planned/created/unchanged, comments
  planned/created/unchanged, replies, pins, resolved, skipped, conflicts,
  `deletedInHub`.
- `sessions`: one entry per (project, file) with the file's size,
  **SHA-256**, outcome and comment counts. Compare the hashes with the source
  files and the stored uploads, and the counts with MarkUp.io.
- Rerun the same dry run: every imported comment should be `unchanged`, with
  nothing planned.
- Open a sample of reviews in the project: pins on the right spot and page,
  threads, authors and resolved state.

## Rollback

```text
node scripts/import-markup.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>
```

Rollback deletes exactly the comments, review sessions and attachments that
run created (the stored files after the transaction commits) and its
reconciliation records, marks the run `ROLLED_BACK`, and writes a
`migration_import.rolled_back` audit event. It is refused while later work
depends on the run: comments or replies not created by it (added in the Hub
or by a later import run), approval decisions, share links, or a newer
version of an imported session. Roll back later runs first, newest first. A
rolled-back export can be imported again.

The rollback locks the run's review sessions and files before it checks for
later work, so a comment, decision, share link or new version written while
it runs is either finished first (and then blocks the rollback) or waits
and fails because the review is gone; it is never deleted silently.

If a stored file cannot be removed after the commit (a filesystem error or
a stopped process), the run stays `ROLLED_BACK` with the remaining paths
recorded in its summary (`pendingFileCleanup`) and the command exits with
an error. Rerun the same `--rollback <runId>` to retry them; once every file
is gone a further rerun reports that the run was already rolled back.

Live imports and rollbacks of this source in one organization run one at a
time (a database advisory lock): a second operator's `--apply` or
`--rollback` waits for the first to commit and then works from its result.

## Known limits

- The CSV is operator-prepared; Ashbi cannot verify it against MarkUp.io.
- Only pins are imported: MarkUp.io boxes, arrows or drawings become pins at
  the given point (or unpinned comments). Attachments on comments, emoji
  reactions, approvals and MarkUp.io version history are not imported.
- Websites and videos reviewed in MarkUp.io are not supported; import a
  screenshot (image) instead, or use Ashbi's web page review.
- The resolve time and resolver are not in the template; resolved threads are
  resolved at import time by the operator.
- Changes after import are conflicts, not updates. To take a newer version,
  roll back the run and import again.
- A session or comment deleted in the Hub after import is never re-imported,
  even after a rerun; roll back its run to import it again.

The report file is created once with owner-only permissions. Do not reuse or
overwrite a prior report; retain it with the related backup evidence.
