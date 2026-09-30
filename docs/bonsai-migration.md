# Controlled Bonsai finance and client migration

Ashbi supports a **one-way import** of Bonsai CSV exports into one Ashbi
organization. It covers clients, contacts, projects, invoices (with one line
item each), time entries and expenses. It is not a Bonsai sync and never
writes back to Bonsai. A dry run comes first. A confirmed live run is one
database transaction that rolls back completely if any reconciliation error
or missing input file remains.

It does **not** follow the full contract of the [Slack](slack-export-migration.md),
[Loom](loom-migration.md) and [MarkUp.io](markup-migration.md) importers. It
has no per-run ledger, no `import_runs` row, no audit event, no stable
source-key reconciliation table, **no rollback by run id**, and no exception
codes (findings are free-text messages). Rerunning it **updates** existing
clients and projects instead of reporting them as conflicts. These gaps are
listed under *Known limits*, and the rollback section gives the manual path.
For the cross-system order and sign-off, see the
[migration cutover runbook](migration-cutover-runbook.md).

Code: `scripts/import-bonsai-full.js`. The older `scripts/import-bonsai.js`
is **disabled**: it prints a pointer to `import-bonsai-full.js` and exits
with status `2` without touching the database. Do not use it.

## Prerequisites

- An Ashbi organization and its id.
- At least one user in that organization. The importer attributes every
  imported invoice (`createdById`), and every time entry whose owner it cannot
  match, to the **first ADMIN user it finds** in the organization. If the
  organization has no ADMIN, it uses the first user it finds. No ordering is
  applied, so with several admins the choice is arbitrary; see *Known limits*.
  If the organization has no user, the run stops ("No users found in DB.") with
  exit `1`.
- Ashbi users for the people who logged time in Bonsai; see *Owner matching*.
- The application's environment (at least `DATABASE_URL`) and the committed
  migrations applied.
- An approved backup with its manifest and checksum recorded
  ([backup-and-restore.md](backup-and-restore.md)). Also take a
  **pre-import workspace export**
  (`node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm`).
  It records the before-state of clients, contacts and projects, which a live
  run may overwrite; see *Rollback*.

## Input preparation

Export from Bonsai and put these six files, with exactly these names, in one
directory:

| File | Columns read (exact header names) |
| --- | --- |
| `clients.csv` | `Client`, `Contact Name`, `Contact Email`, `Phone Number`, `Website` (`Tags` is read but not stored) |
| `addresses.csv` | `Client`, `Address 1`, `Address 2`, `City`, `Region`, `Postal Code`, `Country` |
| `projects.csv` | `client_or_company_name`, `title`, `project_id`, `status`, `project_budget_amount`, `amount_paid`, `start_date`, `finish_date` |
| `invoices.csv` | `invoice_number`, `client_or_company_name`, `client_email`, `status`, `total_amount`, `calculated_tax_amount`, `calculated_tax_percent`, `paid_amount`, `currency`, `issued_date`, `due_date`, `paid_date`, `payment_method`, `contractor_invoice_link`, `contractor_project_name` |
| `time-entries.csv` | `client_name`, `project_title`, `owner_name`, `date`, `formatted_time`, `rate`, `billing_status`, `notes` |
| `expenses.csv` | `name`, `amount_after_tax`, `amount_pre_tax`, `currency`, `date`, `tags`, `billable`, `client`, `project` |

Files are parsed by `csv-parser` with its default options: comma separated,
with the header on the first line. A missing column is read as blank, and
extra columns are ignored, **without any finding**. A misspelled header does
not stop the run: its values are simply blank. So check the headers against
this table before the dry run.

- A missing file is recorded in `inputInventory` as `present: false` with
  `rows: 0`. The dry run still continues, but a live run is refused.
- Dates are parsed with JavaScript `new Date(...)`. Use ISO dates
  (`2025-03-04`). A date-only value is read as midnight UTC, and an
  unparsable date counts as missing.
- `formatted_time` must be `HH:MM:SS`. Seconds are dropped, so an entry under
  one minute becomes `0` and is skipped.
- Amounts are parsed with `parseFloat`. An unparsable amount becomes `0`.

## Mapping

Clients are merged from `clients.csv`, then from invoice client names not
already seen, then from project client names not already seen. Names are
compared case-insensitively.

| Bonsai | Ashbi |
| --- | --- |
| `Client` (or an invoice/project client name) | `Client.name`; `contactPerson` = `Contact Name`; `phone`; `domain` = `Website` (dropped on create if another client of this organization has it); address fields from `addresses.csv` matched by client name, `country` defaulting to `US` |
| paid invoices per client | `totalRevenueUsd` / `totalRevenueCad` (sum of `paid_amount` of `paid` invoices, by currency; anything but `CAD` counts as USD) and `tier`: `T1` at 5,000 or more, `T2` at 2,000 or more, else `T3`, using USD + CAD × 0.74 |
| `Contact Email` (or the invoice `client_email`) | one primary `Contact` per client and email |
| project `status` | `active` → `DESIGN_DEV`, `completed` → `LAUNCHED`, `archived` → `ON_HOLD`, anything else → `STARTING_UP` |
| `project_id` | `Project.bonsaiProjectId` |
| `project_budget_amount` (else `amount_paid`) | `Project.budget` |
| `start_date` / `finish_date` | `startDate` / `endDate`; `completedAt` = `finish_date` when status is `completed` |
| invoice `status` | `paid` → `PAID`, `overdue` → `OVERDUE`, `draft`/`drafted`/`scheduled` → `DRAFT`, `sent` → `SENT`, `void` → `VOID`, anything else → `DRAFT` |
| `invoice_number` | `Invoice.invoiceNumber` (kept as is) |
| trailing digits of `contractor_invoice_link` (else the invoice number) | `Invoice.bonsaiInvoiceId` |
| `total_amount`, `calculated_tax_amount`, `calculated_tax_percent` | `total`, `tax`, `taxRate`; `subtotal` = total − tax (at least 0); `amountUsd`/`amountCad` set only for USD/CAD |
| `issued_date`, `due_date`, `paid_date` | `issueDate` (the import time if missing), `dueDate`, `paidAt` (only when `PAID`) |
| `payment_method` | `credit_card` → `STRIPE`, `ach`/`bank_transfer` → `BANK`, any other value → `OTHER`, blank → none |
| `contractor_project_name` | `Invoice.title`, and the project link when a project with that client and title was matched or created earlier in the same run |
| each new invoice with a total above 0 | one `InvoiceLineItem` (quantity 1, unit price = subtotal) |
| time entry | `TimeEntry` with `source = BONSAI_IMPORT`, `duration` in minutes, `billable` when `billing_status` is `billed`, `hourlyRate` = `rate`, `description` = `notes` (else "`<project> work`") |
| expense | `Expense` with `category` from `tags` (advertising → `MARKETING`, professional services/subcontractors → `SUBCONTRACTOR`, software/subscriptions/work devices → `SOFTWARE`, meals, entertainment and travel → `TRAVEL`, electronics/furniture → `SUPPLIES`, else `OTHER`), `billable` when `billable` is `true`, client and project linked when they resolve |

### Deliberately skipped

These rows are counted in the matching `skipped` counter. They add **no**
message to `stats.errors`:

- clients named (case-insensitive) `test`, `test client`, `cameron ashley`,
  `cam ashley`, `ashbi design`, `bianca ashley`, `bianca bien-aime ashley`,
  `demo`, `sample`, `test project` or `example`, any name starting with
  `test `, and blank names. Projects, invoices and time entries of these
  clients are skipped as well;
- projects without a `title`;
- invoices without an `invoice_number`;
- time entries without a project title or date, with a zero duration, or
  with an unparsable date;
- expenses tagged or named `personal`, or named `e-transfer sent cam…`, and
  expenses without a name, with a zero amount or with no valid date.

### Owner matching (time entries)

The `owner_name` is matched against users **of this organization** in this
order:

1. a name containing `cameron` → the first user whose name contains "Cameron"
   or whose email contains "cameron";
2. a name containing `bianca` → the same rule for "Bianca";
3. otherwise, the first user whose name contains the **first word** of
   `owner_name`, case-insensitively.

If no user matches, the entry is attributed to the importer's admin user and
`stats.owners.mappedToImporter` is increased once per distinct owner name. The
importer never creates users. See *Known limits* for the risks of this
matching.

## CLI

```text
node scripts/import-bonsai-full.js --dry-run --organization-id <id> --csv-dir <bonsai-export> --summary-file <new-report.json>
node scripts/import-bonsai-full.js --confirm --organization-id <id> --csv-dir <bonsai-export> --summary-file <new-report.json>
```

| Flag | Required | Meaning |
| --- | --- | --- |
| `--dry-run` | one of `--dry-run` / `--confirm` | Plan only; nothing is written. If both flags are given, `--dry-run` wins |
| `--confirm` | one of `--dry-run` / `--confirm` | Live import in one transaction |
| `--organization-id <id>` | yes (or `IMPORT_ORGANIZATION_ID`) | The target organization. The run fails with "Organization not found" if it does not exist |
| `--csv-dir <dir>` | no | Directory with the six CSV files. Default: `BONSAI_CSV_DIR`, otherwise `data/bonsai-export` in the repository |
| `--summary-file <new-report.json>` | strongly recommended | Where to write the reconciliation JSON. Without it, **no** machine-readable report is produced (stdout gets only a human summary) |

With neither `--dry-run` nor `--confirm`, the command refuses ("Refusing live
import without --confirm") and exits `2`. Without an organization id it
refuses and exits `2`. Any failure exits `1` ("Import failed: …").

A flag's value is simply the next argument. Do not leave a value out: for
example, `--summary-file --confirm` would treat `--confirm` as the file name.

## Flow

### 1. Dry run

```text
node scripts/import-bonsai-full.js --dry-run --organization-id <id> --csv-dir bonsai-export --summary-file reports/bonsai-dry-run-1.json
```

The dry run reads the database (to find existing clients, contacts, projects,
invoices, time entries and expenses) but writes nothing except the report
file.

### 2. Review

- `inputInventory`: all six files `present: true`, with row counts that match
  the Bonsai exports.
- **`stats.errors` must be empty.** In a dry run, `complete` checks **only**
  the input inventory, not `stats.errors`, so a dry run can report
  `complete: true` while errors remain. A live run with any error is refused.
- Created, existing and skipped counts per entity; see *Reconciliation
  report*. Compare each `created + existing + skipped` total with the source
  row counts. Clients are merged from three files, so their total differs
  from `clients.csv` alone.
- `stats.owners.mappedToImporter`: every owner name listed on stdout as
  `[owner mapped to importer]` should be either expected or fixed by creating
  the Ashbi user first.
- `existing` clients and projects will be **overwritten** by a live run. Check
  that list against Hub edits you want to keep.

The stdout log shows at most the first 10 planned invoices and the first 5
time entries and expenses. The report file carries counts only, not
per-record lists.

### 3. Apply

After a human reconciliation approval, with the backup and the workspace
export taken, run `--confirm` with a **new** report path. Every write happens
in one `prisma.$transaction` with a **5-minute** timeout. The transaction is
rolled back, and nothing is kept, when:

- any message is in `stats.errors` ("Live import cannot complete with
  unresolved reconciliation findings"); or
- any of the six files is missing ("Live import cannot complete with an
  incomplete input inventory"); or
- any query fails, or the transaction runs longer than 5 minutes.

A refused or failed live run writes **no** report file. The report is
written only after the transaction commits.

### 4. Verify

1. Rerun the same dry run with a new report path. Every entity should now be
   in `existing`, with `created` at `0`. Expenses are the exception: an
   already imported expense is counted in `expenses.skipped` (there is no
   `existing` counter for expenses).
2. Run the database checks in the
   [cutover runbook](migration-cutover-runbook.md#verification), for example
   the time entries with `source = 'BONSAI_IMPORT'` and the invoices with a
   `bonsaiInvoiceId` in the organization.
3. Open a sample of clients, projects and invoices in the app. Compare totals,
   tax, status and dates with Bonsai. Check that paid and outstanding totals
   per client match the Bonsai reports.

### 5. Rollback (no run id)

The Bonsai importer has **no rollback command and no run id**. A committed
live import can be undone only by hand.

- **Full undo, including overwritten clients and projects:** restore the
  approved pre-import backup. This is the only path that also reverses
  updates to existing records. A database restore returns **every**
  organization to the backup point, so it is safe only inside the cutover
  freeze window, before any other writes. The repository documents the
  isolated restore drill, not an in-place production restore. An in-place
  restore is therefore a decision for the operations owner
  ([backup-and-restore.md](backup-and-restore.md)).
- **Targeted manual removal:** within the organization, remove records that
  are not in the pre-import workspace export (clients, contacts, projects),
  time entries with `source = 'BONSAI_IMPORT'`, and invoices with a
  `bonsaiInvoiceId` that were created in the import window, together with
  their line items. Expenses carry no import marker: find them by client,
  project and creation time. Restore changed client and project fields from
  the workspace export by hand. Record every manual step in the cutover
  evidence.

## Reconciliation report

The `--summary-file` JSON has these fields:

| Field | Meaning |
| --- | --- |
| `generatedAt` | ISO timestamp |
| `mode` | `dry-run` or `live` |
| `organization` | `{ id, name }` |
| `csvDir` | Absolute path of the input directory |
| `inputInventory[]` | `{ filename, path, present, rows }` per CSV file |
| `stats.clients` | `created`, `existing` (matched and **updated**), `skipped` |
| `stats.contacts` | `created`, `existing` |
| `stats.projects` | `created`, `existing` (matched and **updated**), `skipped` |
| `stats.invoices` | `created`, `existing` (matched by number, left unchanged), `skipped` |
| `stats.lineItems` | `created` |
| `stats.timeEntries` | `created`, `existing`, `skipped` |
| `stats.expenses` | `created`, `skipped` (includes expenses that already exist) |
| `stats.owners.mappedToImporter` | Distinct time-entry owner names attributed to the importer's admin |
| `stats.errors[]` | Free-text findings; see the exception taxonomy |
| `complete` | `true` when every input file is present. In a dry run it **ignores** `stats.errors` |

## Exception taxonomy

The Bonsai importer emits **no exception codes**. Each finding is a text
message in `stats.errors`. Any message there blocks a live run. The messages
are:

| Message pattern | Meaning | Category |
| --- | --- | --- |
| `Client "<name>": <error>` | Creating or updating the client or its contact failed | blocking |
| `Project "<title>": no client match for "<client>"` | The project's client was not imported or matched | blocking |
| `Project "<title>": <error>` | Creating or updating the project failed | blocking |
| `Invoice #<number>: no client match for "<client>"` | The invoice's client was not matched by name or email | blocking |
| `Invoice #<number>: <error>` | Creating the invoice or its line item failed | blocking |
| `TimeEntry: no project match for "<project>" / "<client>"` | No project with that client and title, and no project in the organization with that title | blocking |
| `TimeEntry "<project>" <date>: <error>` | Creating the time entry failed | blocking |
| `Expense "<description>": <error>` | Creating the expense failed | blocking |

These are not in `stats.errors`:

| Finding | Where | Category |
| --- | --- | --- |
| Missing CSV file | `inputInventory[].present = false`, `complete = false` | blocking (live) |
| Time-entry owner with no matching user | `stats.owners.mappedToImporter`, stdout `[owner mapped to importer]` | warning |
| Deliberately skipped rows (see *Deliberately skipped*) | the entity's `skipped` counter | warning |
| Bonsai data with no Ashbi field (for example client `Tags`, invoice line detail, attachments) | nowhere | unsupported |

In a dry run, some failures cannot happen because no write is attempted. For
example, a `domain` unique conflict on a client appears only in a live run;
see *Known limits*.

## Idempotency and reruns

| Entity | Matched on (within the organization) | On a rerun |
| --- | --- | --- |
| Client | a contact with the same email, else the same name (case-insensitive) | **updated** with the CSV values (name, contact person, phone, domain, tier, revenue, address) |
| Contact | email + client | left as is |
| Project | `bonsaiProjectId`, else the same name (case-insensitive) + client | **updated** (name, status, budget, dates, `completedAt`, `bonsaiProjectId`) |
| Invoice | `invoiceNumber` | left as is: status, payment and amount changes in Bonsai are **not** applied |
| Time entry | project + user + date + duration | left as is |
| Expense | description + date + amount (+ client when it resolves) | left as is |

A rerun of the same export does not duplicate records, but it **does**
overwrite Hub edits to matched clients and projects. There is no
changed-source detection, and no record of which export row produced which
record.

Each report file is created with the `wx` flag and mode `0600`. An existing
path is never overwritten. Because the report is written **after** the live
transaction commits, an existing path makes a successful live import exit
`1` with no report. Always check that the path is new before `--confirm`.

## Known limits

- **No rollback by run id, no `import_runs` row, no ledger and no audit
  event.** See *Rollback* for the manual path.
- **No exception codes.** Findings are free-text messages.
- A dry run's `complete` ignores `stats.errors`. Always check that
  `stats.errors` is empty.
- Reruns overwrite matched clients and projects. Invoice changes after the
  first import are not applied.
- The live run is one transaction with a 5-minute timeout and sequential
  queries. A large export can exceed it, and then nothing is imported.
- The run does not use the tenant job context (`runTenantJob`). It scopes its
  queries with explicit `organizationId` filters instead, with two gaps:
  - **Expense duplicate check.** `Expense` has no `organizationId`. When an
    expense has no resolvable client, the check matches description, date and
    amount across **all** organizations. An identical expense in another
    organization then causes the row to be skipped silently.
  - **Unlinked expenses.** Expenses with neither a client nor a project are
    stored with no organization link at all.
- `Client.domain` is unique across all organizations, but the conflict check
  runs only on create and only within this organization. A domain used by
  another organization, or a changed `Website` on a matched client, fails
  only in the live run. The dry run cannot predict it.
- Owner matching uses fixed name rules (`cameron`, `bianca`) and a
  first-word "contains" match, so an owner can be attributed to the wrong
  user. A blank `owner_name` matches an arbitrary user of the organization
  and is not counted in `mappedToImporter`.
- The fallback admin user (invoice creator, unmatched owners) is the first
  ADMIN found, with no ordering.
- Two identical time entries (same project, user, date and duration) in one
  export are both counted as `created` in a dry run, but only the first is
  created in a live run.
- The skip list of internal and test client names is hard-coded.
- Bonsai proposals, contracts, payments (beyond `paid_date` and method),
  invoice line detail, tasks, files and client portal data are not imported.
- The client tier uses a fixed CAD→USD rate of 0.74.
