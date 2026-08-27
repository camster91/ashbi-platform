# Controlled Bonsai migration

The Bonsai migration is a one-way, evidence-preserving transfer into a dedicated Ashbi environment. It is not a live sync and it does not authorize retiring Bonsai.

## Required source

Export and retain these six Bonsai CSV files together:

- the timestamped `connection_export` CSV shown as **Companies** in Bonsai
- `projects.csv`
- `invoices.csv`
- `time-entries.csv`
- `expenses.csv`
- `addresses.csv`

The importer records each file's row count and SHA-256 digest. It produces one combined source fingerprint and one plan fingerprint covering the exact source and planned outcomes.

Bonsai's standard data export does not currently provide task evidence in the same CSV inventory. Capture tasks separately through the authenticated Bonsai API into an immutable JSON snapshot using the contract in [bonsai-task-snapshot.example.json](bonsai-task-snapshot.example.json). The snapshot must cover `scope: "all"`, finish every pagination page, set `complete: true` only after the page count is verified, retain active, completed, and archived state, and include the source UUID, project ID, owner display name, dates, priority, and task status. A partial or active-only snapshot is rejected.

The Companies export is a mixed CRM connection population, not a client list. The importer accepts its observed `Name`, `Email`, `Domain`, and related profile columns only through `--connections-csv`. It promotes a connection to a client contact only when the row has an exact operational client name from the project/invoice sources or an exact invoice email. Unrelated leads, vendors, and domains remain outside the client import; a row that points to different clients by name and email, conflicting duplicate emails, or an ambiguous primary contact remains an unresolved finding. The untouched timestamped filename, row count, headers, and checksum remain in the source fingerprint. A legacy `clients.csv` is still understood for recovery of older evidence, but it is not the current Bonsai contract.

## Dry run

```text
node scripts/import-bonsai-full.js --dry-run --organization-id <sandbox-org-id> --csv-dir <bonsai-export> --connections-csv <timestamped-connection-export.csv> --tasks-json <bonsai-tasks.json> --summary-file <new-dry-run-report.json>
```

The report is created once with owner-only permissions. Review every source count, mapped owner, create/match/skip count, and reconciliation finding. A missing file, malformed or over-precise financial value, unsupported currency/status, conflicting Hub record, or incomplete financial/date evidence must be resolved at the source or reviewed manually; the importer does not partially parse, guess, or overwrite it.

## Confirmed sandbox import

After an approved backup and human review of a clean dry run, use the exact unchanged CSV directory and reference that dry-run report:

```text
node scripts/import-bonsai-full.js --confirm --organization-id <sandbox-org-id> --csv-dir <bonsai-export> --connections-csv <timestamped-connection-export.csv> --tasks-json <bonsai-tasks.json> --approved-summary <reviewed-dry-run-report.json> --summary-file <new-live-report.json>
```

The confirmed import refuses to start without the reviewed report. It rolls back if the tenant, CSV fingerprint, destination plan, required inventory, or reconciliation findings differ from the approved dry run. Existing Hub clients, projects, and invoices are compared and never automatically overwritten. A matching record with different evidence is a manual reconciliation finding.

## Parallel-run exit

1. Rerun the same export as a dry run and prove no duplicate creation.
2. Compare clients, active projects, tasks, statuses, owners, invoice totals by currency, time, and expenses between Bonsai and the Hub.
   Export the Hub workspace after the parallel run, retain the exact timestamped Connections export plus `projects.csv`, `invoices.csv`, `time-entries.csv`, and `expenses.csv`, and run `npm run reconcile:bonsai-operations -- --organization-id <id> --bonsai-connections <connection-export.csv> --bonsai-invoices <invoices.csv> --bonsai-projects <projects.csv> --bonsai-time-entries <time-entries.csv> --bonsai-expenses <expenses.csv> --workspace-export <workspace.json> --completed-at <ISO> --output <new-operations-report.json>`. The workspace must use export version 3, which adds bounded staff identity, time-entry, and expense evidence without exporting staff email/password/role or expense notes/receipts. The command reads all six sources without changing them, applies the same project/invoice-evidenced Connections mapper as the importer, rejects ambiguous client/contact/project/staff identities and duplicate operating-ledger identities, and preserves every missing record or field difference as an unresolved finding. Personal and Cameron e-transfer expense rows follow the importer's explicit exclusion rule and remain represented in the source file checksum and total row count. [operations-reconciliation.example.json](operations-reconciliation.example.json) documents the output contract.
   Against the same workspace export, run `npm run reconcile:bonsai-tasks -- --organization-id <id> --bonsai-tasks <bonsai-tasks.json> --workspace-export <workspace.json> --completed-at <ISO> --output <new-task-report.json>`. The command requires a complete all-scope snapshot, matches only immutable Bonsai task UUIDs stored in Hub task properties, verifies project, owner, status, priority, schedule, and completion state, and leaves projectless, duplicated, archived-without-policy, missing, or changed tasks unresolved. [task-reconciliation.example.json](task-reconciliation.example.json) documents the report contract.
   Download the Hub's admin-only revenue evidence artifact and run `npm run verify:revenue-evidence -- <artifact.json>` before comparing invoice, payment, refund, delivery, and settlement records. Preserve both the artifact and verifier output.
   Generate the report directly from the retained `invoices.csv` and Hub revenue artifact: `npm run reconcile:bonsai-revenue -- --organization-id <id> --bonsai-invoices <invoices.csv> --revenue-export <revenue.json> --completed-at <ISO> --output <new-parallel-report.json>`. The command reads both sources without changing them, creates a new owner-only report without overwriting prior evidence, and exits non-zero while any invoice, payment, duplicate, currency, status, or amount finding remains. [parallel-reconciliation.example.json](parallel-reconciliation.example.json) documents the output contract.
3. Run at least one complete proposal-to-payment sandbox journey and retain provider evidence.
4. Keep Bonsai available and unchanged through the agreed parallel period.
5. Retain the source export, both reports, database backup, checksums, exception decisions, and reviewer sign-off.
6. Retire Bonsai only after Cameron explicitly approves the financial cutover at action time.

## Machine-verified cutover gate

Copy [bonsai-cutover-manifest.example.json](bonsai-cutover-manifest.example.json) into the owner-only evidence directory and replace every pending value with reviewed evidence. Keep every referenced artifact beneath that directory and record its SHA-256 checksum. Then run:

```text
npm run check:bonsai-cutover -- --manifest <owner-only-evidence-directory>/cutover-manifest.json
```

The command is read-only. It verifies the agreed parallel duration, complete operating and financial record scope, zero unresolved discrepancies, separate currency evidence, the full Stripe/email sandbox journey, backups and isolated restore, Cameron's post-evidence approval, the required artifact inventory, path containment, and every checksum. The version 3 operating report must bind the exact retained Bonsai Connections, project, invoice, time-entry, and expense sources to an internally valid tenant workspace export version 3, its internal record checksum, and all nine collection counts, including users, time entries, and expenses. The separate task report must bind a complete all-scope Bonsai task snapshot to that same exact workspace artifact and all collection counts; listing `tasks` in the manifest is not accepted as evidence by itself. Legacy operations reports remain useful recovery evidence but cannot satisfy cutover readiness. The final revenue artifact must match the manifest's Ashbi organization, pass its internal verifier, and be exported after the parallel run ends but before evidence is finalized. The parallel report must reference the exact retained Bonsai `invoices.csv` checksum, revenue file checksum, internal record checksum, and every collection count; a report copied from another source or export cannot pass. The command reports only generic pass/fail messages and never disables Bonsai.

A passing report is necessary but does not perform or authorize the cutover. Cameron must still approve the exact cancellation, downgrade, or system-of-record mutation at action time. Preserve the passing report with the evidence package.

Historical Bonsai credit-card payments are classified as external/other evidence, not Ashbi Stripe payments. The importer does not estimate foreign exchange, combine CAD and USD, or infer customer tier from mixed-currency revenue.
