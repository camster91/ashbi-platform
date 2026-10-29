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
