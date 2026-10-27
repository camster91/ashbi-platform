# Bounded source reconciliation pilot

This offline tool prepares **one proposed client/project mapping** across pinned source files. It does not import records, validate current D1 ownership, create users/grants, upload files, reconstruct missing history or invoke Stripe. Every offline report has `migrationReady:false`, `targetWrites:0` and no external effects. The separate internal D1/R2 writer described below now exists and has synthetic coverage; neither the report nor that coverage proves a company migration or cutover. #414 remains Preparation.

Run the synthetic contracts from `apps/workspace`:

```sh
npm run test:pilot
```

The tests construct only synthetic sources in fresh local temporary directories. They exercise the actual repository directory-export verifier and CLI, without a database, credentials, provider calls, browser or production source access. The original application/compiled/browser/recovery suites remain retained.

## Input contract

The input folder contains three quiescent, operator-controlled directories: `notion/`, `bonsai/` and `legacy/`. The explicit mapping is a separate JSON file. The CLI can write an exclusive private report **outside the source tree**, including its real filesystem aliases:

```sh
node pilot-reconcile.mjs --input /private/pilot-sources --mapping /private/proposed-mapping.json --report /private/new-reconciliation.json
```

This is the command shape, not authorization to read company exports. Current verification uses synthetic material only. The output parent must already exist. Existing reports are never overwritten; stdout contains only fingerprint, counts and readiness/write flags. Error output contains only a stable code. The detailed JSON report can contain private source content and must stay in an appropriate private folder, outside Git and CI artifacts/logs. A report is not a backup and cannot replace retained originals.

The bounded profile accepts at most 128 filesystem entries, 16 levels, 16 MiB per file and 64 MiB per source directory, with at most 200 reconciliation units. These are explicit pilot limits, not silent pagination or truncation. Links and special files are refused before the existing source readers run. Each source inventory is pinned by exact path, bytes and SHA-256; the complete inventories are checked again after reading. Report ordering uses explicit path order rather than runtime locale collation. Keep the private staging folder quiescent; this is not a sandbox against an attacker concurrently replacing OS directory trees.

Reuse is deliberate: `scripts/inventory-migration-source.mjs` inventories Notion/Bonsai; `buildNotionMarkdownImportPlan` preserves parent-first literal export paths; `verifyWorkspaceExportDirectory` checks the pinned legacy directory manifest, checksums and original files. Their existing implementations remain unchanged. The pure format helpers have no Prisma/logger/config dependency. They validate strict quoted/multiline CSV, exact decimal lexemes and seconds, real calendar dates/explicit offsets, duplicate JSON keys and unsafe numbers. A runtime without native JSON numeric source lexemes fails closed.

The Bonsai profile pins the **six CSV schemas already consumed by this repository**: `clients.csv`, `addresses.csv`, `projects.csv`, `invoices.csv`, `time-entries.csv`, `expenses.csv`. It is not a claim that every current vendor export has these columns. Header differences, field counts and malformed CSV require review. Unknown files are held whole. Notion Markdown preserves literal content and hierarchy; its key is an export path, **not proof of a durable Notion page ID**. Database exports and unknown artifacts are held whole with contained row count unknown. Empty/oversized documents and local link/attachment semantics requiring resolution are held rather than truncated or rewritten.

The legacy input is the repository's actual `ashbi-workspace-export-directory` version 1: manifest, complete checksum list, per-entity JSONL and original attachment bytes. A byte-valid archive with declared export exceptions is still blocked. Its exclusions must be explicitly fingerprinted in the mapping and are retained in the report; that acknowledgement is not proof the excluded history is migrated. Unknown entity rows and orphan original files become explicit held outcomes. Missing originals and invalid manifests never become a valid plan.

## Mapping and report meaning

`makePilotFixture()` in `pilot-source-fixture.mjs` supplies the complete **synthetic** mapping shape and source schemas used by the contracts. It includes target organization/client/project IDs; exact source client/project scope; complete file pins; an independently pinned legacy manifest and exclusions; explicit source-owner to proposed staff mappings; canonical client/project authorities; and per-record keys, file hashes, proposed canonical IDs, explicit visibility, metadata assertions and MAP/HOLD decisions. HOLD needs a reason. Missing/duplicate/orphan decisions, stale hashes, ambiguous label identities and canonical collisions require review. No fuzzy name/email merge or owner fallback occurs.

A `MAPPED` unit is only a **proposed source mapping**. Target existence, tenancy, staff roles/grants, current revocations, identity overlap and write conflicts have not been verified in D1. Candidate entries say `PROPOSED_NOT_TARGET_VERIFIED`. An unmapped canonical authority prevents a coherent candidate set. Unsupported whole artifacts count as one reconciliation unit, not a claim about how many rows or pages they contain. Normal synthetic evidence covers 19 units: 17 proposed mappings and two held units (Notion database artifact and legacy staff identity). Neither is permission to create an account or grant.

Raw source rows/content and original-file hashes remain in the report; exact legacy JSON text remains alongside its parsed image so a rounded JavaScript number cannot replace the lexical source. Exported dates retain original precision/offset; date-only values never acquire an invented midnight/timezone. Operator-supplied metadata and time currency are labelled assertions, separate from exported facts. Markdown alone does not establish original authors/timestamps/ACLs; those gaps must be resolved or explicitly retained as unknown before an approved write. Unknown source values remain unknown, including nullable invoice due dates and unexported Bonsai subtotals.

Legacy note ACLs/barriers that cannot be represented stay held; TEAM notes are not broadened into client sharing. Source owner organization and staff role must be proven before a proposed staff identity is used. Scoped child/payment relationships cannot cross clients/projects/organizations. Historical users retain original role/activity facts but never become new accounts/grants.

Historical time retains exact seconds (legacy minutes converted explicitly, Bonsai HH:MM:SS without minute truncation), source dates, original owner, billing/review flags and references. It does not invent timer intervals, new approval journals or fresh source claims. Unknown rate/currency on unbillable legacy history remains null. Billable amounts/currencies that cannot be resolved are held.

Historical invoice/payment/expense values are evidence only: `HISTORICAL_ONLY`, never eligible for a provider action. Exact nonnegative decimal minor units use BigInt bounds and reject sub-cent precision, exponent notation or unsafe totals without rounding. Negative/unsupported currencies or records remain held with their raw evidence. The legacy aggregate identity follows the existing consumer: total = max(0, subtotal - stored discount) + reported tax; historical tax is not recomputed from its percentage. Reported payment rows and Bonsai paid summaries remain source facts, not proof of a current Stripe outcome.

Totals include **mapped valid reported rows only**, separately by source and CAD/USD. Held financial record keys remain explicit in coverage. Overlapping Bonsai and legacy ledgers are never summed into a combined balance. Zero cannot stand in for an unexported subtotal. Current fixtures deliberately prove the same CAD history can appear in both sources without being billed or aggregated twice.

## Implemented internal write and history boundary

[`applySourcePilot`](source-pilot.mjs) consumes trusted, pinned input separately from the offline CLI. Migration [`0021.sql`](migrations/0021.sql) stores immutable run, record and object provenance. The writer checks current financial authority and canonical client/project revisions, reserves a durable run, verifies private original bytes, and commits bounded canonical work and retained source history. Identical retries return the original receipt; conflicting input or target state is rejected. Historical financial and signing facts remain history rather than new time approvals, invoices, signatures or provider operations.

`npm run test:source-pilot` exercises the actual disposable D1/R2 writer, interruptions, retries, conflicts, authority changes, source fidelity and exact originals. [`source-pilot.test.mjs`](source-pilot.test.mjs) also exercises authenticated `/api/source-history` list, record and original-download reads. These are financial-staff reads under current canonical scope; there is no HTTP report-upload or apply endpoint. A client cannot read this staff source history. The compiled wrapper [`source-history-built.test.mjs`](source-history-built.test.mjs) and [`recovery.test.mjs`](recovery.test.mjs) cover built-handler reads and isolated restoration of the committed history and originals. See [RECOVERY.md](RECOVERY.md) for the complete recovery boundary.

## Next gate

Before writing even a company staging import, retain the reviewed source package and independent pins, resolve held records and original metadata/ACL gaps, reconcile aliases and historical money, and verify the exact target state/identities. Review the bounded invocation of the existing internal writer for that exact package; do not expose its trusted-input boundary as an untrusted apply endpoint. Rehearse source deltas, conflicts, authenticated reads, original-byte recovery and reconciliation against the selected target before an approved company run. Synthetic coverage is not approval of real mappings, complete vendor-export coverage or hosted recovery.

Company source access/export, remote migration, new grants/invitations/messages, real signatures/provider actions, deployment, source cancellation and final cutover require their existing separate approvals. PR #684 stays open and Coolify stays unchanged.

## Faithful current work statuses

Migration `0027.sql` retains existing project/task rows and their references while expanding status constraints. Tasks preserve To do, In progress, Review, Waiting, Later, Done, Retired and Archived independently. Projects preserve Planned, Active, Waiting, Complete and Canceled. The internal writer accepts explicit normalized `PENDING`, `IN_PROGRESS`, `REVIEW`, `WAITING`, `LATER`, `COMPLETED`, `RETIRED` and `ARCHIVED`; unknown statuses still fail closed. Source aliases require an explicit reconciliation mapping. Dashboard open work includes review, waiting and later; later work is excluded from overdue warnings, and retired/archived work is excluded from open work and completion shortcuts. All states remain individually filterable in Tasks and Overview.
