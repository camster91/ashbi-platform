# Import reconciliation sign-off

Fill in one copy for each importer run: one for the dry run, and one more for
the live run it approves. Keep it with the report file and the backup
evidence. The field names refer to each importer's report; see its playbook
and the [migration cutover runbook](../migration-cutover-runbook.md).

## Run

| Field | Value |
| --- | --- |
| System | Bonsai / ClickUp / Notion / Slack / Loom / MarkUp.io |
| Organization id | |
| Target project id (Notion, MarkUp.io) or mapping file (Slack) | |
| Mode | dry run / live / rollback |
| Command (exact, without secrets) | |
| Report file path | |
| Report file SHA-256 | |
| Run id (`run.id`; Slack, Loom and MarkUp.io live runs only) | n/a for Bonsai, ClickUp and Notion |
| Source export and its SHA-256 | |
| Pre-import backup (archive checksum) and workspace export | |
| Operator | |
| Date and time (UTC), start and end | |

## Counts

Use the report's own fields. Write `n/a` where an importer has no such count,
and do not leave a cell blank.

| Entity | Source count | Planned / imported | Unchanged / existing | Skipped | Report field(s) used |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |

Report fields per importer:

- **Slack**: `totals.planned` / `created`, `unchanged`, `alreadyPresent`,
  `alreadyPresentElsewhere`, `skipped`, `deletedInHub`; `channels[]`.
- **Loom**: `totals.rows`, `planned` / `created`, `unchanged`, `skipped`,
  `conflicts`, `deletedInHub`, `plannedBytes` / `importedBytes`.
- **MarkUp.io**: `totals.rows`, `sessionsPlanned` / `sessionsCreated` /
  `sessionsUnchanged`, `commentsPlanned` / `commentsCreated` /
  `commentsUnchanged`, `skipped`, `conflicts`, `deletedInHub`.
- **Notion**: `input.markdownFiles`, `notes.planned` / `created`,
  `unchanged`, `skipped`, `conflicts`; `input.unsupportedFiles`.
- **ClickUp**: `input.rows`, `summary.planned` (every row, including rows with
  findings), `summary.errors`.
- **Bonsai**: `inputInventory[].rows` per file; `stats.<entity>.created` /
  `existing` / `skipped` for clients, contacts, projects, invoices,
  lineItems, timeEntries and expenses.

Count reconciliation: source count = imported + unchanged or existing +
skipped + items with findings. Explain every difference here:

>

## Exceptions by code

List every code in the report (`exceptions` for Loom and MarkUp.io; `errors`,
`warnings` and `unsupported` for the others). Classify each code using the
runbook's normalised taxonomy. For Bonsai, list each `stats.errors` message
group and `stats.owners.mappedToImporter`.

| Code or message | Count | Class (blocking / warning / unsupported) | Disposition (fixed at source / accepted / deferred) | Note or ticket |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |

- [ ] No blocking findings remain (for Bonsai: `stats.errors` is empty, and
      all six files are `present`).
- [ ] Every warning and unsupported item has a disposition.
- [ ] Unmapped people (owners, authors, users) are reviewed.

## Verification (live runs)

| Check | Expected | Actual | OK |
| --- | --- | --- | --- |
| Ledger or marker count query (runbook *Verification*) | | | |
| `import_runs."createdCount"` (Slack, Loom, MarkUp.io) | | | |
| Rerun dry run: nothing planned | 0 | | |
| Sample checked in the app (how many, by whom) | | | |

## Decision

| Field | Value |
| --- | --- |
| Reviewer (not the operator) | |
| Decision | approve live run / approve result / reject: fix and rerun / roll back |
| Conditions or follow-ups | |
| Customer contact acknowledgement (live runs) | |
| Signed (name, date UTC) | |
