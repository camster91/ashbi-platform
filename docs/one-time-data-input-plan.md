# One-time Ashbi data input

This plan follows Cameron's features-first decision for one shared Ashbi Design/Freelance organization. It does not authorize data writes, production deployment or source retirement. Existing importer playbooks are historical implementation references, not the chosen execution path for this consolidation.

## Prerequisites and evidence

Finish and accept the required workflows in [replacement readiness](replacement-readiness-matrix.md) and issue #565 before input. Local tests and CI establish code behavior; populated target acceptance, provider checks and backup recovery establish operating readiness. Preserve the current production hold until the owner lifts it. Keep source snapshots private and identify unavailable source content explicitly; never describe partial collections as a complete migration.

Prepare one private reconciliation ledger with source reference, entity class, source identity, canonical target identity, action (create, match, exclude or unresolved), portfolio, owner, field mapping, required relationships, reviewer and result. This is a bounded operational artifact, not a reusable importer or synchronization service. Preserve original references in supported source-reference fields or a private ledger; do not overload client names or invoice numbers with tracking data.

## Input order and fidelity gates

| Order | Entity | Review before entry | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Team and clients/contacts | Active staff identities, duplicate client/contact matches, existing target IDs and client access | Canonical IDs persist; no duplicate client per portfolio; internal records stay hidden from clients |
| 2 | Projects and boards | Canonical client, agency/freelance/unclassified portfolio, accountable owner, collaborators, stage/view/template mapping | Shared team can use both portfolios; changing views leaves tenancy, owners and clients intact |
| 3 | Tasks and structured records | Source stages, dates/timezones, typed values, relations, dependencies, collaborators and recurrence | Counts and relationships match the approved rows; no unintended catch-up work or completion-triggered duplicates |
| 4 | Knowledge and files | Hierarchy, templates, author attribution, Markdown fidelity, mentions, available file bytes/checksums and approved missing-content exclusions | Search/edit/reload/restore work; file access and checksums verified; historical input sends no mention notifications |
| 5 | Time and expenses | Source dates, minutes, owner, project, currency, approval and invoiced state, receipt ownership | Time totals per owner/project/date and expenses per currency match; no previously invoiced item becomes billable again |
| 6 | Financial and contractual history | Issuer identity, original invoice/contract numbers, currency, tax, line items, status, payment references, signature evidence and historical PDFs | Money reconciles per currency and issuer; historical documents remain historical; no new Checkout link, email, reminder, signature request or charge |

Never force a historical row through a create endpoint that replaces an original date, author, number, issuer or payment state. First verify that the finished app/API supports the approved fields and side-effect controls. Unsupported mappings remain unresolved feature work. Do not change historical numbers or represent archived signed PDFs as newly signed contracts merely to make input succeed.

## Disposable rehearsal

Use a separately identified, disposable staging database and storage namespace with synthetic accounts and no live delivery/payment credentials. Select a reviewed representative batch containing both portfolios, an existing shared client, a nested document, every required typed field, a dependency, recurrence, approved/invoiced time, mixed currencies and a historical signed document. Record before-state counts and identifiers. Enter the batch through the finished app/API, then verify persisted data and the same UI/API/MCP journeys used for acceptance.

Repeat the same reviewed batch against staging and prove it matches existing canonical records instead of creating duplicates. A private operator ledger can track completed rows; retry only confirmed failed rows after reading current target state. An unknown network outcome is not evidence that the row was not created. Record duration, rejected rows, count deltas, orphan relationships, owner mismatches, inaccessible files and monetary differences. A difference in money, tenancy, owner or relationship blocks the batch until resolved.

Prove the no-delivery boundary with synthetic receiver/provider assertions and queued-job inspection. Do not assume missing credentials alone prove there were no scheduled reminders or notifications. Recurrence and automations must have an approved activation policy before historical data enters a target that has active workers.

## Production review and execution

The owner reviews the exact target revision, target organization, approved private mapping ledger, included/excluded source ranges, unresolved gaps, batch sizes, worker/automation behavior, encrypted backup checksum, isolated restore result, storage/files backup and rollback procedure. That review is a separate production action gate; this plan does not lift the existing hold.

After explicit approval, record a fresh target before-state and use only the reviewed batch and revision. Reconcile after each dependency layer. Stop on any discrepancy and retain evidence; do not rerun a whole layer speculatively. Rollback must cover database state and files together and preserve unrelated work. Staging must rehearse the actual recovery procedure before production input, rather than assuming a backup file is sufficient.

## Team acceptance and cutover

Bianca and Cameron should verify representative shared agency/freelance workflows, mobile/keyboard use, scoped ChatGPT/MCP access, client visibility, finances and document recovery. Record specific accepted workflows and remaining exclusions. Cut over only the accepted workflows on an explicitly approved date. Retain read-only sources and exports until ownership, retention and fallback decisions are signed off. Source retirement, client communications and billing activation require their own authorization.

Current status: plan prepared; mappings not approved, rehearsal not run, no production input or source retirement performed.
