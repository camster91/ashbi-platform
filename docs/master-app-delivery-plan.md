# Ashbi master-app delivery plan

Reconciled October 14, 2026. Execution checklist: [#565](https://github.com/camster91/ashbi-platform/issues/565). This document owns delivery order and outstanding work; [product status](product-status.md) owns capability classifications, [consolidation](master-app-consolidation.md) owns scope/source requirements, and [replacement readiness](replacement-readiness-matrix.md) owns target acceptance. Earlier milestone checklists (#290/#291/#393/#414) are supporting references, not competing execution plans.

## Scope and status rules

One organization shares Ashbi Design and freelance work with the Ashbi team. Portfolio filters preserve canonical clients, ownership, billing identity and client-specific permissions. Build usable UI/API/MCP workflows first, then perform one reviewed bounded data-input pass. Reusable importers/provider synchronizers are outside this scope. ChatGPT/API/MCP is the primary AI interface; embedded AI is optional.

Implemented, CI verified, merged, deployed and target accepted are separate states. Check an implementation TODO only after its normal merge and required CI; check acceptance TODOs only after the named evidence exists. CI browser journeys use disposable records and do not prove real provider or populated production acceptance. Do not infer a completion percentage from unequal checklist items.

The owner has since explicitly lifted the production hold and authorized deployment. Historical hold references in the ledger describe earlier releases; they are not a request for repeat approval. Protected deployment execution, exact-version verification and populated acceptance remain separate gates.

## Approved agency-agent workstream

The October 14 expansion covers app-native account managers, curated plugins, ChatGPT MCP, email communication tracking, human/bot chat, WhatsApp intake, service dashboards and agency operations. The [agency-agent roadmap](agency-agent-platform-roadmap.md) defines the ordered slices and acceptance criteria. Begin with shared read-only briefs and plugin discovery; extend existing chat/email/billing/review/portal modules before adding parallel systems. This workstream preserves the source-primary migration and existing release gates.

## Reconciled delivery ledger

| Workstream | Current evidence | Remaining exit condition |
| --- | --- | --- |
| Daily project/task delivery | Portfolios, configurable stages, typed task fields, saved views, templates, filters/groups/gallery, contributors/workload, independent boards and calendar/completion recurrence merged through #566–#586; required CI passed | Representative populated team/client/keyboard/mobile acceptance |
| Workspace knowledge and draft recovery | Independent wiki, inherited wiki audiences and revision/conflict draft recovery merged in #586 with PostgreSQL and browser CI | Project Note audiences, simultaneous editing and retained-version restoration are separate unfinished requirements |
| Draft billing | Atomic invoice saves #588 and approved unbilled time/expense billing #589 merged; main `9d969e9` passed required CI [38570627359](https://github.com/camster91/ashbi-platform/actions/runs/38570627359) | Complete provider/revenue acceptance; these merges do not prove signatures, email or payments |
| Standalone collections, records, formulas/rollups and record forms | #590 merged normally as `e1690e4` after all required CI passed on `03be4e0` in run [38598141920](https://github.com/camster91/ashbi-platform/actions/runs/38598141920). Required-field SQL review correction resolved; storage/UI/HTTP/MCP and disposable database/browser acceptance passed | Required main CI 38600489530 passed at e1690e4; populated target acceptance and production remain held |
| Project Note audiences | Merged in #592 as 5c049cb: inherited read/edit authorization, SQL guards, UI/API/MCP, notification privacy and both restore paths. Required head CI 38609927500 and main CI 38611395162 passed | Populated target acceptance and production remain held |
| Document collaboration/history | Revision conflict handling exists; simultaneous editing and retained-version restore unfinished | Implement/test collaboration; obtain retention bound and restore-authority choice before policy-dependent history implementation |
| ChatGPT control plane | Scoped OAuth/API/MCP code and confirmed action contracts exist | Real connection/discovery/revocation/denial/expiry/idempotency/audit acceptance [#561](https://github.com/camster91/ashbi-platform/issues/561) |
| Revenue/provider journey | Proposals, agreements, portal, invoice/payment integration code exists | Prove lead → proposal → signature → delivery → approved work → invoice → sandbox payment/webhook → receipt; email/PDF/retry, tax/partial payment/refund and currency reconciliation (#280/#378/#379/#380) |
| Source mapping/input | Read-only source references collected; historical fidelity remains incomplete | Approve canonical matches, stages/relations/files and issuer/tax/currency/numbering/provider identities; disposable rehearsal with counts, ownership, files and totals by currency; no approved mapping or rehearsal yet |
| Release/target/cutover | Release 38571830817 was superseded; collections main e1690e4 passed CI 38600489530 and production run 38601903487 remains pending under the owner hold. Plan #591 merged as f495e39 with main CI 38604152222 passed; Note audiences #592 merged as 5c049cb with main CI 38611395162 passed and protected production release 38613838706 remains waiting | Owner lifts hold; protected release and exact-version health/rollback; populated target, providers, recovery, team dogfood and cutover approval with retained source fallback (#398) |

## Ordered TODOs and next steps

1. **Verify merged collections delivery (#590).** PR #590 is merged as e1690e4 with all required head CI and main CI 38600489530 passed. The production hold has been lifted by the owner; preserve required checks and protected deployment controls. If another commit changes the head, verify that head before merging.
2. **Simplify the staff surface.** Project Note audiences are merged and required main CI passed. The approved navigation change groups staff workflows into Work, Clients, Knowledge, Finance and Settings, shares the section lists across desktop/mobile and reduces the compact rail to five controls. Native AI remains opt-in. Navigation browser coverage and required CI/merge evidence are tracked on [#593](https://github.com/camster91/ashbi-platform/pull/593); code delivery does not imply production acceptance. Editor and permission consolidation is a separate follow-up; do not remove capabilities or change authorization while reorganizing navigation.
3. **Finish simultaneous editing and retained-version recovery.** Preserve existing drafts/conflict recovery. Retention duration/version bound and restore authority remain undecided in [the decision packet](document-recovery-decision.md); neither proposed policy is approved. Continue policy-independent work while that choice is pending.
4. **Complete disposable integrated acceptance.** Run representative agency and freelance projects through docs, records/forms, tasks, approvals, time, billing and portal roles. Prove actual ChatGPT connection/revocation and the full revenue/provider journey using authorized sandbox accounts. Resolve defects and attach exact-head evidence to the relevant source issues.
5. **Prepare and approve one-time input.** Review canonical/source/financial mappings and historical files, then rehearse the bounded input in disposable staging. Reconcile counts, relationships, ownership, files and monetary totals separately for each currency. Do not send client messages or trigger charges/reminders from historical input.
6. **Execute the authorized release and verify the populated target.** Follow protected release gates, backup/restore and rollback checks. Production input requires the reviewed bounded run. Recheck health, permissions, UI/mobile/keyboard/accessibility, provider behavior and recovery on the exact deployed version.
7. **Team dogfood and cutover.** Record Cameron/Bianca/team acceptance, exact workflow cutover approval and source/export fallback. Retire sources only after separate approval and reconciled acceptance.

Steps 4's test design and step 5's mapping preparation can proceed alongside implementation. They cannot substitute for unfinished feature gates. Production/provider actions requiring access or approval stay explicit rather than being checked off as code delivery.

## Pending owner gates and wider requirements

- **Production hold:** the latest explicit instruction is “Leave the release waiting.” Existing deployment approval does not override that later instruction. No environment bypass or approval is part of this reconciliation.
- **History policy:** retention bound and restore authority need a choice. Audience permission barriers are metadata, not approval to retain document snapshots.
- **Data and cutover:** canonical/financial mappings, bounded live input and final source retirement are unapproved.
- The replacement matrix retains conversation/calls/media, alerting, screen-reader/reflow and disaster-recovery acceptance requirements. Managed TURN, media retention/transcription and any wider optional capability require their own decision/evidence; they are not silently removed or treated as required new native replacements.

## Reconciliation corrections

#574/#575/#579/#586/#588/#589 are merged; their source slices should not remain queued for implementation/review. #576–#578 and #580–#585 were closed as superseded, with evidence retained. Wiki audience work does not complete Project Note audiences. Records/forms are implemented and merged in #590, with required head CI passed; populated target acceptance remains pending. Approved-unbilled billing is implemented and merged, not an open build task. No merge or green CI proves deployment, source input, provider acceptance or complete Notion/Fluent Boards/Bonsai replacement.

Execution readiness for this reconciliation: selected Local, observed `Cam-DESKTOP`; this task permits unrestricted filesystem/network execution with approval policy `never`. Shell and GitHub read/write operations are callable. Native computer APIs are disabled; no authenticated target UI control was verified. This plan uses repository/GitHub evidence and existing disposable CI coverage, not a new live browser QA claim.
