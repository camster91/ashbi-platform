# Slim-down proposal — 22 October 2026

Ashbi Hub is larger than a one-person web studio uses in a day. This note lists what to remove, in pull-request-sized chunks, and what to keep. Nothing in this document has been deleted.

Counts are physical lines and files on `main` at `a2ed5fc9` (22 October 2026), plus matching tests and docs whose names belong to that feature. Shared helpers (mail, money, tenancy, auth) are not included. A schema model is counted only when the chunk would drop it. A later PR still has to chase imports the filename search did not catch.

The public client book in the Bonsai seed files is a separate security fix ([PR #684](https://github.com/camster91/ashbi-platform/pull/684)), not a slimming cut.

## Lean core

Keep these, and the tests that prove them:

| Area | What stays |
| --- | --- |
| Clients | Client list and client page, contacts |
| Projects and tasks | Projects, boards, the task page, comments |
| One timer | Header `LiveTimer` and `POST /api/time-sessions`, plus timesheets and manual entries on `TimeEntry` |
| Proposals, contracts, invoices | Draft, send, public token pages, Stripe Checkout and the webhook |
| Client portal | Signed-in portal and the public proposal, contract, and invoice links |
| Gmail and Calendar | Inbox, send-after-a-person-confirms, Google Calendar on Schedule |
| ClickUp, one way | A future pull of tasks assigned to Cameron and comments that mention him. The current `scripts/import-clickup-tasks.js` is a dry plan, not that pull. Keep the plan until the pull replaces it |
| AI and MCP | One staff assistant and the MCP connection (`/connect-chatgpt`, `src/auth/mcp-oauth-provider.js`). Extra chat products are a later collapse, below |

Also keep, because the studio already bills this way or the app does not boot without them: login and MFA, organization tenancy, Mailgun as the sender for invoices, retainers, and the Postgres and Redis runtime. Retainers are about 1,225 lines (`web/src/pages/Retainers.jsx`, `src/routes/retainer.routes.js`, and their tests). They are not a daily distraction. Leave them until invoicing has a month of real use.

Audit items that are still open and are not cuts: staff MFA (M2), an admin view of why health is `degraded` (M3), the frontend bundle budget (M11), and making the project time page use the header timer (M10). Those were paused. This proposal does not replace them.

## How big the tree is

| Area | Files | Lines |
| --- | ---: | ---: |
| Backend unit tests (`src/tests/unit`) | 328 | 44,589 |
| Frontend tests (`web/src/tests`) | 265 | 26,330 |
| Backend integration tests (`src/tests/integration`) | 103 | 16,369 |
| AI eval (`src/tests/ai-eval`) | 13 | 1,026 |
| Browser specs under `tests/` | 46 | 3,964 |
| Route handlers (`src/routes`) | 97 | 26,622 |
| Pages (`web/src/pages`) | 74 | 29,333 |

Test code is larger than the route handlers and the pages combined. Most of that size should leave with the feature it covers. The suites called out below are redundant on top of that.

## Removal chunks

Each chunk is one PR. Order is lowest risk first. Do not combine them.

### 1. Dead files and unused mobile packages

| | |
| --- | --- |
| Remove | `src/routes/time-session.routes.js` (280 lines). Nothing imports it. The live timer is `src/routes/time-sessions.routes.js` (61 lines), mounted at `/api/time-sessions`. Also `src/routes/landing.routes.js` (87 lines). Nothing imports it, and it writes `prisma.lead`, which is not a model in `prisma/schema.prisma`. |
| Also remove | Six `@capacitor/*` dependencies in `web/package.json` (`android`, `cli`, `core`, `push-notifications`, `splash-screen`, `status-bar`). No application source imports them. Browser push is a different feature (`web/src/hooks/usePushNotifications.js` and the `web-push` package) and stays in this chunk. |
| Files | 2 source files, plus `web/package.json` and the lockfile entries |
| Lines | about 370 of source |
| Dependencies | the six Capacitor packages |
| Risk | Low. Both route files are unmounted. Confirm production logs do not request `/api/leads/landing` before deleting the landing file. |

### 2. One timer on the project page

| | |
| --- | --- |
| Change | `web/src/pages/TimeTracking.jsx` (358 lines) runs its own `setInterval` timer and then posts a manual entry. The header already runs `LiveTimer` against `TimeSession`. Make the project page start and stop that same session. Keep manual entries and existing `TimeEntry` rows. |
| Then | `/api/time-tracking` (`src/routes/time-tracking.routes.js`, 97 lines) is a second start/stop API. `web/src/lib/api.js` still calls it. After the page uses `/api/time-sessions`, delete the start/stop handlers that only duplicate the session API. Keep `GET /api/time-tracking/summary` if the dashboard still reads it, or move that one handler onto the time-entry routes. |
| Files | 2 or 3 |
| Lines | on the order of 150–250 deleted, not the whole page |
| Dependencies | none |
| Risk | Medium. Two live APIs and the header timer already share `TimeSession`. A bad merge can stop a running timer or write a second entry. Existing rows stay. This is audit item M10, paused as a product PR and listed here so it is not lost. |

### 3. Slack, Loom, and MarkUp.io historical importers

| | |
| --- | --- |
| Remove | Slack export importer: 15 files, 1,831 lines, including `src/services/slack-export-import.service.js` (808) and `src/tests/unit/slack-export-import.test.js` (565). Loom importer: 4 files, 1,095 lines (`src/services/loom-import.service.js`, `scripts/import-loom.mjs`, the integration test, `docs/loom-migration.md`). MarkUp.io importer: 4 files, 1,660 lines (`src/services/markup-import.service.js` 788, `src/tests/integration/markup-import.database.test.js` 526, `scripts/import-markup.mjs`, `docs/markup-migration.md`). |
| Schema | `SlackImportRecord`, `LoomImportRecord`, `MarkupImportRecord`. Drop those tables in a migration only after a backup, and only if the tables are empty or the imported rows are disposable. |
| Leave in place | Live Slack (chunk 4). The in-app annotation editor (`web/src/components/media/MarkupEditor.jsx` and `web/src/components/review/markup.js`, about 1,285 lines with their tests). That editor is design review inside the hub, not a MarkUp.io import. |
| Files | 23 |
| Lines | 4,586, plus about 120 lines of schema |
| Dependencies | none of these three owns an npm package. `csv-parser` stays for the Bonsai and ClickUp importers. |
| Risk | Low for daily use. Medium if a one-time Slack, Loom, or MarkUp.io import is still planned. Those imports are not part of the lean core. |

### 4. Live Slack

| | |
| --- | --- |
| Remove | 16 files, 1,580 lines: `src/routes/slack.routes.js`, `src/routes/slack-events.routes.js`, `src/services/slack-outbound.service.js`, `src/webhooks/slack.js`, `src/security/slack-events-auth.js`, and the Slack unit and integration tests. |
| Schema | `SlackInstallation`, `SlackChannelMapping`, `SlackEventReceipt`. Same backup rule as chunk 3. |
| Files | 16 |
| Lines | 1,580, plus the three models |
| Dependencies | none in `package.json`. Slack is called over HTTP. |
| Risk | Low if the studio does not post project updates to Slack. Confirm no Slack app is installed against the production organization before dropping the tables. |

### 5. Upwork agent

| | |
| --- | --- |
| Remove | `upwork-agent/` and `agents/upwork-scraper.js`: 22 files, 2,918 lines, including that scraper, the directory's own `package-lock.json`, and `MIGRATION.md`. The hub API does not import them. |
| Files | about 22 |
| Lines | about 2,900 |
| Dependencies | whatever `upwork-agent/package.json` declares. Root `playwright-core` stays: `src/services/web-capture.service.js` uses it for review screenshots. |
| Risk | Low. It is not on the request path. |

### 6. Studio extras that duplicate notes

The sidebar group Studio is Docs, Workspace wiki, Collections, Assets, Templates, and Semantic Search (`web/src/components/Layout.jsx`).

| Cut in this PR | Files | Lines | Risk |
| --- | ---: | ---: | --- |
| Workspace wiki (`WorkspacePage` routes, `web/src/pages/WorkspaceWiki.jsx`, `docs/workspace-wiki.md`, wiki tests) | 11 | 665 | Medium. Docs already has a note type `WIKI` (`web/src/pages/Docs.jsx`). Dropping the second wiki means moving any real pages into Docs first. MCP wiki tools in `src/integrations/workspace-wiki-actions.js` go away with it. |
| Record collections (`WorkspaceCollection`, `WorkspaceRecord`, `web/src/pages/RecordCollection.jsx`) | 9 | 1,117 | Medium. This is a small database product. Export any rows, then drop the models. |

Leave Docs (739 lines) as the one notes surface. Leave Assets (5 files, 694 lines) and project templates until a later pass. A working designer may use both. Semantic Search is chunk 11, because it owns embeddings.

Also in this PR, because they are unreferenced by daily work:

| Cut | Files | Lines | Risk |
| --- | ---: | ---: | --- |
| UI lab, `web/src/pages/UiLab.jsx`, route `/ui-lab` | 1 | 85 | Low. A component gallery. |
| Command Center, `web/src/pages/CommandCenter.jsx` and `src/routes/integrations.command-center.routes.js` | 3 | 698 | Low. An admin integrations screen on top of Settings. |

`src/services/automation.service.js` (1,264 lines) looks like a studio extra and is not one to delete here. It sends overdue invoice mail and calls `wonStageFor` in the pipeline service. The Automations page is 226 lines. Remove the page in a later PR only after overdue mail has a smaller home. Deleting the service in this chunk can stop invoice email.

### 7. Source-contract tests and redesign twins

| | |
| --- | --- |
| Source-contract tests | 14 files, 1,960 lines under `web/src/tests`, named `*.contract.test.js` or `*workflow-contract*`. `web/src/tests/contracts/layout.contract.test.js` reads `Layout.jsx` as text and asserts that navigation strings are present. These fail when a label moves, and they overlap the render tests for the same pages. |
| Redesign twins | 8 files, 1,907 lines: `InvoiceDetail.redesign.test.jsx`, `Timesheets.redesign.test.jsx`, `ClientPortal.redesign.test.jsx`, `ProposalDetail.redesign.test.jsx`, `Projects.redesign.test.jsx`, `Settings.redesign.test.jsx`, `Dashboard.redesign.test.jsx`, `Proposals.redesign.test.jsx`. Each sits beside another test for the same page. |
| What to do | Keep assertions that fail when a button or a money figure is wrong. Move those into the existing page test. Delete the rest. |
| Files | 22 |
| Lines | 3,867, some of which survive as moved assertions. Expect on the order of 2,500 lines removed. |
| Dependencies | none |
| Risk | Medium. A source-contract test is sometimes the only check for an accessible name. Read each deleted assertion once. Do not delete `src/tests/ai-eval` (13 files, 1,026 lines). That suite is the adversarial check for tool approval, prompt injection, and secret redaction, and `npm test` already runs it on purpose. Do not delete invoice, auth, MFA, portal-isolation, or tenancy tests to make the suite smaller. |

`src/tests/unit/release-gates.test.js` (259 lines, 37 cases) repeats the same baseline-drift assertion under copied test names. Folding the copies saves little. Leave it until the release-gate contract itself changes.

Browser configs are five files: `playwright.config.ts`, `playwright.visual.config.ts`, `playwright.stack.config.ts`, `playwright.pwa.config.ts`, `playwright.public.config.ts`. The specs are 46 files and 3,964 lines, and they are the slow suite. Keep one smoke config and the portal and invoice journeys. Park visual and PWA runs as manual. That does not delete much code. It shortens CI.

### 8. Estimates as a second sales document

| | |
| --- | --- |
| Remove | 10 files, 2,592 lines: `web/src/pages/Estimates.jsx` (862), `src/routes/estimate.routes.js` (574), `web/src/pages/PortalEstimate.jsx` (304), and the estimate tests. |
| Schema | `Estimate` |
| Dependencies | none |
| Risk | Medium. Proposals can be created from an estimate (`src/tests/unit/proposal-tax-from-estimate.test.js`). Do this only after a proposal can carry the same line items without an estimate row. Audit item S9 already says: estimate PDF, or stop offering estimates as a separate sendable doc. |

### 9. Pipeline

| | |
| --- | --- |
| Remove | 7 files, 2,377 lines: `web/src/pages/Pipeline.jsx` (865), `src/services/pipeline.service.js` (530), `src/services/dealPipeline.service.js` (271), `src/routes/pipeline.routes.js` (116), and the pipeline tests. A deal already requires a client. |
| Schema | `PipelineStage`, `PipelineDeal` |
| Dependencies | none |
| Risk | Medium. `automation.service.js` imports `wonStageFor`. Cut or retarget that call first (see chunk 6). Low value for a studio that already knows its clients and does not run a board of deals. |

### 10. WordPress tables

| | |
| --- | --- |
| Remove | The WordPress bridge models in `prisma/schema.prisma`, about 189 lines from `WPSite` through `WPBridgeNonce` (line 2801 to just before `PublicInquiry`). No `src/routes` file mounts a WordPress bridge on this tree. The public hub route was already 404 at the October audit. |
| Files | schema and one migration |
| Lines | about 189, plus relations on `Client` and `Project` if those fields exist only for these models |
| Dependencies | none |
| Risk | Low in the application. Medium in the database. Drop the tables only after a backup shows they are empty or unused. Do not revive the bridge inside a cleanup PR. |

### 11. Semantic search page

| | |
| --- | --- |
| Remove | 4 files, 535 lines: `web/src/pages/SemanticSearch.jsx` (259), `src/routes/semantic-search.routes.js` (88), and the two tests. Global search at `/search` stays. |
| Schema | `ClientEmbedding` can stay. `src/services/workspace-export.service.js` treats it as a derived index that can be rebuilt. Dropping the page does not require dropping pgvector. |
| Dependencies | none beyond pgvector, which stays |
| Risk | Medium. Staff AI search may call the same embedding path. If it does, delete the page and the route, and leave the service the assistant uses. |

### 12. Extra AI products, one at a time

The lean core is one assistant plus MCP. The tree has several:

| Surface | Lines | File |
| --- | ---: | --- |
| Generic AI routes | 894 | `src/routes/ai.routes.js` |
| AI tool routes | 397 | `src/routes/ai-tool.routes.js` |
| Provider connections | 360 | `src/routes/ai-connection.routes.js` |
| Ash chat | 218 | `src/routes/ash-chat.routes.js` |
| AI team | 206 | `src/routes/ai-team.routes.js` |
| AI bridge | 200 | `src/routes/ai-bridge.routes.js` |
| Staff chat page | 397 | `web/src/pages/Chat.jsx` |
| Global AI chat | 269 | `web/src/components/GlobalAIChat.jsx` |
| Project chat | 404 | `web/src/components/ProjectChat.jsx` |
| Portal assistant | 227 | `src/services/portal-assistant.service.js` |
| External bot API | 1,388 | `src/routes/bot.routes.js` |

`src/routes/bot.routes.js` is an external bot API with its own in-memory cache. It is the first of this group to remove, after a check that nothing in production calls it. The rest should be collapsed by picking the one chat the MCP tools already use, then deleting the other route files in a follow-up. Tests for these routes are thousands of lines more (`src/tests/unit/ai-tool-session.routes.test.js` alone is 519). Count them in the PR that deletes the route.

| | |
| --- | --- |
| Dependencies | `@anthropic-ai/sdk`, `@google/genai`, and `@modelcontextprotocol/sdk` stay while any assistant stays |
| Risk | High. These routes share the tool registry, tenancy checks, and approval flow. One PR per surface, bot API first. |

`agents/arcan-phase2-verify.js`, `agents/email-followup.js`, and `agents/notion-mapper.js` are one-off scripts (about 1,000 lines together). They can leave with the bot PR if nothing in `package.json` calls them.

### 13. In-app design review

| | |
| --- | --- |
| Remove, only if comps are reviewed outside the hub | Review sessions: about 3,913 lines across 17 files (`src/routes/review.routes.js` 664, `web/src/components/review/MediaReview.jsx` 774, `web/src/pages/ReviewSession.jsx` 321, and the portal review tab). Annotation markup on top of that is about 1,285 lines (chunk 3 left this in place). Web capture for screenshots is `src/services/web-capture.service.js` (463) plus a 352-line test, and it is why `playwright-core` is a production dependency. |
| Schema | `ReviewSession`, `ReviewAnnotation`, `ReviewDecision`, `ReviewShareLink` |
| Lines | about 5,200, plus web capture if screenshots go too |
| Dependencies | `playwright-core` and `pdfjs-dist` become candidates once review and PDF annotation are gone. `pdfjs-dist` may still serve invoice or contract PDFs. Check before removing it. |
| Risk | High. This is a real client-feedback loop, and it is the largest product surface outside the lean core. Skip it if design review in the hub is wanted. Do not start it before chunks 1–7. |

### 14. Notion and Bonsai importers, after cutover

Do not delete these until a Notion export and a Bonsai export have been imported and checked.

| Importer | Files | Lines | Notes |
| --- | ---: | ---: | --- |
| Notion markdown | 10 name matches, 1,342 lines | includes `agents/notion-mapper.js` (346) and `web/src/components/NotionEditor.jsx` (469) | Keep `NotionEditor.jsx`. `web/src/pages/TaskPage.jsx` uses it as the task editor. The importer itself is `scripts/import-notion-markdown.js` (177), `src/services/notion-markdown-import.service.js` (36), the tests, and `docs/notion-markdown-migration.md`. About 500 lines once the editor is excluded. |
| Bonsai | 11 files, 2,434 lines | `scripts/import-bonsai-full.js` is 1,031. `scripts/import-bonsai.js` is 293 and already refuses to run. The seed script stays fictional after PR #684. | After the real import, `csv-parser` can go if the ClickUp pull does not read CSV. |

Risk of deleting them early: High. Risk after a checked import: Low.

## Suggested PR order

| PR | Chunk | Rough lines removed | Risk |
| --- | --- | ---: | --- |
| 1 | Dead timer route, dead landing route, Capacitor packages | 370 source, plus lockfile | Low |
| 2 | Project page uses the header timer | 150–250 | Medium |
| 3 | Slack, Loom, and MarkUp.io importers | 4,600 | Low |
| 4 | Live Slack | 1,600 | Low |
| 5 | Upwork agent directory | 2,900 | Low |
| 6 | Wiki, collections, UI lab, Command Center | 2,600 | Medium |
| 7 | Contract and redesign tests, merge what is still true | about 2,500 | Medium |
| 8 | Estimates | 2,600 | Medium |
| 9 | Pipeline | 2,400 | Medium |
| 10 | WordPress tables | 190 schema | Low in app, medium in DB |
| 11 | Semantic search page | 500 | Medium |
| 12 | Bot API, then other extra AI chats | 1,400, then more | High |
| 13 | In-app design review | about 5,200 | High |
| 14 | Notion and Bonsai importers | about 3,000, after cutover | High until the import is checked |

Chunks 1, 3, 4, and 5 are the cuts that do not change a daily screen. Together they are about 9,500 lines, two dead routes, and six unused npm packages.

## What not to delete to make the tests smaller

- `npm test` unit coverage for auth, MFA, invoices, Stripe, portal tenancy, and time-entry locking.
- `src/tests/ai-eval`.
- Integration tests that hit Postgres for money and tenant isolation. They are slow because they use a database. That is the point.
- The release-gate secret scan, including the client-book check from PR #684.

New tests, while this slimming is in progress, should be the ones that fail if a deleted import path comes back, and nothing else.
