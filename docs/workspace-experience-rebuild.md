# Workspace experience rebuild

Owner decision, 28 October 2026. Execution: #784. Supersedes cosmetic refinement as the primary direction. The existing backend, data, permissions and billing boundaries stay; the entire user experience is being rebuilt. The current live app stays available during implementation.

## Product promise

An agency workspace in which Cameron and Bianca can see the next action, find a client project, update work and track delivery without navigating walls of forms. Professional means predictable interactions, clear information hierarchy, useful density and reliable feedback on mobile as well as desktop.

## Design decisions

- A persistent desktop sidebar, a compact top bar and an accessible mobile navigation drawer. Navigation groups reflect work, clients/billing and documents.
- The original Ashbi logo, verified indigo/cream/lime palette, quiet neutral surfaces, consistent type sizes, subtle borders and status colours. Follow `apps/workspace/brand/SOURCES.md`; preserve the logo bytes and use the licensed UI font rather than inventing brand typography. Avoid decorative dashboards, large branding and repeated boxed explanations.
- Lists are the primary working surface. Creation and editing are deliberate actions; long forms do not occupy the list by default.
- Overview separates work, approvals and outstanding invoices into focused views. Do not invent counts, forecasts or analytics.
- Projects are a stable context for tasks, documents, files, time and billing. Preserve deep links and return paths.
- One family of forms, dialogs, toolbars, filters, empty states and errors across the app. Preserve drafts, permission checks, revision conflicts and explicit financial confirmation.
- Password manager support and reveal controls from #783 are included.

## Reference evidence

Reviewed 28 October 2026: [Bonsai projects](https://www.hellobonsai.com/projects) connects project tasks, time and billing; [ClickUp task views](https://help.clickup.com/hc/en-us/articles/6310172583831-Use-Task-views) uses focused list/board views and scoped filters. These are workflow references, not claims of feature parity or permission to copy branding.

## Delivery sequence and acceptance

1. Shared shell and visual/interaction foundations; desktop and mobile keyboard navigation.
2. Complete daily work → project → task update/complete → return workflow. Compact lists, contextual creation/editing and understandable filters.
3. Apply the same patterns to clients, documents/files, time and financial workflows without changing API or authorization semantics.
4. Verify source/compiled contracts, role isolation, financial protections, keyboard/axe, responsive rendering and failure/retry paths. Inspect realistic synthetic screens, not empty pages alone.
5. Record a reviewable replacement and release evidence in #784. Deployment and owner daily-use acceptance are separate. No customer data mutation for visual tests.

## Status

Implementation in progress on `agent/784-workspace-rebuild`. Production unchanged. The password fix is preserved on its own branch and included in this branch. No rebuild release or owner acceptance claimed.

## Local checkpoint — 28 October 2026

Implemented the original Ashbi wordmark and verified palette, shared sidebar/mobile drawer, contextual creation dialogs, focused Overview views, compact list actions and project-scoped task title links. Desktop invoice preparation now uses two columns; mobile preserves a single reading order. The skip link stays above the sidebar and the open mobile drawer locks background scrolling.

Focused local verification uses isolated fabricated D1 data and the Chromium 1208 revision matching Playwright 1.58.2:

- 12 project-workspace, compact-list and role-specific navigation checks passed, including upload/download, manual time, invoice preview, restricted direct links and stale project responses.
- 17 route-race, draft-retention, keyboard, cancellation and timer regression checks passed.
- 5 native-auth/browser checks passed, including the new project-to-task workflow, password generation/reveal, MFA and responsive axe checks.
- Source and compiled native-auth contracts passed (12 checks); the public logo is checked against the original SHA-256.
- Build and whitespace checks passed. Desktop and phone screenshots were inspected with synthetic records.

This is an implementation checkpoint, not release approval. The interrupted broad source run is inconclusive; the full browser/release suite has not passed on this branch. Remaining work includes adapting task-board/document draft tests to contextual dialogs, exercising the remaining financial/recovery suites, and finishing the wider workflow refinement. Keep #784 open and production unchanged until those gates and the owner walkthrough are complete.

## Drafts and core workflow verification — 28 October 2026

Client/project creation now preserves cancelled drafts in the current page, matching task/document creation, and clears them after a successful save. Shared form restoration replaces duplicated loops. Modal interactions preserve the originating action menu; the search button has an explicit accessible name independent of its decorative shortcut.

Updated the existing task-board, document-tree, comment, timer and financial stale-response tests to use contextual dialogs and visible action menus. Tests still verify real stored revisions, tenant/client visibility, history, retries, lost acknowledgements, draft values, keyboard focus and responsive accessibility; none of those protections were removed.

Verification:

- Complete source suite from the package's configured test list, with `--test-concurrency=2`: **576 passed**, zero failures/cancellations.
- `WORKSPACE_BROWSER_GROUP=core npm run test:browser`: **154 passed**, zero failures/cancellations, against the rebuilt Worker with matching Chromium 1208.
- Final focused task/document/auth draft checks: **34 passed**. The core run also includes those checks.
- Build and `git diff --check`: passed. Temporary local harnesses removed.

Next: remaining browser groups (commerce, contracts/Overview, delivery, overview_parts, journey), compiled financial/recovery release checks, remaining visual refinement and owner walkthrough. #785 remains a draft; neither production release nor full rebuild acceptance is claimed.

## Financial journey and release verification — 28 October 2026

Existing browser checks now select the focused Overview view and explicitly open contextual creation dialogs. Financial, tenant-isolation, stale-response, recovery and keyboard assertions remain intact. The view helper waits for loading only when switching views, so a deliberately held request cannot block a newer filter in race tests. Independent review tightened the owner assertion to verify the current user and assigned state together; its final focused check passed.

All six browser groups passed against the unchanged compiled Worker:

| Group | Passed |
| --- | ---: |
| Core | 154 |
| Commerce | 227 |
| Contracts and Overview | 138 |
| Delivery | 24 |
| Installment Overview | 16 |
| Integrated journey | 3 |
| Total | 562 |

Every group completed with zero failures/cancellations. The journey covers synthetic shared work, approved time, proposal approval, contract signing/PDF, split billing and payment reconciliation. Compiled API contracts passed **414/414**, compiled installment/delivery contracts **91/91**, and compiled D1/R2 recovery **46/46**. Source installment/delivery verification subsequently passed **91/91** and source recovery **46/46**, in addition to the complete configured source suite at **576/576**.

Native authentication/browser checks passed **6/6**. The phone Overview capture now verifies pressed state and panel visibility while switching views, then removes pointer/focus and transition capture artifacts; the final focused capture rerun passed **1/1** and the refreshed image was visually inspected. Navigation screenshot names describe actor roles; all three deliberately show Files. These capture findings did not require a product change.

The checked artifact SHA-256 is `cc8f8a18af45538968c036ab04e5026810eb594197d090ec3044cbaec212287b`. No product source or generated artifact changed during this verification pass. The repository secret-check command and `git diff --check` passed; the changed test code was also reviewed for sensitive values. Temporary harnesses were removed. Interrupted and superseded runs are not counted as passes.

PR #785 remains a draft. CI on the pushed checkpoint, owner walkthrough, production deployment and target-environment acceptance are separate and remain outstanding. Production is unchanged.

## Dependency gate cleared — 29 October 2026

All Cloudflare CI jobs passed for rebuild checkpoint `c7b6fd24` (run `40804430287`). The separate repository-wide audit found existing `systeminformation` 5.33.15 in the Hub dependency tree. Issue #786 and PR #787 patched only its version, resolved URL and integrity to 5.33.16. Local production audit reported zero vulnerabilities, the proxy-peer regression passed 3/3, and all required hosted gates passed (run `40805727729`). The stalled external-volume local install is not counted; the fresh hosted install passed.

PR #787 was squash-merged as `304788046cd4a36747a3689388a81a0418aa47e1` and incorporated into the rebuild branch. The Cloudflare app's source and compiled artifact are unchanged by that dependency patch. Combined-head CI and owner walkthrough remain separate from the passed component checks. No deployment or owner acceptance is claimed.
