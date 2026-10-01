# Migration cutover runbook

This runbook covers the whole move of an agency's data into Ashbi from
Bonsai, ClickUp, Notion, Slack, Loom and MarkUp.io. It sets the order of
imports, the freeze window, how each import is verified, the go/no-go
decision, rollback per system, communication and post-cutover observation.
The per-system playbooks are authoritative for inputs, flags and findings:

| System | Playbook | Importer | Live import | Rollback by run id | Ledger |
| --- | --- | --- | --- | --- | --- |
| Bonsai | [bonsai-migration.md](bonsai-migration.md) | `scripts/import-bonsai-full.js` | `--confirm` | **no** | none. Markers only: `projects."bonsaiProjectId"`, `invoices."bonsaiInvoiceId"`, `time_entries.source = 'BONSAI_IMPORT'` |
| ClickUp | [clickup-migration.md](clickup-migration.md) | `scripts/import-clickup-tasks.js` | **not implemented** (dry run only) | not applicable | none |
| Notion | [notion-markdown-migration.md](notion-markdown-migration.md) | `scripts/import-notion-markdown.js` | `--confirm` | **no** | `notion_import_records` |
| Slack | [slack-export-migration.md](slack-export-migration.md) | `scripts/import-slack-export.mjs` | `--apply` | yes, `--rollback <runId>` | `import_runs` (`SLACK_EXPORT`), `slack_import_records` |
| Loom | [loom-migration.md](loom-migration.md) | `scripts/import-loom.mjs` | `--apply` | yes, `--rollback <runId>` | `import_runs` (`LOOM_MANIFEST`), `loom_import_records` |
| MarkUp.io | [markup-migration.md](markup-migration.md) | `scripts/import-markup.mjs` | `--apply` | yes, `--rollback <runId>` | `import_runs` (`MARKUP_CSV`), `markup_import_records` |

Every importer is one-way and never writes back to the source system. When
given a report path, every importer writes its report with owner-only
permissions and refuses to overwrite an existing path. Always pass a report
path (`--summary-file` is optional for every live importer, and without it no
report file is written; the ClickUp dry-run planner requires it and exits `2`
without it), and do not assume a report exists after a failed
live run: every live importer (Notion, Slack, Loom, MarkUp.io and Bonsai)
writes its report only after its database work has committed, so a failed
write leaves the import committed without a report file. Slack, Loom and
MarkUp.io also print the report to stdout. Keep every report as evidence.

Use the [reconciliation sign-off template](examples/import-reconciliation-template.md)
for each dry run and each live run.

## Roles

Name one person for each role before the freeze. One person may hold more
than one role, but the reviewer must not be the operator for the same
import.

- **Migration lead**: owns the plan, calls go/no-go, owns communication.
- **Operator**: runs the commands. For Loom and MarkUp.io this is the
  `--operator-email` user, an active ADMIN or TEAM user.
- **Reviewer**: signs each reconciliation report.
- **Operations owner**: owns backups and any database restore
  ([backup-and-restore.md](backup-and-restore.md)).
- **Customer contact**: the agency person who confirms readiness and accepts
  the result.

## Pre-cutover checklist

Complete every item before the freeze starts.

- [ ] **Backup taken and restore verified.** An encrypted backup exists within
      the approved RPO, and the isolated restore drill has passed on that
      archive (`scripts/restore-drill-vps.sh`, see
      [backup-and-restore.md](backup-and-restore.md)). Record the archive
      checksum, the drill result and sanitized counts. The backup includes
      `uploads/`, because Loom and MarkUp.io live runs write files there.
- [ ] **Workspace export taken.** Run
      `node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm`
      and verify it with `node scripts/verify-workspace-export.js --input <file>`.
      This is the before-state of clients, contacts, projects, tasks, notes
      and milestones, which the manual Bonsai and Notion rollback paths need.
- [ ] **Migrations applied** in the target (`import_runs`,
      `slack_import_records`, `loom_import_records`, `markup_import_records`,
      `notion_import_records` exist).
- [ ] **Staff accounts exist.** Every person whose work should be attributed
      is an active Ashbi user with the same email as in the source: Slack
      authors, Loom owners, MarkUp.io reviewers. For Bonsai time entries, the
      user's name must match the owner name (see the Bonsai playbook's
      *Owner matching*).
- [ ] **Source exports collected and checksummed**: the Bonsai CSV directory
      (six files), the ClickUp CSV, the extracted
      Notion Markdown export, the extracted Slack export and mapping file,
      and the Loom and MarkUp.io directories with their CSVs.
- [ ] **Dry-run reports reviewed and signed off**, one per importer and per
      run, each on the reconciliation template, with the reviewer's decision.
      A dry run must have been run against the target database, or against a
      restored copy of it that is no older than the freeze start.
- [ ] **Exceptions triaged.** Every `blocking` finding (see the taxonomy
      below) is resolved at the source, and the dry run is repeated with a
      new report path. Every `warning` and `unsupported` finding has a
      written disposition: accepted, fixed or deferred. Bonsai's blocking
      findings are free-text messages in `stats.errors`, which must be
      empty (its `complete` flag is `false` otherwise); its coded warnings
      are in `stats.warnings`.
- [ ] **Run sizes checked.** Slack under about 100,000 messages per run (use
      `--channel`); Loom a few hundred recordings per manifest; MarkUp.io a
      few thousand comments per CSV. The Bonsai live run must finish within
      its 5-minute transaction timeout, so rehearse it on a restored copy.
- [ ] **Rehearsal done** on a restored copy or with synthetic data, using
      the same commands, with timings recorded.
- [ ] **Customer readiness checklist** (below) complete.

## Customer readiness checklist

- [ ] The customer has named the systems and date ranges in scope, and what
      stays behind: for example ClickUp tasks (no live import), Slack DMs,
      and Loom comments and transcripts.
- [ ] The customer has accepted each system's known limits (see the *Known
      limits* section of each playbook).
- [ ] The customer has approved the channel-to-project mapping (Slack), the
      target project for each Notion export and MarkUp.io CSV, and the
      Loom `project_id` values.
- [ ] Staff user list and emails confirmed; clients who will use the portal
      identified. Imported MarkUp.io reviews stay internal until shared.
- [ ] Freeze window agreed in writing, including who may still write to the
      old tools, and that nobody writes to Ashbi for this organization during
      the freeze.
- [ ] Source systems stay available **read-only** until acceptance, and
      they are not cancelled before the post-cutover observation ends.
- [ ] The customer knows how to report a missing or wrong record, and who
      answers.
- [ ] A customer sign-off owner is named for the acceptance decision.

## Freeze window

1. **Announce the freeze** (see *Communication*). From the start of the freeze:
   no new work in Bonsai, ClickUp, Notion, Slack channels in scope, Loom or
   MarkUp.io for the migrated scope; and no writes in Ashbi for this
   organization except the operator's imports.
2. **Take final exports** after the freeze starts, so that nothing is created
   after the export.
3. **Take the pre-import backup and workspace export** (see the pre-cutover
   checklist). If a backup restore is the rollback plan for Bonsai or Notion,
   this backup is the restore point, and it is only safe while nobody else
   writes to the database. A restore affects every organization in that
   database.
4. Run the imports in the order below. **Checkpoint** after each step: verify
   it, record the report, and decide to continue or roll back before starting
   the next.
5. **End the freeze** only after go/no-go.

## Order of imports

Dependencies decide the order: people and clients before projects, projects
before anything attached to a project, parents before children.

| Step | What | Why here | Depends on |
| --- | --- | --- | --- |
| 0 | Staff users (in the app) | Every importer attributes work by matching users; unmatched work goes to the operator or importer | none |
| 1 | **Bonsai**: clients, contacts, projects, invoices, time entries, expenses | Creates the clients and projects that later imports target. It has no run-id rollback, so it goes first, while a restore to the pre-import backup undoes nothing else | step 0 |
| 1a | Checkpoint backup | After Bonsai is verified, take a fresh backup. A later restore then does not undo the verified Bonsai import | step 1 verified |
| 2 | Projects not from Bonsai (in the app) | Notion, Slack, Loom and MarkUp.io need existing project ids | step 1 |
| 3 | **ClickUp** tasks: manual entry from the reviewed dry-run report | No live importer. Tasks need their projects, and parent tasks must be entered before their subtasks | step 2 |
| 4 | **Notion** Markdown, one project per run | Needs the project; the parent page before the child is handled inside a run | step 2 |
| 5 | **Slack** export, per channel or per mapping | Needs the mapped projects; align it with any live Slack mapping first | step 2 |
| 6 | **Loom** manifest | Needs the projects in `project_id` | step 2 |
| 7 | **MarkUp.io** CSV, one project per run | Needs the project; the reviewed files become new attachments | step 2 |

Steps 4 to 7 do not depend on each other and can run in any order. Run only
one live import per source and organization at a time. Loom and MarkUp.io
enforce this with a database advisory lock; Slack, Notion and Bonsai do not,
so the operator must.

Rolling back goes in **reverse** order, newest run first.

## Running each import

For each importer, per run:

1. Dry run with a new report path (commands in each playbook).
2. Review and sign the dry-run report on the template.
3. Live run with a new report path: `--apply` (Slack, Loom, MarkUp.io) or
   `--confirm` (Notion, Bonsai). ClickUp has no live run.
4. Record the run id (`run.id` in the report) for Slack, Loom and MarkUp.io.
5. Verify (next section) and sign the live-run report.

A live run that finds a blocking finding rolls back completely and writes no
report file. Fix the finding and start again at the dry run. A missing report
does not by itself prove a rollback: every live importer writes its report
after the commit, so a failed report write leaves that import committed.
After any failed live command, check before rerunning: for Slack, Loom and
MarkUp.io, look for a new `import_runs` row for the organization (its id is
the run id for `--rollback`); for Notion and Bonsai, run the verification
queries below.

## Verification

Use each importer's report counts and ledger tables. Every query below must
be scoped to the organization. Replace `:org`, `:run` and `:project` with the
values for the run.

### Every importer with a run id (Slack, Loom, MarkUp.io)

```sql
SELECT id, source, status, "createdCount", "createdAt"
FROM import_runs
WHERE "organizationId" = :org
ORDER BY "createdAt";
```

`createdCount` must equal the live report: `totals.created` for Slack and
Loom, and `totals.sessionsCreated + totals.commentsCreated` for MarkUp.io.
`status` must be `APPLIED`.

### Slack

```sql
SELECT count(*) FROM slack_import_records WHERE "organizationId" = :org AND "runId" = :run;
```

This must equal `totals.created`. Rerun the dry run: `planned` must be `0`,
with every imported message `unchanged`. Compare per-channel counts in
`channels[]` with Slack.

### Loom

```sql
SELECT count(*), sum("fileSize") FROM loom_import_records WHERE "organizationId" = :org AND "runId" = :run;
```

The count must equal `totals.created` and the sum must equal
`totals.importedBytes`. Compare the `files[].sha256` values with
`sha256sum` of the downloaded files. Rerun the dry run: `planned` must be `0`.

### MarkUp.io

```sql
SELECT kind, count(*) FROM markup_import_records
WHERE "organizationId" = :org AND "runId" = :run
GROUP BY kind;
```

`SESSION` must equal `totals.sessionsCreated`, and `ANNOTATION` must equal
`totals.commentsCreated`. Rerun the dry run: nothing may be planned.

### Notion

```sql
SELECT count(*) FROM notion_import_records WHERE "organizationId" = :org AND "projectId" = :project;
```

This must equal the sum of `notes.created` over every live run for that
project. Rerun the dry run: every page must be `unchanged` (`notes.planned` is
`0`), and `errors` must be empty.

### Bonsai (no ledger)

```sql
SELECT count(*) FROM projects WHERE "organizationId" = :org;
SELECT count(*) FROM invoices WHERE "organizationId" = :org AND "bonsaiInvoiceId" IS NOT NULL;
SELECT count(*) FROM time_entries t JOIN projects p ON p.id = t."projectId"
WHERE p."organizationId" = :org AND t.source = 'BONSAI_IMPORT';
```

On a first import into an empty organization, every project in it was
created by the run, so the project count equals `stats.projects.created`
(this also covers projects created from rows with a blank `project_id`,
which get no `bonsaiProjectId`), and the invoice and time-entry counts equal
`stats.invoices.created` and `stats.timeEntries.created`. Into an
organization that already has projects, compare the project count before and
after the run instead. Rerun the dry run:
`created` must be `0` for every entity. Compare paid and outstanding totals
per client with Bonsai.

### ClickUp (manual entry)

Compare task counts per project, titles, statuses, priorities and
parent/child structure in Ashbi with the signed dry-run report's `tasks[]`.

### Every system

- Open a sample in the app as a staff user and as a client-portal user where
  relevant. Check that imported reviews are not shared with clients unless
  intended.
- Run the authenticated checks in
  [authenticated-replacement-validation.md](authenticated-replacement-validation.md)
  for the migrated areas.

## Go/no-go criteria

**Go** only when every item is true:

- every signed dry-run report has no blocking finding, and every warning and
  unsupported item has a recorded disposition;
- every live run committed, and its counts match the dry run it was approved
  from (same planned and created totals, with differences explained);
- every verification query and rerun dry run above matches;
- sample checks pass, and the customer contact has accepted the sample;
- no import is left half-done: rolled-back runs were re-imported or
  deliberately dropped, and no Loom or MarkUp.io run has a
  `pendingFileCleanup` left;
- the checkpoint backup after Bonsai exists, and a post-import backup is
  taken.

**No-go** if any is true: a blocking finding was overridden instead of fixed;
a count mismatch has no explanation; a live run failed and its state is
unclear; the backup or restore drill is missing; or the customer has not
accepted. On no-go, roll back (next section) or extend the freeze, and
communicate.

## Rollback per system

Roll back in reverse import order, newest run first.

| System | Rollback | Notes |
| --- | --- | --- |
| MarkUp.io | `node scripts/import-markup.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>` | Refused (`ROLLBACK_BLOCKED`) when later comments, decisions, share links or versions depend on the run. Rerun if it stops with `FILE_CLEANUP_INCOMPLETE` |
| Loom | `node scripts/import-loom.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>` | Refused (`ROLLBACK_BLOCKED`) while a review session uses one of its files. Rerun if it stops with `FILE_CLEANUP_INCOMPLETE` |
| Slack | `node scripts/import-slack-export.mjs --organization-id <id> --rollback <runId> --summary-file <new-report.json>` | Refused (`ROLLBACK_BLOCKED`) when a message outside the run replies to one of its messages |
| Notion | **Manual; no run id.** Delete the notes named in `notion_import_records."noteId"` for the project and window, and delete those records. Alternatively, restore the pre-import backup | See the Notion playbook's *Rollback* |
| ClickUp | **Nothing to roll back** in the importer. Delete tasks entered by hand in the app | The importer writes only its report |
| Bonsai | **Manual; no run id.** Restore the pre-import backup: the only full undo, and it reverts every organization. Otherwise a **partial** undo: remove the records this run created (its import window only; every run shares the `BONSAI_IMPORT` marker). This cannot restore fields the import overwrote on existing clients and projects (`tier`, `totalRevenueUsd`, `totalRevenueCad`, `bonsaiProjectId`), which the workspace export does not capture | See the Bonsai playbook's *Rollback* |

The per-run commands write a `migration_import.rolled_back` audit event and
mark the run `ROLLED_BACK`. After a rollback, rerun the dry run to confirm
that the rolled-back items are planned again. Record every rollback,
including manual steps, on the template.

## Normalised exception taxonomy

Each importer uses its own codes. For triage and sign-off they fall into
four classes:

- **blocking**: the report is incomplete and a live run is refused or rolled
  back;
- **warning**: imported (or harmlessly skipped) and reported; needs a
  recorded disposition;
- **unsupported**: reported and not imported; needs a recorded disposition;
- **fatal**: the command stops with an error and no report; fix the cause
  and rerun.

### Report findings

| Common category | Code | Importers | Class |
| --- | --- | --- | --- |
| Invalid source row or file | `INVALID_ROW` | Loom, MarkUp.io | blocking |
| | `MISSING_ID`, `MISSING_TITLE` | ClickUp | blocking |
| | `EMPTY_PAGE` | Notion | blocking |
| | `INVALID_POSITION` | MarkUp.io | blocking |
| | `INVALID_CHANNEL`, `UNSAFE_CHANNEL_NAME`, `DUPLICATE_CHANNEL_NAME` | Slack | blocking for a mapped channel, warning otherwise |
| | `INVALID_DAY_FILE`, `INVALID_TS`, `EMPTY_MESSAGE` | Slack | warning |
| | `UNKNOWN_COLUMN` | Loom, MarkUp.io | warning |
| | `INVALID_COORDINATES`, `COORDINATES_OUT_OF_RANGE`, `REPLY_POSITION_IGNORED` | MarkUp.io | warning (imported without the position) |
| Duplicate in the source | `DUPLICATE_SOURCE` | Loom, MarkUp.io | blocking |
| | `DUPLICATE_FILE` | Loom | blocking |
| | `DUPLICATE_ID` | ClickUp | blocking |
| | `DUPLICATE_CHANNEL`, `DUPLICATE_TS` | Slack | warning (first kept) |
| Missing file or reference | `MISSING_FILE`, `UNSAFE_PATH` | Loom, MarkUp.io (report); Slack (`UNSAFE_PATH` as a channel finding) | blocking |
| | `UNKNOWN_PROJECT` | Slack, Loom, MarkUp.io | blocking |
| | `CHANNEL_NOT_SELECTABLE` | Slack | blocking |
| | `PARENT_UNRESOLVED` | Notion, ClickUp | blocking |
| | `PARENT_SELF`, `PARENT_CYCLE` | ClickUp | blocking |
| | `PARENT_MISSING` | MarkUp.io | warning (imported top-level) |
| | `THREAD_PARENT_MISSING` | Slack | warning (imported top-level) |
| Source changed since import | `SOURCE_CHANGED` | Slack, Notion, Loom, MarkUp.io | blocking |
| | `PROJECT_MAPPING_CHANGED` | Slack, Loom, MarkUp.io | blocking |
| | `FILE_CHANGED_DURING_IMPORT` | Loom, MarkUp.io | blocking (live run) |
| Destination conflict | `DESTINATION_CONFLICT`, `MISSING_DESTINATION` | Notion | blocking |
| | `LIVE_MAPPING_CONFLICT` | Slack | blocking |
| | `TOO_MANY_COMMENTS` | MarkUp.io | blocking |
| | `MEDIA_SCAN_PENDING` | MarkUp.io | blocking (live run; retry) |
| | `CLIENT_DOMAIN_TAKEN` | Bonsai | warning (client imported without that domain) |
| Already in Ashbi / changed in Ashbi | `ALREADY_PRESENT`, `ALREADY_PRESENT_OTHER_PROJECT` | Slack | warning |
| | `DELETED_IN_HUB` | Slack, Loom, MarkUp.io | warning (stays deleted) |
| | `QUARANTINED_IN_HUB` | Loom | warning |
| | `SESSION_CLOSED` | MarkUp.io | warning |
| Identity not mapped | `UNKNOWN_OWNER`, `ATTRIBUTED_TO_OPERATOR` | Loom | warning (operator attributed) |
| | `UNKNOWN_AUTHOR` | MarkUp.io | warning (imported by display name) |
| | `users.unmapped` (no code) | Slack | warning (display name) |
| | `stats.owners.mappedToImporter` (no code) | Bonsai | warning (importer admin attributed) |
| Unsupported content | `UNSUPPORTED_TYPE`, `FILE_TOO_LARGE`, `INVALID_CONTENT` | Loom, MarkUp.io | unsupported. `INVALID_CONTENT` is blocking when the live run's re-check of the stored bytes fails |
| | `MEDIA_BLOCKED` | MarkUp.io | unsupported (live run) |
| | `unsupported.*` (no code) | Slack | unsupported (files, DMs, canvases) |
| | `input.unsupportedFiles` (no code) | Notion | blocking (non-Markdown files block a live run) |
| | `EXPENSE_NO_CLIENT` | Bonsai | unsupported (not imported: the importer requires a client for each expense) |
| Value mapped to a default | `STATUS_FALLBACK`, `PRIORITY_FALLBACK` | ClickUp | warning (planned as `PENDING` / `NORMAL`) |
| No code (free text) | `stats.errors[]` | Bonsai | blocking |
| | missing CSV file (`inputInventory`) | Bonsai | blocking (live run) |
| | `stats.timeEntries.duplicates` (no code) | Bonsai | warning (repeated row in one export imported once) |

### Command failures (fatal)

| Code | Importers | Cause |
| --- | --- | --- |
| `MISSING_INPUT`, `ZIP_NOT_SUPPORTED`, `NOT_A_DIRECTORY` | Slack, Loom, MarkUp.io | Input directory missing, a `.zip`, or not a directory |
| `MISSING_FILE`, `UNSAFE_PATH`, `FILE_TOO_LARGE` | Slack, Loom, MarkUp.io | Required input file missing, a link, or over the size limit |
| `INVALID_JSON`, `INVALID_MAPPING` | Slack | Export JSON or mapping file invalid |
| `INVALID_CSV`, `MISSING_COLUMNS` | Loom, MarkUp.io | CSV malformed or missing a required column |
| `UNKNOWN_OPERATOR` | Loom, MarkUp.io | `--operator-email` is not an active ADMIN or TEAM user |
| `MISSING_ORGANIZATION`, `MISSING_PROJECT`, `MISSING_ARGUMENT` | Slack, Loom, MarkUp.io (`MISSING_PROJECT`: MarkUp.io) | Required argument did not reach the service |
| `IMPORT_BLOCKED` | Slack, Loom, MarkUp.io | A live run found blocking findings and rolled back |
| `RUN_NOT_FOUND`, `ALREADY_ROLLED_BACK`, `ROLLBACK_BLOCKED` | Slack, Loom, MarkUp.io | Rollback target missing, already rolled back, or depended on |
| `FILE_CLEANUP_INCOMPLETE` | Loom, MarkUp.io | Rollback committed but some stored files remain; rerun the rollback |

Notion, ClickUp and Bonsai have no coded command failures. They stop with a
plain error message (for example "Organization not found", "ClickUp CSV
could not be read: …", "Refusing import: summary file already exists: …",
or "Live import cannot complete with unresolved reconciliation findings").

## Schema migration failures

### Expense organization migration

Migration `20261001130000_expense_organization` gives every expense an
`organizationId`. It derives it from the expense's client, then its project,
then its linked invoice. When none of them exists and the database holds
exactly one organization, the expense goes to that organization. It refuses
to guess otherwise. `prisma migrate deploy` then stops with `P3018`,
database error code `P0001`, and one of these messages (also stored in
`_prisma_migrations.logs`):

- `Expense organization migration aborted: N expense(s) have no client,
  project or invoice to derive an organization from, and the database holds
  M organizations; …`
- `Expense organization migration aborted: N expense(s) link a client and a
  project of different organizations; …`

The migration runs as one implicit transaction, so nothing it did is kept:
`expenses` has no `organizationId` column afterwards and the previous image
keeps working. To recover:

1. Find the rows. Unattributable:
   `SELECT id, description, amount, date FROM expenses WHERE "clientId" IS NULL AND "projectId" IS NULL AND "invoiceId" IS NULL;`
   Conflicting:
   `SELECT e.id FROM expenses e JOIN clients c ON c.id = e."clientId" JOIN projects p ON p.id = e."projectId" WHERE c."organizationId" <> p."organizationId";`
2. With the owning organization's operator, give each one the right client or
   project (or clear the wrong one), or delete it. Take a backup first
   ([backup-and-restore.md](backup-and-restore.md)).
3. Prisma recorded the attempt as failed, so the next deploy stops with
   `P3009` until it is marked rolled back:
   `npx prisma migrate resolve --rolled-back 20261001130000_expense_organization`
4. Rerun `npx prisma migrate deploy` (or redeploy).

## Communication

| When | Who | Message |
| --- | --- | --- |
| At least 5 working days before | Migration lead → customer contact, staff | Date, freeze window, scope, what stays behind, and the go/no-go time |
| Freeze start | Migration lead → all users of the old tools | Old tools are read-only for the migrated scope; Ashbi is not yet in use for this organization |
| After each checkpoint | Operator → migration lead | Report path, run id, counts, and whether it matched |
| Any rollback | Migration lead → customer contact | What was rolled back, why, and the new plan |
| Go/no-go | Migration lead → customer contact, staff | Decision, start using Ashbi (or the freeze is extended), and where to report problems |
| End of observation | Migration lead → customer contact | Acceptance request; when the old tools can be retired |

## Post-cutover observation

For at least the first two weeks after go, or the period agreed with the
customer:

- Keep the source systems read-only and available. Do not cancel them before
  acceptance.
- Keep every report, the pre-import and checkpoint backups, the workspace
  export and the signed templates with the migration evidence, for the
  retention period agreed under the privacy and retention policy.
- Watch for reports of missing or wrong records. Check each one against the
  reports: was it skipped, unsupported, or never in the export?
- Do **not** rerun Bonsai against the live workspace after go. A rerun
  overwrites matched clients and projects with the export's values.
- Rolling back a Slack, Loom or MarkUp.io run after go is refused once later
  work depends on it. After that point, fix records in the app instead.
- Check backup freshness and application health daily
  ([observability-and-slos.md](observability-and-slos.md)).
- Close with the customer's written acceptance, and record it with the
  evidence.
