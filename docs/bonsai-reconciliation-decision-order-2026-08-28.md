# Bonsai reconciliation decision order

**Evidence date:** 2026-08-28

**Verified status artifact:** `bonsai-live-reconciliation-status-v11.json`

**Result:** The checksum-bound evidence chain is valid. Migration readiness and Bonsai retirement readiness are both false.

This runbook separates evidence decisions from applied source changes, Hub imports, financial actions, and Bonsai retirement. Recording a decision never authorizes the corresponding mutation.

## Current decision state

| Layer | Total | Current state | Effect |
| --- | ---: | --- | --- |
| Task mapping candidates | 5 | Decisions recorded | Evidence only; no task link applied |
| Task identity candidates | 20 | Decisions recorded | Evidence only; no task link applied |
| Owner candidates | 20 | Decisions recorded: 19 Cameron, 1 Bianca | Evidence only; no owner changed in Bonsai or Hub |
| Project identity candidates | 24 | Pending; all 24 approval-ready | Blocks 48 project dispositions |
| Task source dispositions | 88 | Pending; all 88 approval-ready | 40 resolved by approved identity, 43 migrate-to-Hub, 5 repair-and-recapture classifications |
| Project source dispositions | 238 | Pending | 190 approval-ready; 48 blocked by the 24 project identities |
| Active-project outcomes | 65 | Pending and blocked | Zero project closures are recommended or authorized |
| Financial exceptions | 117 | Pending | 51 approval-ready; 65 contract gaps blocked; 1 projectless time entry requires manual review |

The source-backed owner layer contains 20 candidates, not 29. The verified evidence records all 20 decisions, while all external records remain unchanged.

## Required decision order

### 1. Record the 24 project identity decisions

Review the checksum-bound project-link brief as three visible tiers:

- 12 unique exact-title candidates
- 5 task-evidenced candidates
- 7 evidence-strengthened suggestions

All 24 are approval-ready with zero manual-review candidates. Approval records identity decisions only. It must not merge, archive, rename, import, change lifecycle, or change financial data.

After recording them, regenerate and verify the live status. Do not assume the 48 dependent project dispositions became ready until the successor packet proves it.

### 2. Record the 88 task source dispositions

The complete task packet covers both sides of every identity and every unmatched record:

- 40 source records resolved by the 20 approved task identities
- 43 valid unlinked records recommended for later Hub migration
- 5 malformed or projectless Bonsai records classified for source repair and fresh recapture

This step records classifications only. The five repairs are later Bonsai mutations and require exact target review and action-time authorization.

### 3. Regenerate and record all 238 project source dispositions

The current packet has 190 approval-ready and 48 blocked candidates. After step 1, generate a successor bound to the newly recorded project identities, verify its checksums and complete source coverage, and then review all resulting dispositions.

Never consolidate duplicate titles by name alone. Retain distinct source IDs unless the evidence-specific disposition explicitly maps the members.

### 4. Resolve source-repair and linkage exceptions

Before a sandbox import:

- repair and recapture the five Bonsai task records classified in step 2;
- resolve the one projectless time entry without guessing a client or project;
- re-capture any source changed after the 2026-08-28 snapshots;
- regenerate every downstream artifact whose bound source checksum changed.

### 5. Review all 65 active-project outcomes

Active-project outcomes remain blocked until project identity and source-disposition decisions are complete. Absence of current tasks is not proof that an engagement is inactive. No project can be closed or archived from the current evidence because zero projects have complete financial clearance.

### 6. Review financial exceptions separately

Keep financial review outside operational identity approval:

- 38 non-paid invoices can preserve their exact source status for later sandbox migration;
- 13 linked unbilled time entries can preserve their exact unbilled state;
- 1 projectless time entry requires manual linkage evidence;
- 65 active projects lack complete contract evidence and remain blocked.

Invoice status is not direct payment or settlement evidence. No decision can bill, collect, refund, change a payment, attest to a contract, or authorize cutover.

### 7. Execute only in an approved isolated sandbox

After every decision layer is complete and regenerated against the same source generation:

1. take and verify recoverable source and target backups;
2. import the checksum-bound bundles into an isolated tenant using confirmed, idempotent commands;
3. reconcile clients, projects, tasks, owners, invoices, time, expenses, contracts, and direct payment evidence;
4. retain exact dry-run, import, reconciliation, revision, and rollback artifacts;
5. repeat after any source change rather than carrying stale decisions forward.

### 8. Run in parallel before considering retirement

Bonsai retirement remains prohibited until the parallel period is complete, reconciliation has zero unresolved findings, backup and restore evidence is current, and Cameron gives explicit post-evidence financial cutover approval for the exact release and evidence generation.

## Current hard blockers

- Five Bonsai tasks require source review, repair, and recapture.
- Twenty-four project identity decisions are pending.
- Eighty-eight task dispositions and 238 project dispositions are pending.
- All 65 active-project outcomes are pending and blocked.
- All 117 financial-exception dispositions are pending.
- Complete direct payment and contract evidence is missing.
- No sandbox import, parallel run, final reconciliation, or cutover approval exists.

## Safeguard attestation

This read-only verification performed no external writes, applied no decisions, changed no tasks, owners, projects, lifecycle states, invoices, payments, time entries, contracts, or providers, and did not authorize migration or Bonsai retirement.
