# Ashbi master-app delivery plan

Reconciled October 14, 2026. Execution checklist: [#565](https://github.com/camster91/ashbi-platform/issues/565). The [agent-assisted TODO implementation plan](plans/2026-10-14-agency-todo-execution.md) expands the remaining work into parallel work packages and acceptance checks. This document owns delivery order and outstanding work; [product status](product-status.md) owns capability classifications, [consolidation](master-app-consolidation.md) owns scope/source requirements, and [replacement readiness](replacement-readiness-matrix.md) owns target acceptance. Earlier milestone checklists (#290/#291/#393/#414) are supporting references, not competing execution plans.

## Scope and status rules

One organization shares Ashbi Design and freelance work with the Ashbi team. Portfolio filters preserve canonical clients, ownership, billing identity and client-specific permissions. Build usable UI/API/MCP workflows first, then perform one reviewed bounded data-input pass. Reusable importers/provider synchronizers are outside this scope. App-native account managers and ChatGPT/API/MCP share the same governed backend; deterministic daily workflows remain usable without AI.

Implemented, CI verified, merged, deployed and target accepted are separate states. Check an implementation TODO only after its normal merge and required CI; check acceptance TODOs only after the named evidence exists. CI browser journeys use disposable records and do not prove real provider or populated production acceptance. Do not infer a completion percentage from unequal checklist items.

The owner has since explicitly lifted the production hold and authorized deployment. Historical hold references in the ledger describe earlier releases; they are not a request for repeat approval. Protected deployment execution, exact-version verification and populated acceptance remain separate gates.

## Approved agency-agent workstream

The October 14 expansion covers app-native account managers, curated plugins, ChatGPT MCP, email communication tracking, human/bot chat, WhatsApp intake, service dashboards and agency operations. The [agency-agent roadmap](agency-agent-platform-roadmap.md) defines the ordered slices and acceptance criteria. Begin with shared read-only briefs and plugin discovery; extend existing chat/email/billing/review/portal modules before adding parallel systems. This workstream preserves the source-primary migration and existing release gates.

## Reconciled delivery ledger

| Workstream | Current evidence | Remaining exit condition |
| --- | --- | --- |
| Daily project/task delivery | Portfolios, configurable stages, typed task fields, saved views, templates, filters/groups/gallery, contributors/workload, independent boards and calendar/completion recurrence merged through #566–#586; required CI passed | Representative populated team/client/keyboard/mobile acceptance |
| Workspace knowledge and draft recovery | Independent wiki, inherited wiki audiences and revision/conflict draft recovery merged in #586 with PostgreSQL and browser CI | Project Note audiences merged in #592; simultaneous editing and retained-version restoration remain unfinished |
| Draft billing | Atomic invoice saves #588 and approved unbilled time/expense billing #589 merged; main `9d969e9` passed required CI [38570627359](https://github.com/camster91/ashbi-platform/actions/runs/38570627359) | Complete provider/revenue acceptance; these merges do not prove signatures, email or payments |
| Standalone collections, records, formulas/rollups and record forms | #590 merged normally as `e1690e4` after all required CI passed on `03be4e0` in run [38598141920](https://github.com/camster91/ashbi-platform/actions/runs/38598141920). Required-field SQL review correction resolved; storage/UI/HTTP/MCP and disposable database/browser acceptance passed | Required main CI 38600489530 passed at e1690e4; populated target acceptance and authorized production execution remain pending |
| Project Note audiences | Merged in #592 as 5c049cb: inherited read/edit authorization, SQL guards, UI/API/MCP, notification privacy and both restore paths. Required head CI 38609927500 and main CI 38611395162 passed | Populated target acceptance and authorized production execution remain pending |
| Document collaboration/history | Revision conflict handling exists; simultaneous editing and retained-version restore unfinished | Implement/test collaboration; obtain retention bound and restore-authority choice before policy-dependent history implementation |
| ChatGPT control plane | Scoped OAuth/API/MCP code and confirmed action contracts exist | Real connection/discovery/revocation/denial/expiry/idempotency/audit acceptance [#561](https://github.com/camster91/ashbi-platform/issues/561) |
| Revenue/provider journey | Proposals, agreements, portal, invoice/payment integration code exists | Prove lead → proposal → signature → delivery → approved work → invoice → sandbox payment/webhook → receipt; email/PDF/retry, tax/partial payment/refund and currency reconciliation (#280/#378/#379/#380) |
| Source mapping/input | Consolidation continuation and source-primary parallel running are approved; source references and a prepared first-client batch exist, with fidelity exceptions still open | Resolve exact canonical/financial, stage/relation/file, ownership and time-precision exceptions; complete disposable rehearsal and bounded readback with totals by original currency |
| Release/target/cutover | Owner lifted the hold. #593 navigation, #594 export repair and #595 shared app/MCP client briefs are merged; #595 main is 80054de with CI 38662512953 running at the planning check. Waiting release 38649706109 targets older 0a02e146 and does not contain #595 | Verify the chosen exact head, execute its protected release and verify revision/health/rollback; populated target, providers, recovery, team dogfood and final cutover with retained source fallback (#398) |

## Ordered TODOs and next steps

1. **Freeze and ship the existing tested revision (W0).** Recheck exact main CI, select the correct protected release and verify the deployed revision, backup/rollback and health. Deployment approval already exists; the older waiting release does not contain #595.
2. **Build the shared runtime and communication core in parallel (W1–W7).** Agent A handles profiles, conversations, durable runs and restricted plugins/MCP; Agent B handles channels/membership and mailbox/timeline services; Agent C handles UI and independent QA. The lead owns shared schema/migrations and integration. Freeze contracts before edits and merge bounded vertical slices.
3. **Complete provider adapters and document work (W8–W10).** Build synthetic WhatsApp intake and OpenSEO panel contracts, then activate only the verified account/group/project mappings. Implement policy-independent simultaneous editing while the retained-history bound/restore-authority choice remains pending. Preserve drafts, audiences and permission boundaries.
4. **Close actual agency workflow deltas (W11).** Extend existing retainers, reviews, workload/time/billing, portal, knowledge and assets; do not rebuild already merged features. Scheduled internal agents follow durable run acceptance.
5. **Complete independent integrated acceptance (W12).** Test representative agency/freelance, roles, communication, real ChatGPT, revenue/provider, recovery and accessible daily-use journeys. Fix reproduced defects and attach exact-head evidence.
6. **Rehearse and perform bounded initial input (W13–W14).** Preserve approved source-primary parallel running, finish exact mapping/fidelity exceptions, verify backup/isolated restore, rehearse in disposable staging and read back the initial reviewed population without communication or billing side effects.
7. **Verify the populated release and cut over (W14).** Complete target QA, recollect/reconcile the final delta, record a consistency cutoff/handoff window and Cameron/Bianca acceptance, then switch new work to Hub. Retain source/export fallback; source retirement/cancellation remains separate.

The [implementation plan](plans/2026-10-14-agency-todo-execution.md) owns the work-package details and dependencies. Mapping preparation, provider fixtures and QA design proceed alongside implementation; they do not substitute for target/provider acceptance. Existing merged collections, navigation, billing and Note audiences are acceptance inputs, not unfinished build tasks.

## Pending owner gates and wider requirements

- **Protected deployment:** the owner has explicitly lifted the earlier hold. Execute the approved exact-version release through its permitted GitHub review path; missing UI capability is an execution/access gap, not a request for repeat business approval.
- **History policy:** retention bound and restore authority need a choice. Audience permission barriers are metadata, not approval to retain document snapshots.
- **Data and cutover:** consolidation continuation and source-primary parallel running are approved. Resolve remaining exact mapping/financial exceptions before affected writes, verify bounded input/readback and record final cutover. Source retirement/cancellation remains a separate action.
- The replacement matrix retains conversation/calls/media, alerting, screen-reader/reflow and disaster-recovery acceptance requirements. Managed TURN, media retention/transcription and any wider optional capability require their own decision/evidence; they are not silently removed or treated as required new native replacements.

## Reconciliation corrections

#574/#575/#579/#586/#588/#589 are merged; their source slices should not remain queued for implementation/review. #576–#578 and #580–#585 were closed as superseded, with evidence retained. Project Note audiences are completed code delivery in merged #592; target acceptance and document collaboration/history remain separate. Records/forms are implemented and merged in #590, with required head CI passed; populated target acceptance remains pending. Approved-unbilled billing is implemented and merged, not an open build task. No merge or green CI proves deployment, source input, provider acceptance or complete Notion/Fluent Boards/Bonsai replacement.

Execution readiness for this reconciliation: selected Local, observed `Cam-DESKTOP`; this task permits unrestricted filesystem/network execution with approval policy `never`. Shell and GitHub read/write operations are callable. Native computer APIs are disabled; no authenticated target UI control was verified. This plan uses repository/GitHub evidence and existing disposable CI coverage, not a new live browser QA claim.
