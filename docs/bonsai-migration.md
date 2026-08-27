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
   Download the Hub's admin-only revenue evidence artifact and run `npm run verify:revenue-evidence -- <artifact.json>` before comparing invoice, payment, refund, delivery, and settlement records. Preserve both the artifact and verifier output.
3. Run at least one complete proposal-to-payment sandbox journey and retain provider evidence.
4. Keep Bonsai available and unchanged through the agreed parallel period.
5. Retain the source export, both reports, database backup, checksums, exception decisions, and reviewer sign-off.
6. Retire Bonsai only after Cameron explicitly approves the financial cutover at action time.

## Machine-verified cutover gate

Copy [bonsai-cutover-manifest.example.json](bonsai-cutover-manifest.example.json) into the owner-only evidence directory and replace every pending value with reviewed evidence. Keep every referenced artifact beneath that directory and record its SHA-256 checksum. Then run:

```text
npm run check:bonsai-cutover -- --manifest <owner-only-evidence-directory>/cutover-manifest.json
```

The command is read-only. It verifies the agreed parallel duration, complete operating and financial record scope, zero unresolved discrepancies, separate currency evidence, the full Stripe/email sandbox journey, backups and isolated restore, Cameron's post-evidence approval, the required artifact inventory, path containment, and every checksum. It reports only generic pass/fail messages and never disables Bonsai.

A passing report is necessary but does not perform or authorize the cutover. Cameron must still approve the exact cancellation, downgrade, or system-of-record mutation at action time. Preserve the passing report with the evidence package.

Historical Bonsai credit-card payments are classified as external/other evidence, not Ashbi Stripe payments. The importer does not estimate foreign exchange, combine CAD and USD, or infer customer tier from mixed-currency revenue.
