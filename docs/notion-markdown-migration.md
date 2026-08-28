# Controlled Notion Markdown migration

Ashbi supports a **one-way, controlled import** of a selected Notion Markdown
export into one existing Ashbi project. It is not a live Notion sync and does
not authorize writing back to Notion.

## Current Projects and Tasks inventory

The selected Markdown import does not prove that Ashbi's operating Projects and Tasks were inventoried. Capture the current `Projects & Tasks` hub through the authenticated Notion connector and retain one immutable JSON snapshot containing the complete Projects and Tasks queries. The current source identities are deliberately distinct from the data sources titled `Archive — Projects (legacy automation)` and `Archive — Tasks (legacy automation)`.

Verify the inventory before using it as migration evidence:

```text
npm run verify:notion-operating-snapshot -- <notion-projects-tasks.json>
```

The verifier is read-only. It binds the current hub, database and data-source identities; rejects the archived automation sources; requires complete query evidence; and verifies unique project/task identities, supported statuses, and exactly one existing project relation per task. This inventory does not write to Notion, replace the original Markdown export, prove Hub parity, or authorize a confirmed import.

Before consolidating the two source systems, compare the checksummed Notion inventory with the complete Bonsai all-scope task snapshot:

```text
npm run compare:notion-bonsai-tasks -- --notion <notion-projects-tasks.json> --bonsai <bonsai-tasks.json> --completed-at <ISO> --output <new-comparison.json>
```

The comparator creates one owner-only report without changing either system. It accepts only internally valid source snapshots, matches only unique exact task titles, and preserves source-only tasks, project-title differences, lifecycle differences, and Bonsai source-review findings. It never treats the report as Hub parity or authorizes a merge.

Turn the raw comparison into a bounded review packet before making mapping decisions:

```text
npm run prepare:notion-bonsai-task-review -- --notion <notion-projects-tasks.json> --bonsai <bonsai-tasks.json> --prepared-at <ISO> --output <new-review.json>
```

The packet keeps exact task links separate from project-alias candidates, near-title candidates, source-only tasks, and malformed/projectless Bonsai records. Near-title similarity is review evidence only and is never applied. Bonsai assignees are summarized as source evidence; they are not silently copied to Notion or the Hub. The command creates one owner-only file, refuses overwrite, and performs no external or database writes.

Prepare the pending project-alias and near-title decision batch from that exact packet:

```text
npm run prepare:notion-bonsai-mapping-decision -- --review <review.json> --prepared-at <ISO> --output <new-pending-decision.json>
npm run verify:notion-bonsai-mapping-decision -- <review.json> <decision.json>
```

The pending record is checksum-bound to the review packet and both source snapshots. It cannot authorize owner assignments, source-only dispositions, migration writes, or financial cutover. After an explicit human decision, a separate immutable finalized record may be created with `--approve-all` or `--reject-all`, the approver, decision time, evidence reference, and `--confirm`. That command only records the decision; it still does not apply mappings or change an external system.

Record task identity independently from project mapping and ownership:

```text
npm run prepare:notion-bonsai-task-link-decision -- --review <review.json> --prepared-at <ISO> --output <new-pending-task-link-decision.json>
npm run verify:notion-bonsai-task-link-decision -- --review <review.json> --task-link-decision <task-link-decision.json>
```

The task-link packet includes every exact and near-title source pair, with separate direct-exact, project-dependent exact, and near-title tiers. Decisions are candidate-specific; there is no blanket approval flag. Approving a conditional candidate requires the checksum-valid mapping record containing that exact approved project alias or near-title dependency. A task-link decision means only that two source IDs identify one logical task. It does not apply a link, move or create a task, change task fields, assign an owner, delete a source record, migrate data, or authorize cutover. The current owner-only packet has 20 pending decisions: 13 direct exact, six project-dependent exact, and one near-title. Its SHA-256 is `bac0e909753889486be76cf7b547bab94873736abe7a7c8895933e8ab74c8aaf`.

Prepare the source-only and malformed-task disposition packet separately:

```bash
npm run prepare:notion-bonsai-task-disposition-decision -- --review <review.json> --prepared-at <ISO> --output <new-pending-task-disposition-decision.json>
npm run verify:notion-bonsai-task-disposition-decision -- --review <review.json> --task-disposition-decision <task-disposition-decision.json>
```

The packet separates Notion-only, structurally valid Bonsai-only, and malformed/projectless Bonsai records. Each candidate must independently be marked for migration, source retention, evidence-backed exclusion, source repair and recapture, or evidence-backed manual mapping as allowed for that source kind. Every non-pending choice requires its own rationale and evidence reference plus the batch approver and timestamp. No choice deletes, repairs, creates, moves, or migrates a source record. The current owner-only packet is checksum-valid with all 48 decisions pending: 24 Notion-only, 19 Bonsai-only, and five Bonsai source-review records. Its SHA-256 is `aa406c72835d7f664fc63469752d5d16551bac74de3c8854b024d6cb59defc2c`.

Prepare source-backed owner decisions separately:

```text
npm run prepare:notion-bonsai-owner-decision -- --review <review.json> --prepared-at <ISO> --output <new-pending-owner-decision.json>
npm run verify:notion-bonsai-owner-decision -- --review <review.json> --owner-decision <owner-decision.json>
```

This packet includes only Notion tasks with one exact or review-candidate Bonsai task carrying a named assignee. It distinguishes direct exact-task/project evidence from assignments conditional on the separately approved mapping packet. A batch owner approval cannot pass until the exact task-link packet is checksum-valid and fully approved; conditional links must also have their mapping dependencies approved. Unmatched Notion tasks, unassigned Bonsai tasks, project/account-owner defaults, and inferred creative/technical ownership remain outside the packet. The current pending owner packet has SHA-256 `4305596ab4dcc0ffe447e61330052de6ca692ee96f5e360ff9fd1e7290b200ae`.

Review projects separately from tasks:

```text
npm run prepare:notion-bonsai-project-review -- --notion <notion-projects-tasks.json> --bonsai <bonsai-tasks.json> --prepared-at <ISO> --output <new-project-review.json>
```

The complete Bonsai task snapshot can prove only the distinct project titles referenced by those tasks. This preliminary owner-only report therefore separates exact project titles, aliases supported by shared exact tasks, near-title task evidence, unmatched titles, and similarity-only suggestions while explicitly marking its Bonsai project inventory incomplete.

Capture and verify the native all-status project inventory, then bind it to the same Notion and task-review evidence:

```text
npm run verify:bonsai-project-snapshot -- <bonsai-projects.json>
npm run prepare:notion-bonsai-native-project-review -- --notion <notion-projects-tasks.json> --bonsai-projects <bonsai-projects.json> --task-review <task-review.json> --prepared-at <ISO> --output <new-native-project-review.json>
```

The native snapshot verifier requires complete all-status pagination, a complete active/completed/archived partition, unique stable IDs and public tokens, valid project records, and client identity evidence. The native review resolves only unique exact titles and previously captured task evidence; it keeps lifecycle differences, duplicate Bonsai titles, source-only projects, and one strongest lifecycle-compatible similarity suggestion per unmatched Notion project as review items. Similarity never creates a link. Both commands are read-only with respect to Notion, Bonsai, and the Hub; the review command creates one owner-only file and refuses overwrite.

Turn the native project review into a tiered, checksum-bound identity decision packet:

```text
npm run prepare:notion-bonsai-native-project-link-decision -- --review <native-project-review.json> --prepared-at <ISO> --output <new-pending-link-decision.json>
npm run verify:notion-bonsai-native-project-link-decision -- <native-project-review.json> <link-decision.json>
```

The packet separates exact unique titles, task-evidenced candidates, and similarity-only suggestions. Every candidate has a stable Notion source URL, Bonsai project ID, evidence tier, risk tier, and independent decision. Recording decisions requires a JSON manifest naming each candidate ID, `--confirm`, an approver, decision time, and evidence reference; there is deliberately no blanket approve-all flag. Approval means only that the two source IDs represent the same logical project. It does not create or apply a link, move tasks, assign owners, change lifecycle, delete source records, affect invoices/payments/contracts/time, migrate data, or authorize cutover.

The current owner-only 2026-08-28 UTC packet is valid and incomplete: all 24 decisions remain pending, comprising 12 exact-title, five task-evidenced, and seven suggestion-only candidates. It is bound to the refreshed task-review generation and has SHA-256 `98346551f2f7da832e944dec2bf333544c00307ac75ccd80bf06061a3245c75f`. The earlier packet remains immutable historical evidence and is superseded for current decisions.

## Supported input

- UTF-8 `.md` pages from a Notion export;
- nested-page hierarchy when Notion's exported child folder corresponds to its
  parent Markdown page; and
- plain Markdown page content imported as Ashbi `DOC` notes.

Each page receives a stable source key based on its relative export path. Ashbi
records that key, content SHA-256, target project, created note, and latest
outcome in `notion_import_records`. Re-running the same source does not create
another note.

## Deliberately blocked or reported

- attachments, images, databases, CSVs, and other non-Markdown export files;
- an empty Markdown page;
- a child whose exported parent page is absent;
- a source page whose content changed after a prior controlled import;
- a previously imported source whose target note was removed; and
- an existing, unmapped Ashbi note with the same target title and parent.

These conditions are reconciliation findings, not automatic overwrites. The
report remains incomplete until they are reviewed and resolved.

## Pilot procedure

1. Export a sanitized, representative project from Notion and retain the
   original export securely.
2. Take an approved Ashbi backup and record its manifest/checksum.
3. Run the importer without `--confirm`, writing a new report file:

   ```text
   node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <Notion-export> --summary-file <new-report.json>
   ```

4. Review the exact planned hierarchy, unchanged records, conflicts,
   unsupported files, and errors. Do not proceed if the report is incomplete.
5. After a human reconciliation approval, repeat with `--confirm`, the exact
   reviewed dry-run report, and a new report filename:

   ```text
   node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <Notion-export> --confirm --approved-summary <reviewed-dry-run-report.json> --summary-file <new-live-report.json>
   ```

   The importer verifies the tenant, project, SHA-256 fingerprint of every
   exported file, and the destination plan. The live writes run in one database
   transaction and roll back completely if the source, plan, or any
   reconciliation finding differs from the approved dry run.
6. Rerun the same dry-run, compare record/note counts and hierarchy, then
   perform the authenticated editing and recovery checks before retiring the
   Notion workspace.

The report file is reserved before database work and created once with
owner-only permissions. Do not reuse or overwrite a prior report; retain it
with the exact source export, approved dry run, confirmed report, and related
backup evidence.
