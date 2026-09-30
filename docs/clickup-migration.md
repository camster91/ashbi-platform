# Controlled ClickUp task migration (dry-run reconciliation only)

Ashbi has a **dry-run-only reconciliation planner** for a ClickUp task CSV
export. It reads the CSV, maps each row to the Ashbi task fields it would
use, and writes a report of what it found. **It never writes to the
database and never writes to ClickUp.** The live import step is deliberately
not implemented. The CLI refuses `--confirm`, and nothing in the code creates
tasks, projects or users from a ClickUp export.

This playbook uses the same dry-run → review → apply → verify → rollback
shape as the [Loom](loom-migration.md) and [MarkUp.io](markup-migration.md)
playbooks, so the gaps are visible. The apply, verify and rollback steps
below say plainly what is not available. For the cross-system cutover order
and sign-off, see the [migration cutover runbook](migration-cutover-runbook.md).

Code: `scripts/import-clickup-tasks.js` (CLI) and
`src/services/clickup-import-plan.service.js` (planner,
`buildClickUpTaskImportPlan`).

## Prerequisites

- A ClickUp workspace member who can export the lists or spaces in scope as
  CSV.
- Node.js and the repository dependencies (`csv-parser`). The planner needs
  **no** `DATABASE_URL` and no organization: it does not connect to the
  database, so the same run gives the same result on any machine.
- A new, unused path for the report file (see *Report file*).

## Input preparation

Export the tasks from ClickUp as CSV and save it as UTF-8. A UTF-8
byte-order mark (BOM, as written by "UTF-8 with BOM") is accepted: the CLI
removes it from the first header name. Before the run:

1. Check that the header is on the first line and that each row has one task.
2. Keep the original export, with its checksum, alongside the migration
   evidence.

The planner reads these columns. For each field, the lower-case name is
tried first and the ClickUp display name second:

| Field | Column (first match wins) | Required | Mapping |
| --- | --- | --- | --- |
| Source id | `id`, then `Task ID` | yes | Trimmed text; must be unique in the file |
| Title | `name`, then `Task Name` | yes | Trimmed text |
| Status | `status`, then `Status` | no | See the status table; anything else becomes `PENDING` (a non-blank unknown value is reported as `STATUS_FALLBACK`) |
| Priority | `priority`, then `Priority` | no | See the priority table; anything else becomes `NORMAL` (a non-blank unknown value is reported as `PRIORITY_FALLBACK`) |
| Description | `description`, then `Description` | no | Trimmed text; blank becomes `null` |
| Parent | `parent`, then `Parent Task ID` | no | Source id of the parent task; blank becomes `null` |

"First match wins" uses `??`: if the lower-case column is **present but
blank**, the display-name column is not consulted. Do not include both
spellings of a column.

Status (case-insensitive, trimmed):

| ClickUp status | Planned Ashbi status |
| --- | --- |
| `complete`, `completed`, `closed` | `COMPLETED` |
| `in progress`, `doing` | `IN_PROGRESS` |
| `blocked` | `BLOCKED` |
| `to do`, `todo`, `open` | `PENDING` |
| blank | `PENDING` (no finding) |
| anything else, including custom statuses | `PENDING`, with a `STATUS_FALLBACK` warning |

Priority (case-insensitive, trimmed):

| ClickUp priority | Planned Ashbi priority |
| --- | --- |
| `urgent` | `CRITICAL` |
| `high` | `HIGH` |
| `normal` | `NORMAL` |
| `low` | `LOW` |
| blank | `NORMAL` (no finding) |
| anything else | `NORMAL`, with a `PRIORITY_FALLBACK` warning |

Custom statuses and unknown priorities are planned with the fallback value
and reported in `warnings` (one entry per row and field, with the original
value). Warnings do not make the report incomplete. Before sign-off, record a
disposition for each distinct fallback value: accept it, or change the value
in ClickUp or in a copy of the CSV and rerun.

## CLI

```text
node scripts/import-clickup-tasks.js --input <tasks.csv> --summary-file <new-report.json>
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--input <tasks.csv>` | yes | The ClickUp CSV export |
| `--summary-file <new-report.json>` | yes | Where to write the report. The file must not exist yet |
| `--confirm` | not accepted | Refused. The command prints the usage and "This is dry-run only. Live ClickUp writes are intentionally not implemented." and exits with status `2` |

If `--input` or `--summary-file` is missing, the command prints the usage and
exits `2`. It has no `--organization-id`, `--apply`, `--dry-run` or
`--rollback` flag, because every run is a dry run.

Exit status:

| Status | Meaning |
| --- | --- |
| `0` | Report written, and `summary.complete` is `true` (no errors; warnings may be present) |
| `1` | Report written with errors (`summary.complete` is `false`); **or** the report file could not be written ("Report could not be written: …", for example because the path already exists); **or** the CSV could not be opened or parsed ("ClickUp CSV could not be read: …") |
| `2` | Usage error, or `--confirm` given |

A missing or unreadable `--input` file stops the run with "ClickUp CSV could
not be read: …" and exit `1`. As with the other importers, a run that cannot
read its input writes **no** report: there is nothing to reconcile. Fix the
path and rerun.

## Flow

### 1. Dry run

```text
node scripts/import-clickup-tasks.js --input clickup-tasks.csv --summary-file reports/clickup-dry-run-1.json
```

The report is also printed to stdout.

### 2. Review

- `summary.complete` must be `true` and `errors` must be empty.
- Every entry in `warnings` has a recorded disposition.
- `input.rows` must equal the row count of the export as ClickUp shows it
  (without the header).
- `summary.planned` counts **every parsed row**, including rows that also
  have a finding. It is not "rows that will import cleanly".
- Check the distinct statuses and priorities against the fallback tables
  above.
- Check a sample of `tasks[]` against ClickUp: titles, descriptions, parents.

Fix findings in the source (ClickUp) or in a copy of the CSV, keep a record of
every manual edit, and rerun with a **new** report path.

### 3. Apply: not available

No live import exists. `--confirm` is refused, and the planner has no
database code. To move ClickUp work into Ashbi today, staff create projects
and tasks in the app (or through the API) from the reviewed report. That
manual entry is outside this importer and is not reconciled by it. Record it
in the cutover evidence as a manual step (see the
[cutover runbook](migration-cutover-runbook.md)).

### 4. Verify

The only thing to verify is that the plan is stable. Rerun the dry run with a
new report path; apart from `generatedAt`, the reports must be identical for
the same input. Any tasks entered by hand must be checked by hand against the
report: count per project, titles, status, priority and parent/child
structure.

### 5. Rollback: not applicable

Nothing is written to the database, so there is nothing to roll back. The run
leaves only its report file. There is no run id, no `import_runs` row, no
ledger table and no audit event. To undo tasks that staff entered by hand,
delete them in the app. No tool tracks which tasks came from ClickUp.

## Reconciliation report

The file is JSON with these fields:

| Field | Meaning |
| --- | --- |
| `format` | `ashbi-clickup-task-import-report` |
| `version` | `1` |
| `mode` | Always `dry-run` |
| `generatedAt` | ISO timestamp of the run |
| `input.file` | Absolute path of the CSV |
| `input.rows` | Rows parsed (excluding the header) |
| `summary.planned` | Number of entries in `tasks` (one per row, including rows with findings) |
| `summary.errors` | Number of entries in `errors` |
| `summary.warnings` | Number of entries in `warnings` |
| `summary.complete` | `true` only when `errors` is empty (warnings do not count) |
| `tasks[]` | `{ sourceId, title, description, status, priority, parentSourceId }` per row, in file order |
| `errors[]` | Blocking findings; see the exception taxonomy |
| `warnings[]` | Non-blocking findings (fallback mappings); see the exception taxonomy |

The report has no unchanged, skipped or conflict counts, because nothing is
compared with the database.

## Exception taxonomy

Blocking findings are in `errors`, and each one makes the report incomplete
(`summary.complete = false`, exit `1`). Warnings are in `warnings`: the task
is still planned (with the fallback value), the report stays complete, and
each warning needs a recorded disposition. The planner has no unsupported
list.

| Code | Report entry | Meaning | Category |
| --- | --- | --- | --- |
| `MISSING_ID` | `{ row, code }` in `errors` | The row has no source id (`id` / `Task ID` blank or absent) | blocking |
| `MISSING_TITLE` | `{ row, code }` in `errors` | The row has an id but no title (`name` / `Task Name`) | blocking |
| `DUPLICATE_ID` | `{ row, code }` in `errors` | The id was already used by an earlier row. The later row is still listed in `tasks` | blocking |
| `PARENT_UNRESOLVED` | `{ sourceId, code }` in `errors` | The row names a parent id that no row in the file has | blocking |
| `PARENT_SELF` | `{ sourceId, code }` in `errors` | The task names itself as its parent | blocking |
| `PARENT_CYCLE` | `{ sourceIds, code }` in `errors` | The tasks in `sourceIds` form a parent cycle: each names the next as its parent, and the last names the first. Reported once per cycle, starting from the task that comes first in the file | blocking |
| `STATUS_FALLBACK` | `{ row, sourceId, code, value, mappedTo }` in `warnings` | A non-blank status that is not in the status table (for example a custom ClickUp status); planned as `mappedTo` (`PENDING`) | warning |
| `PRIORITY_FALLBACK` | `{ row, sourceId, code, value, mappedTo }` in `warnings` | A non-blank priority that is not in the priority table; planned as `mappedTo` (`NORMAL`) | warning |

`row` is the spreadsheet line number (the first data row is `2`). A row gets
at most one of `MISSING_ID`, `MISSING_TITLE` and `DUPLICATE_ID`, in that
order of precedence, so fixing one can reveal the next.
`PARENT_UNRESOLVED`, `PARENT_SELF` and `PARENT_CYCLE` are checked after all
rows are read, so a parent may come after its child in the file. For a
duplicated id, the parent of its first row is used for the cycle check. Tasks
that only hang below a cycle (their parent chain reaches it) are not reported
separately; fixing the cycle resolves them.

These cases are **not** detected:

- extra columns (ignored without a finding).

## Idempotency and reruns

- The planner is deterministic. The same CSV always gives the same `tasks`,
  `errors` and `warnings`; only `generatedAt` changes.
- The report file is created with the `wx` flag and mode `0600` (owner-only).
  An existing path is never overwritten: the run fails with exit `1` and
  writes nothing. Every rerun needs a new report path. Keep all reports as
  evidence.
- Because nothing is written to Ashbi, a rerun cannot duplicate data. There is
  no source ledger, so reruns do not detect whether a ClickUp task was
  already entered by hand in Ashbi.

## Known limits

- **Dry run only.** No tasks, projects, lists, users or comments are created
  in Ashbi. There is no apply, no rollback by run id, no `import_runs` row and
  no audit event.
- The report does not name a target organization or project. The mapping to
  Ashbi projects has to be decided by hand.
- Only the six fields above are read. The planner ignores assignees,
  watchers, due and start dates, time estimates, time tracked, tags, custom
  fields, checklists, comments, attachments, dependencies and list or folder
  placement.
- Custom statuses and unknown priorities fall back to `PENDING` and `NORMAL`;
  they are reported as `STATUS_FALLBACK` / `PRIORITY_FALLBACK` warnings, not
  mapped to a custom Ashbi value.
- A run that cannot read its `--input` file writes no report.
- The whole file is read into memory. There is no row limit in the code.
