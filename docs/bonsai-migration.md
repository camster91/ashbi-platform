# Controlled Bonsai migration

The Bonsai migration is a one-way, evidence-preserving transfer into a dedicated Ashbi environment. It is not a live sync and it does not authorize retiring Bonsai.

## Required source

Export and retain these seven Bonsai CSV files together:

- the timestamped `connection_export` CSV shown as **Companies** in Bonsai
- `projects.csv`
- `invoices.csv`
- `time-entries.csv`
- `expenses.csv`
- `addresses.csv`
- the timestamped native `task_export` CSV, including `Task ID`, `Task Type`, and `Parent Task ID`

The importer records each file's row count and SHA-256 digest. It produces one combined source fingerprint and one plan fingerprint covering the exact source and planned outcomes.

Bonsai exposes two non-interchangeable task identities. Preserve the native `task_export` CSV for historical `task_…` identities, completed work, and parent/subtask relationships. Also capture current tasks through the authenticated Bonsai API into an immutable JSON snapshot using the contract in [bonsai-task-snapshot.example.json](bonsai-task-snapshot.example.json). The snapshot must cover `scope: "all"`, finish every pagination page, set `complete: true` only after the page count is verified, and include the API UUID, project ID, owner display name, dates, priority, and task status. The importer never guesses that a CSV task and API task are the same: displayed title/project overlaps, projectless rows, missing parents, and ambiguous project names remain findings. A missing native export or partial/active-only API snapshot is rejected.

Immediately after capture, verify the immutable API snapshot before using or reviewing it:

```text
npm run verify:bonsai-task-snapshot -- <bonsai-tasks.json>
```

The verifier is read-only. It requires the all-scope completion marker, a valid capture timestamp, explicit connector pagination evidence ending with `has_more: false`, an exact task count, unique API UUIDs, and every material task field. It reports capture integrity separately from migration readiness: source rows with blank titles or no project remain preserved but block `migrationReady`. A passing report validates internal snapshot integrity; it does not replace the native task export, authenticate a manually edited file, or prove parity with the Hub.

## Active project triage

Before deciding that an active Bonsai project is current, redundant, or ready for closure, bind the verified native project and task snapshots to the current project-group snapshot and native Notion/Bonsai project review:

```text
npm run prepare:bonsai-active-project-triage -- --bonsai-projects <bonsai-projects.json> --bonsai-tasks <bonsai-tasks.json> --project-groups <bonsai-project-groups.json> --native-project-review <native-project-review.json> --prepared-at <ISO> --output <new-active-project-triage.json>
```

The triage packet classifies every active project as an exact-link review, task-evidenced link review, suggested-link review, active project with tasks but no Notion link, or active project without current task evidence. It preserves stable Bonsai IDs, project groups, current task UUIDs and states, duplicate-title evidence, and the strongest bounded Notion evidence. A project without current tasks is not called stale or closure-ready. Every record explicitly retains pending invoice, payment, contract, and time-entry checks, and the packet grants no authority to create, link, move, complete, archive, delete, or bill anything. The command creates one owner-only file and refuses overwrite.

After generating the complete financial review and the all-source project disposition packet, prepare one operating outcome for every active Bonsai project:

```bash
npm run prepare:bonsai-active-project-disposition-decision -- --active-project-triage <triage.json> --financial-review <financial-review.json> --native-project-review <native-review.json> --project-link-decision <project-link-decision.json> --project-disposition-decision <project-disposition-decision.json> --prepared-at <ISO> --output <new-pending-active-project-decision.json>
npm run verify:bonsai-active-project-disposition-decision -- --active-project-triage <triage.json> --financial-review <financial-review.json> --native-project-review <native-review.json> --project-link-decision <project-link-decision.json> --project-disposition-decision <project-disposition-decision.json> --active-project-disposition-decision <active-project-decision.json>
```

The packet permits only an evidence-compatible active outcome: migrate active work to the Hub, retain it active in Bonsai, exclude it with evidence, or close it after full financial clearance. It cannot record any outcome while the relevant project identity or source disposition remains pending, cannot contradict that source disposition, and cannot record closure unless payment, contract, invoice, and time evidence explicitly authorize closure. It applies no outcome or external mutation. The current packet is checksum-valid with all 65 active-project outcomes pending and zero closure-authorized projects. Its SHA-256 is `ee836838732db38cee0118b4a20cac7131f01ef19cedb30baad6ee149a1e796e`.

Project identity approval is a separate gate from active-project disposition. Prepare and verify the native project-link packet from the exact native review as documented in [notion-markdown-migration.md](notion-markdown-migration.md). Its low-, medium-, and high-risk tiers cannot authorize project closure, task movement, owner assignment, billing changes, data migration, or Bonsai cutover. Generate the checksum-bound owner review brief before requesting a decision: the current brief identifies 17 approval-ready exact or approved task-backed candidates and leaves all seven similarity-only suggestions for manual evidence. A recommendation is not an approval. Similarity-only suggestions require explicit candidate IDs and cannot be blanket-approved.

Capture a sanitized, complete invoice and time-entry index before resolving the financial gates. The retained index excludes client email, invoice access tokens/URLs, invoice line descriptions, invoice titles, and time-entry notes. Verify both files, then enrich the exact active-project triage packet:

```text
npm run verify:bonsai-financial-index -- <bonsai-invoice-index.json> <bonsai-time-entry-index.json>
npm run prepare:bonsai-active-project-financial-review -- --active-project-triage <triage.json> --invoice-index <bonsai-invoice-index.json> --time-entry-index <bonsai-time-entry-index.json> --prepared-at <ISO> --output <new-financial-review.json>
```

The verifier requires complete pagination, unique source identities, valid dates/currencies/amounts, visible time billing fields, and the declared privacy omissions. Projectless financial rows remain linkage blockers without invalidating an otherwise complete capture. The review separates totals by currency, preserves invoice statuses, exposes unbilled time by project, and reports source evidence outside active projects. Invoice status is not treated as direct payment or settlement proof. A complete contract source is still required. Therefore every project remains closure-blocked, even when all observed invoices are paid and no unbilled time is present. The commands perform no provider, invoice, payment, time, contract, project, or Hub mutation.

Prepare a candidate-specific decision packet for every financial exception in the complete indexes and active-project contract review:

```text
npm run prepare:bonsai-financial-exception-decision -- --financial-review <financial-review.json> --invoice-index <invoice-index.json> --time-entry-index <time-entry-index.json> --prepared-at <ISO> --output <new-pending-financial-exception-decision.json>
npm run verify:bonsai-financial-exception-decision -- --financial-review <financial-review.json> --invoice-index <invoice-index.json> --time-entry-index <time-entry-index.json> --financial-exception-decision <financial-exception-decision.json>
```

The packet covers every non-paid invoice status, every unbilled time entry, and every active-project contract gap. Dispositions preserve the source status, require evidence for exclusion or no-contract attestation, and keep any resolve, assign, bill, mark-non-billable, or recapture outcome blocking until fresh evidence exists. A projectless time entry cannot be implicitly migrated as linked work. Recording a decision requires explicit confirmation, but no decision or command changes billing, collection, invoices, time, contracts, projects, Hub data, or cutover state. The current checksum-valid packet contains 117 pending exceptions: 38 non-paid invoices, 14 unbilled time entries including one projectless entry, and 65 active-project contract gaps. Its SHA-256 is `ad9f02219e78d874826ed9f45cede9a3988ac9aead9f3ea07fa49e3da7bd485e`.

## Live reconciliation status

After every source refresh, regenerate all downstream reviews and decisions before claiming the evidence is current. Then checksum-bind the aligned task review, task mapping decision, task-link decision, task-disposition decision, owner decision, native project review, project-link decision, project-disposition decision, active triage, financial review, active-project disposition decision, complete invoice/time indexes, and financial-exception decision:

```text
npm run prepare:bonsai-live-reconciliation-status -- --task-review <task-review.json> --mapping-decision <mapping-decision.json> --task-link-decision <task-link-decision.json> --task-disposition-decision <task-disposition-decision.json> --owner-decision <owner-decision.json> --native-project-review <native-project-review.json> --project-link-decision <project-link-decision.json> --project-disposition-decision <project-disposition-decision.json> --active-project-triage <triage.json> --financial-review <financial-review.json> --active-project-disposition-decision <active-project-decision.json> --invoice-index <invoice-index.json> --time-entry-index <time-entry-index.json> --financial-exception-decision <financial-exception-decision.json> --prepared-at <ISO> --output <new-live-status.json>
npm run verify:bonsai-live-reconciliation-status -- --task-review <task-review.json> --mapping-decision <mapping-decision.json> --task-link-decision <task-link-decision.json> --task-disposition-decision <task-disposition-decision.json> --owner-decision <owner-decision.json> --native-project-review <native-project-review.json> --project-link-decision <project-link-decision.json> --project-disposition-decision <project-disposition-decision.json> --active-project-triage <triage.json> --financial-review <financial-review.json> --active-project-disposition-decision <active-project-decision.json> --invoice-index <invoice-index.json> --time-entry-index <time-entry-index.json> --financial-exception-decision <financial-exception-decision.json> --status <live-status.json>
```

The command fails if any downstream artifact is bound to another Notion task, Bonsai task, Bonsai project, project-group, invoice, or time-entry generation. It reports migration and Bonsai-retirement readiness separately and keeps missing task-link decisions, owner decisions, project identities, source-only dispositions, duplicate titles, active-project dispositions, financial evidence, backup/parallel-run evidence, and final cutover approval explicit. It performs no external write and cannot authorize migration or retirement.

The current 2026-08-28 UTC status is source-generation aligned but not migration- or retirement-ready. It contains nine blocking findings and has SHA-256 `293064af8bee059d011fd1728eeb94ae859660ed97607ee0bb510e25f4daf83e`. All five mapping candidates, all 20 task identities, and all 20 source-backed owner candidates are recorded—19 Cameron and one Bianca—without applying mappings, links, or assignments. The task-disposition record keeps all 48 source-only or malformed task decisions pending; the complete project-disposition record keeps all 238 source-project and duplicate-title decisions pending behind the 24 project-link decisions; all 65 active-project operating outcomes remain pending with zero closure authorization; and all 117 financial exceptions remain pending. Title, source status, and source evidence are not approval. Earlier live-status files remain immutable historical evidence and are superseded for current decisions.

The Companies export is a mixed CRM connection population, not a client list. The importer accepts its observed `Name`, `Email`, `Domain`, and related profile columns only through `--connections-csv`. It promotes a connection to a client contact only when the row has an exact operational client name from the project/invoice sources or an exact invoice email. Unrelated leads, vendors, and domains remain outside the client import; a row that points to different clients by name and email, conflicting duplicate emails, or an ambiguous primary contact remains an unresolved finding. The untouched timestamped filename, row count, headers, and checksum remain in the source fingerprint. A legacy `clients.csv` is still understood for recovery of older evidence, but it is not the current Bonsai contract.

## Dry run

```text
node scripts/import-bonsai-full.js --dry-run --organization-id <sandbox-org-id> --connections-csv <connection-export.csv> --projects-csv <project-export.csv> --tasks-csv <task-export.csv> --tasks-json <bonsai-tasks.json> --invoices-csv <invoice-export.csv> --time-entries-csv <time-export.csv> --expenses-csv <expense-export.csv> --addresses-csv <addresses.csv> --summary-file <new-dry-run-report.json>
```

The report is created once with owner-only permissions. Review every source count, mapped owner, create/match/skip count, and reconciliation finding. A missing file, malformed or over-precise financial value, unsupported currency/status, conflicting Hub record, or incomplete financial/date evidence must be resolved at the source or reviewed manually; the importer does not partially parse, guess, or overwrite it.

## Confirmed sandbox import

After an approved backup and human review of a clean dry run, use the exact unchanged CSV directory and reference that dry-run report:

```text
node scripts/import-bonsai-full.js --confirm --organization-id <sandbox-org-id> --connections-csv <connection-export.csv> --projects-csv <project-export.csv> --tasks-csv <task-export.csv> --tasks-json <bonsai-tasks.json> --invoices-csv <invoice-export.csv> --time-entries-csv <time-export.csv> --expenses-csv <expense-export.csv> --addresses-csv <addresses.csv> --approved-summary <reviewed-dry-run-report.json> --summary-file <new-live-report.json>
```

The confirmed import refuses to start without the reviewed report. It rolls back if the tenant, CSV fingerprint, destination plan, required inventory, or reconciliation findings differ from the approved dry run. Existing Hub clients, projects, and invoices are compared and never automatically overwritten. A matching record with different evidence is a manual reconciliation finding.

## Parallel-run exit

1. Rerun the same export as a dry run and prove no duplicate creation.
2. Compare clients, active projects, tasks, statuses, owners, invoice totals by currency, time, and expenses between Bonsai and the Hub.
   Export the Hub workspace after the parallel run, retain the exact timestamped Connections export plus `projects.csv`, `invoices.csv`, `time-entries.csv`, and `expenses.csv`, and run `npm run reconcile:bonsai-operations -- --organization-id <id> --bonsai-connections <connection-export.csv> --bonsai-invoices <invoices.csv> --bonsai-projects <projects.csv> --bonsai-time-entries <time-entries.csv> --bonsai-expenses <expenses.csv> --workspace-export <workspace.json> --completed-at <ISO> --output <new-operations-report.json>`. The workspace must use export version 3, which adds bounded staff identity, time-entry, and expense evidence without exporting staff email/password/role or expense notes/receipts. The command reads all six sources without changing them, applies the same project/invoice-evidenced Connections mapper as the importer, rejects ambiguous client/contact/project/staff identities and duplicate operating-ledger identities, and preserves every missing record or field difference as an unresolved finding. Personal and Cameron e-transfer expense rows follow the importer's explicit exclusion rule and remain represented in the source file checksum and total row count. [operations-reconciliation.example.json](operations-reconciliation.example.json) documents the output contract.
   Against the same workspace export, run `npm run reconcile:bonsai-tasks -- --organization-id <id> --bonsai-tasks <bonsai-tasks.json> --bonsai-task-history <task-export.csv> --bonsai-projects <projects.csv> --workspace-export <workspace.json> --completed-at <ISO> --output <new-task-report.json>`. The command binds both task sources and the exact project export. API tasks match only immutable UUIDs; historical tasks match only native `task_…` IDs. It verifies project, owner, status, priority, schedule, source evidence, and parent relationships, while leaving projectless, duplicated, overlapping, missing, or changed tasks unresolved. [task-reconciliation.example.json](task-reconciliation.example.json) documents the report contract.
   Download the Hub's admin-only revenue evidence artifact and run `npm run verify:revenue-evidence -- <artifact.json>` before comparing invoice, payment, refund, delivery, and settlement records. Preserve both the artifact and verifier output.
   Generate the report directly from the retained `invoices.csv` and Hub revenue artifact: `npm run reconcile:bonsai-revenue -- --organization-id <id> --bonsai-invoices <invoices.csv> --revenue-export <revenue.json> --completed-at <ISO> --output <new-parallel-report.json>`. The command reads both sources without changing them, creates a new owner-only report without overwriting prior evidence, and exits non-zero while any invoice, payment, duplicate, currency, status, or amount finding remains. [parallel-reconciliation.example.json](parallel-reconciliation.example.json) documents the output contract.
3. Run at least one complete proposal-to-payment sandbox journey and retain provider evidence.
4. Keep Bonsai available and unchanged through the agreed parallel period.
5. Retain the source export, both reports, database backup, checksums, exception decisions, and reviewer sign-off.
6. Retire Bonsai only after Cameron explicitly approves the financial cutover at action time.

## Machine-verified cutover gate

Copy [bonsai-cutover-manifest.example.json](bonsai-cutover-manifest.example.json) to `cutover-manifest.draft.json` inside the owner-only evidence directory and replace every pending non-checksum value with reviewed evidence. Keep every referenced artifact beneath that directory; do not calculate or paste hashes manually. Prepare a new manifest from that draft:

```text
npm run prepare:bonsai-cutover-manifest -- --evidence-dir <owner-only-evidence-directory> --draft cutover-manifest.draft.json --output <owner-only-evidence-directory>/cutover-manifest.json
```

The preparation command requires the exact artifact inventory, resolves real file locations so symlinks cannot escape the evidence directory, calculates every SHA-256 checksum, preserves the draft approval state, creates an owner-only output, and refuses to overwrite prior evidence. It does not approve or perform an import, cutover, cancellation, billing action, or provider mutation. Then run:

```text
npm run check:bonsai-cutover -- --manifest <owner-only-evidence-directory>/cutover-manifest.json
```

The command is read-only. It verifies the agreed parallel duration, complete operating and financial record scope, zero unresolved discrepancies, separate currency evidence, the full Stripe/email sandbox journey, backups and isolated restore, Cameron's post-evidence approval, the required artifact inventory, path containment, and every checksum. The version 3 operating report must bind the exact retained Bonsai Connections, project, invoice, time-entry, and expense sources to an internally valid tenant workspace export version 3, its internal record checksum, and all nine collection counts, including users, time entries, and expenses. The separate version 2 task report must bind the complete all-scope API task snapshot, native historical task CSV, and project CSV to that same exact workspace artifact and all collection counts; listing `tasks` in the manifest is not accepted as evidence by itself. Legacy operations reports remain useful recovery evidence but cannot satisfy cutover readiness. The final revenue artifact must match the manifest's Ashbi organization, pass its internal verifier, and be exported after the parallel run ends but before evidence is finalized. The parallel report must reference the exact retained Bonsai `invoices.csv` checksum, revenue file checksum, internal record checksum, and every collection count; a report copied from another source or export cannot pass. The command reports only generic pass/fail messages and never disables Bonsai.

A passing report is necessary but does not perform or authorize the cutover. Cameron must still approve the exact cancellation, downgrade, or system-of-record mutation at action time. Preserve the passing report with the evidence package.

Historical Bonsai credit-card payments are classified as external/other evidence, not Ashbi Stripe payments. The importer does not estimate foreign exchange, combine CAD and USD, or infer customer tier from mixed-currency revenue.
