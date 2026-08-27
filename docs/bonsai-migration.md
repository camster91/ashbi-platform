# Controlled Bonsai migration

The Bonsai migration is a one-way, evidence-preserving transfer into a dedicated Ashbi environment. It is not a live sync and it does not authorize retiring Bonsai.

## Required source

Export and retain these six Bonsai CSV files together:

- `clients.csv`
- `projects.csv`
- `invoices.csv`
- `time-entries.csv`
- `expenses.csv`
- `addresses.csv`

The importer records each file's row count and SHA-256 digest. It produces one combined source fingerprint and one plan fingerprint covering the exact source and planned outcomes.

## Dry run

```text
node scripts/import-bonsai-full.js --dry-run --organization-id <sandbox-org-id> --csv-dir <bonsai-export> --summary-file <new-dry-run-report.json>
```

The report is created once with owner-only permissions. Review every source count, mapped owner, create/match/skip count, and reconciliation finding. A missing file, unsupported currency/status, conflicting Hub record, or incomplete financial/date evidence must be resolved at the source or reviewed manually; the importer does not guess or overwrite it.

## Confirmed sandbox import

After an approved backup and human review of a clean dry run, use the exact unchanged CSV directory and reference that dry-run report:

```text
node scripts/import-bonsai-full.js --confirm --organization-id <sandbox-org-id> --csv-dir <bonsai-export> --approved-summary <reviewed-dry-run-report.json> --summary-file <new-live-report.json>
```

The confirmed import refuses to start without the reviewed report. It rolls back if the tenant, CSV fingerprint, destination plan, required inventory, or reconciliation findings differ from the approved dry run. Existing Hub clients, projects, and invoices are compared and never automatically overwritten. A matching record with different evidence is a manual reconciliation finding.

## Parallel-run exit

1. Rerun the same export as a dry run and prove no duplicate creation.
2. Compare clients, active projects, statuses, owners, invoice totals by currency, time, and expenses between Bonsai and the Hub.
   Export the Hub workspace after the parallel run, retain the exact `clients.csv` and `projects.csv`, and run `npm run reconcile:bonsai-operations -- --organization-id <id> --bonsai-clients <clients.csv> --bonsai-projects <projects.csv> --workspace-export <workspace.json> --completed-at <ISO> --output <new-operations-report.json>`. The workspace must use export version 3, which adds bounded staff identity, time-entry, and expense evidence without exporting staff email/password/role or expense notes/receipts. The command reads all three sources without changing them, rejects ambiguous client/project identities, and preserves every missing record or field difference as an unresolved finding. [operations-reconciliation.example.json](operations-reconciliation.example.json) documents the output contract.
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

The command is read-only. It verifies the agreed parallel duration, complete operating and financial record scope, zero unresolved discrepancies, separate currency evidence, the full Stripe/email sandbox journey, backups and isolated restore, Cameron's post-evidence approval, the required artifact inventory, path containment, and every checksum. The operating report must bind the exact retained Bonsai `clients.csv` and `projects.csv` to an internally valid tenant workspace export version 3, its internal record checksum, and all nine collection counts, including users, time entries, and expenses. Version 2 remains verifiable for legacy recovery evidence but cannot satisfy cutover readiness. The final revenue artifact must match the manifest's Ashbi organization, pass its internal verifier, and be exported after the parallel run ends but before evidence is finalized. The parallel report must reference the exact retained Bonsai `invoices.csv` checksum, revenue file checksum, internal record checksum, and every collection count; a report copied from another source or export cannot pass. The command reports only generic pass/fail messages and never disables Bonsai.

A passing report is necessary but does not perform or authorize the cutover. Cameron must still approve the exact cancellation, downgrade, or system-of-record mutation at action time. Preserve the passing report with the evidence package.

Historical Bonsai credit-card payments are classified as external/other evidence, not Ashbi Stripe payments. The importer does not estimate foreign exchange, combine CAD and USD, or infer customer tier from mixed-currency revenue.
