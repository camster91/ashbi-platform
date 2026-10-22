# Ashbi Hub readiness audit — 22 October 2026

This is a point-in-time audit of whether Ashbi Hub can become Ashbi Design’s home base (replacing Notion for clients, projects and tasks, and Bonsai for time, proposals, contracts and invoices), with PureSEM staying in ClickUp, Gmail and Google Calendar connected, and outgoing email approved by a person. It also rates the UI against daily use and against selling the hub to other agencies.

No production config, secrets, or deploys were changed. No product features were built.

## Verdict

The hub is a large, single-tenant agency app with real routes, tests and a deployed site. It is not ready to retire Notion or Bonsai, and it is not a product another agency can sign up for.

Use it beside the current tools. Move a workflow only after that workflow’s rehearsal below is done. PureSEM tasks will not appear in the hub until a ClickUp pull exists. That pull does not exist today.

Production at the time of this audit was revision `3d5987b05a0632508da1583858155ba12a681a39` (merged 17 October 2026). Local `main` was `a2ed5fc94ca0e5837ce587ab432242444025e745` (21 October 2026), which includes later UI work (Time page, Settings, login type) that production was not serving.

## How this was checked

- Code and docs on `main` at the revision above, including `docs/product-status.md`, `docs/launch-status.md`, `docs/replacement-readiness-matrix.md`, `docs/master-app-delivery-plan.md`, `docs/notion-markdown-migration.md`, `docs/bonsai-migration.md`, `docs/clickup-migration.md`, `docs/gmail-ingestion.md`, `docs/backup-and-restore.md`, and issue [#393](https://github.com/camster91/ashbi-platform/issues/393).
- Open GitHub issues, including the execution checklist [#565](https://github.com/camster91/ashbi-platform/issues/565). [#393](https://github.com/camster91/ashbi-platform/issues/393) is still open and is an older roadmap, not the live queue. [#565](https://github.com/camster91/ashbi-platform/issues/565) is the checklist the status docs point at.
- Public `GET https://hub.ashbi.ca/api/health` and `GET https://hub.ashbi.ca/api/wp-bridge`.
- A local boot of PostgreSQL 16 + pgvector, Redis, the API and the Vite app, with a synthetic agency (not the committed Bonsai roster). Screenshots of that session are in the audit artifacts, not in git.
- Tests and `npm run build`, recorded below.
- Mobbin design references were not available (the connector requires a paid plan). Comparisons to Bonsai and Notion use the local screens plus the product behaviour those tools are known for.

## Tests and build

Run on Node v24.22.1 after `npm ci` at the repo root and in `web/`. `package.json` requires Node `>=24.22.0`.

| Command | Result |
| --- | --- |
| `npm test` (unit + `src/tests/ai-eval`) in a clean environment | **2631 passed, 0 failed** (71s) |
| `npm test --prefix web` | **1949 passed, 262 files, 0 failed** |
| `npm run test:integration` against loopback database `testdb` | **251 tests. 247 passed in the full run. 4 failed only because this audit machine had exported a local `.env` (`AI_DISABLED=true`, and a shell-broken `CREDENTIALS_KEYRING`).** Re-running those four files with a clean environment: **5 passed, 0 failed** (`ai-byok`, `auth-portal-exposure`, `client-service-refresh`, `org-mfa-enforcement`, plus the attachment-visibility case that file also runs). |
| `npm run check:secrets` | **PASS** |
| `npm run build` | Vite compiled. **`scripts/check-frontend-budgets.mjs` failed**, so the build exits 1. |

Frontend budget failure on this tree (`docs/frontend-performance-budgets.md`):

| Artifact | Actual | Budget |
| --- | ---: | ---: |
| Initial JS graph | 596.86 KB | 480 KB |
| Entry CSS | 115.54 KB | 115 KB |
| `vendor-react-dom` chunk | 386.15 KB | 216 KB |
| Client portal route chunk | 70.34 KB | 60 KB |

A first unit run that inherited the local `.env` reported 63–135 failures (`AI features are temporarily turned off`, placeholder secret rejection, invalid keyring JSON). Those failures reproduced the environment, not regressions. Do not treat them as product defects.

Browser end-to-end, Lighthouse, and the GitHub Actions matrix were not re-run here. Dependabot’s alert API was not readable from this environment. The last status-doc claim (16 October) was a single medium `sprintf-js` dev advisory; re-check it before calling dependency risk closed.

## Production health

`GET /api/health` on 22 October 2026 returned HTTP 200:

```json
{"ready":true,"status":"ok","degraded":true,"checks":{"database":{"status":"ok"},"redis":{"status":"ok"},"worker":{"status":"ok"}},"revision":"3d5987b05a0632508da1583858155ba12a681a39"}
```

Database, Redis and the worker are up. `degraded: true` is still set. `src/services/runtime-health.service.js` sets `degraded` when any of these is true: worker heartbeat missing or on the wrong revision, any BullMQ failed job, backup status file missing or older than 30 hours, or alert destination unset, or alert owner unset. The public body does not say which one. Destination is any of `SENTRY_DSN`, `OTLP_ENDPOINT`, `NOTIFICATION_WEBHOOK_URL`. Owner is `OBSERVABILITY_OWNER`. Backup status is the file at `BACKUP_STATUS_PATH` (default `/app/config/backup-status.json`). Staff detail is `GET /api/health/details`, loopback-only in the production image.

The same shape appeared locally with no worker and no backup file. That matches the code. It does not tell Cameron which production gate is open.

## Area notes

### Auth and 2FA

**Works.** Email/password login, session cookies with a version that logout, password change and role change bump, TOTP enroll/confirm/disable, recovery codes, step-up reauth, and an organization MFA requirement (`Organization.mfaRequired`, `src/auth/mfa-enforcement.js`, `src/routes/mfa.routes.js`). Staff without MFA, when the org requires it, can only enroll or sign out. Client portal users are outside that policy. First admin is `POST /api/auth/register` plus `ADMIN_INVITE_TOKEN` when the database is empty. Later staff are created by an admin. Password reset mail exists.

**Missing for daily use.** Passkeys, SSO and SCIM are not implemented. There is no `/register` screen. Turning MFA on for Ashbi Design is an admin action in Settings, not a code gap. Do that before the client book lives only here.

**Files.** `src/routes/auth.routes.js`, `src/routes/mfa.routes.js`, `src/auth/mfa.js`, `src/auth/session.js`, `web/src/pages/Login.jsx`, `web/src/components/OrganizationMfaPolicy.jsx`.

### Clients and pipeline

**Works.** Client list and a tabbed client page (projects, time, files, communications, portal access). Pipeline stages and deals (`/api/pipeline`, `web/src/pages/Pipeline.jsx`). Search, empty and error states on the client list.

**Half-built.** A deal requires a client that already exists. `Client.relationshipStatus` includes `LEAD` and the web app does not use it. Unmatched email leads (`src/routes/leads.routes.js`) and public inquiries (`src/routes/client-acquisition.routes.js`) have APIs and no staff page. The local client list is a normal table, not a CRM a salesperson would live in. For a one-person studio that already knows its clients, the list is usable. It is not a Bonsai or Notion CRM.

**Files.** `src/routes/client.routes.js`, `src/routes/pipeline.routes.js`, `web/src/pages/Clients.jsx`, `web/src/pages/Client.jsx`, `web/src/pages/Pipeline.jsx`.

### Projects and tasks

**Works.** Projects, configurable stages, multiple boards, saved table/board/calendar views, typed fields, recurrence, comments, collaborators, a daily queue (`web/src/pages/WorkQueue.jsx`). The local kanban showed the three synthetic tasks in columns.

**Half-built.** Task dependency has an API (`PUT` on the task) and no board UI. There is no single “my tasks across every project” home comparable to Notion. Real-time co-editing is explicit conflict recovery, not live multiplayer. ClickUp is not a live source (see below).

**Files.** `src/routes/project.routes.js`, `src/routes/task.routes.js`, `web/src/pages/TaskKanban.jsx`, `web/src/pages/TaskPage.jsx`, `web/src/pages/Projects.jsx`, `web/src/components/Layout.jsx`.

### Time tracking

**Works.** One running timer per user on `POST /api/time-sessions`, header `LiveTimer`, weekly timesheet, approve/reject, lock after approval or invoicing, and an admin path from approved time to a draft invoice (`web/src/pages/UnbilledInvoice.jsx`). A 90-minute manual entry was stored and returned by `GET /api/timesheets/weekly`.

**Half-built.** `web/src/pages/TimeTracking.jsx` (per project) runs its own browser timer and posts a manual entry. It does not use the header session. Two timers will confuse a day of Bonsai-style tracking. Approval is a real step even when the only user is the admin.

**Files.** `src/routes/time-session.routes.js`, `src/routes/time.routes.js`, `web/src/components/LiveTimer.jsx`, `web/src/pages/Timesheets.jsx`, `web/src/pages/TimeTracking.jsx`, `web/src/components/time/timesheetWeek.js`.

### Proposals, contracts, invoices, Stripe

**Works in code.** Draft and send for proposals, estimates, contracts and invoices. Public token pages for approve, sign and pay. Stripe Checkout idempotency and a webhook. Partial payments, tax fields, PDF for invoices and contracts, expenses, retainers, overdue chasing. Sending is a person clicking Send. That matches “outgoing email is approved by a person” for finance mail. It is not a second approver.

**Missing before Bonsai can go.** No provider proof that Mailgun delivers and Stripe test mode reconciles ([#280](https://github.com/camster91/ashbi-platform/issues/280), [#378](https://github.com/camster91/ashbi-platform/issues/378), [#379](https://github.com/camster91/ashbi-platform/issues/379)). E-sign is an in-app signature, not a retained third-party ceremony ([#380](https://github.com/camster91/ashbi-platform/issues/380)). Estimate PDF is missing. The signed-in portal lists invoices and contracts, not proposals. The invoice screen offers Edit, Print, PDF, Void and Send at equal weight.

**Files.** `src/routes/proposal.routes.js`, `src/routes/contract.routes.js`, `src/routes/invoice.routes.js`, `src/routes/estimate.routes.js`, `src/services/stripe.service.js`, `src/routes/webhook.routes.js`, `web/src/pages/Proposals.jsx`, `web/src/pages/Invoices.jsx`, `web/src/pages/InvoiceDetail.jsx`.

### Client portal

**Works.** Magic link and password login, projects, read-only tasks, client-visible chat and files, invoices and pay links, contracts and sign links, shared reviews, retainer summary. Trust tests cover pause, archive and cross-organization denial.

**Missing for a client who expects Bonsai.** Proposals and estimates are email links, not a tab in the signed-in portal. Clients do not add tasks. Reviews are hidden until staff share them. Browser, mobile and assistive-technology acceptance is still an open issue ([#286](https://github.com/camster91/ashbi-platform/issues/286)). The portal’s CSS is a second skin (`web/src/pages/client-portal/portal.css`).

**Files.** `src/routes/client-portal.routes.js`, `web/src/pages/ClientPortal.jsx`.

### Gmail sync and triage

**Works, narrowly.** One deployment mailbox (`GMAIL_TOKENS_JSON` / `GMAIL_TOKENS_PATH`) owned by one organization (`GMAIL_SYNC_ORGANIZATION_ID`). Scan is INBOX, about 48 hours, capped (`src/services/gmail-sync-scan.js`, `scripts/gmail-sync.js`). Matched mail becomes threads. Send has durable receipts and a person confirms the send (`docs/gmail-send-receipts.md`). The Inbox page can list threads and has an AI triage action.

**Missing for daily mail.** No per-user Gmail OAuth. No Sent folder, no history cursor, no backfill. Unmatched mail and `EmailTriageItem` have APIs and no page. `POST /api/gmail/sync-now` is not wired to a button. Reply drafts can sit in “pending approval” and approval does not itself send.

**Files.** `src/routes/gmail.routes.js`, `src/services/gmail-ingest.service.js`, `src/routes/email-triage.routes.js`, `web/src/pages/Inbox.jsx`, `web/src/pages/Thread.jsx`, `docs/gmail-ingestion.md`.

### Google Calendar

**Works.** Per-user OAuth and an explicit push of an Ashbi event to the primary calendar (`src/services/google-calendar-sync.service.js`). Deletes can propagate. The Schedule page is the hub calendar.

**Missing.** Nothing imports Google events. There is no conflict handling and no calendar picker (the stored id defaults to `primary`). Settings copy says Ashbi stays the source of truth and events are not imported. A person who lives in Google Calendar will not see those meetings in the hub.

**Files.** `src/routes/google-calendar.routes.js`, `src/routes/calendar.routes.js`, `web/src/pages/Schedule.jsx`, `web/src/pages/Settings.jsx`.

### Notion, Bonsai and ClickUp importers

| Source | What exists | Daily-use gap |
| --- | --- | --- |
| Notion | Markdown export importer, dry-run, confirm, conflict report, rollback by run id. `scripts/import-notion-markdown.js`, `docs/notion-markdown-migration.md`. | No in-app import. A real export has not been signed off. Databases, relations and files need the reconciliation in that doc. |
| Bonsai | `scripts/import-bonsai-full.js` writes clients, contacts, projects, invoices, time and expenses in one transaction. | No run ledger and no rollback by run id. A second run overwrites matched clients and projects. Warnings do not block the commit. |
| ClickUp | `scripts/import-clickup-tasks.js` prints a CSV plan and refuses `--confirm`. It never writes the database. | Historical tasks are typed in by hand from the report. |

### ClickUp ongoing sync

**Missing.** There is no ClickUp API client, webhook, poller, or `CLICKUP_` environment variable. The hub cannot pull tasks assigned to Cameron or comments that @mention him, and it also cannot post back. PureSEM cannot move into the hub’s daily queue until this is built. Keep it one-way.

**Files to add, not extend.** A new `src/services/clickup-sync.service.js` (name flexible), a scheduled job next to `src/jobs/`, and a settings block. Do not bolt it onto `src/services/clickup-import-plan.service.js`; that file is a CSV planner.

### MCP and OAuth for assistants

**Works in code.** API keys with `workspace:read` and `workspace:actions`. Writes return a preview and need `confirm_action` (`src/integrations/workspace-tools.js`). Optional ChatGPT OAuth (`MCP_OAUTH_ENABLED`, default off) grants read-only unless an admin checks extra scopes. OAuth tokens are rejected on ordinary API routes. Docs: `docs/chatgpt-oauth.md`, `docs/scoped-mcp-oauth-actions.md`, `docs/workspace-api-mcp.md`.

**Missing before an assistant is safe to rely on.** The flag is off, `.env.example` does not mention it, and a real ChatGPT connect/revoke has not been accepted ([#561](https://github.com/camster91/ashbi-platform/issues/561)). `confirm_action` proves the caller sent a second HTTP request, not that a human clicked in the hub. The workspace API doc’s tool table is smaller than the live catalogue.

### Alerts

See Production health. Issue [#303](https://github.com/camster91/ashbi-platform/issues/303) is still open. Sentry initializes only when `SENTRY_DSN` is set (the local log said it skipped).

### Backups and restore

**Works as a single-database VPS job.** `scripts/backup-vps.sh` writes an age-encrypted archive (Postgres, uploads, `.env`) and a status file. `scripts/restore-drill-vps.sh` and `docs/backup-and-restore.md` describe a same-host drill. GitHub `db-backup.yml` stores an encrypted dump as an artifact. A workspace export CLI can dump one organization (`scripts/export-workspace.js`).

**Missing before this is the only copy of the business.** Off-host copies and key custody are still open ([#282](https://github.com/camster91/ashbi-platform/issues/282), [#381](https://github.com/camster91/ashbi-platform/issues/381)). Redis is not in the archive. There is no per-tenant backup. A drill written down is not a drill this audit re-ran.

### WordPress “Ashbi Bridge”

**On `main` the bridge is gone.** Removed 24 September 2026 (`54737212`). `wp_*` models remain in Prisma and are excluded from export. The worker’s fleet digest is a retired stub. There is no PHP plugin in this repo.

**Live check.** `https://hub.ashbi.ca/api/wp-bridge` returned **404**. `https://cameronashley.ca/wp-json/` and `/wp-json/ashbi/v1/` returned **404**. This audit did not reproduce a 401. A plugin still installed from before the removal would have been failing authentication while the routes existed (issue [#295](https://github.com/camster91/ashbi-platform/issues/295), closed by removal rather than by a per-site HMAC rollout) and now has nothing to call.

**Open and not merged.** [PR #682](https://github.com/camster91/ashbi-platform/pull/682) (`restore-wp-bridge`, commit `477d1df4`) puts the bridge back. It is not on `main` and was not reviewed as a fix here. Decide: uninstall the plugin on client sites, or review that PR as a secured restore. Do not point client sites at a hub that 404s.

### Security of the public repo

**Current tree secret scan passes.** `npm run check:secrets` found no hardcoded credentials. `.env.example` is placeholders. `src/config/env.js` refuses known placeholders in production. `.env` is gitignored.

**The public tree still contains the client book.** `prisma/bonsai-seed.js` and `prisma/bonsai-seed.ts` are tracked and hold real client names, email addresses, street addresses and revenue figures from the Bonsai export. This audit does not repeat them. Remove or replace those files with synthetic data. History will still contain them until a deliberate rewrite, which needs its own decision.

**History already treated as exposed.** `docs/security/credential-exposure-2026-05.md`: a production password was committed, rotated for one account on 9 August 2026, and left in git history on purpose. Issue [#296](https://github.com/camster91/ashbi-platform/issues/296) is still open because a second account was named in an old deployment doc and the recorded rotation covered one account. Discord webhook URLs in history were reported revoked.

**Other.** Tenant isolation is an application Prisma proxy (`src/utils/prisma-tenant-proxy.js`), not Postgres row-level security. Services that import the raw client can skip the proxy. Project and intake links can still be non-expiring view tokens (called out in `docs/product-status.md`).

## UI/UX quality review

Local session, synthetic data, desktop about 1440px and a 390px-wide pass. Screenshots (artifacts, not committed):

| File | Screen |
| --- | --- |
| `01-login-desktop.webp` | Staff login |
| `02-dashboard-desktop.webp` | Dashboard |
| `03-clients.webp` | Clients |
| `04-kanban.webp` | Project board |
| `05-timesheets.webp` | Time / timesheets |
| `06-timer.webp` | Header timer |
| `07-proposals.webp` | Proposal list |
| `08-proposal-detail.webp` | Proposal detail |
| `09-invoices.webp` | Invoice list |
| `10-invoice-detail.webp` | Invoice detail |
| `11-inbox.webp` | Inbox |
| `12-portal-login.webp` | Client portal login |
| `13-portal-home.webp` | Client portal |
| `14-login-mobile.webp` | Staff login, narrow |
| `15-dashboard-mobile.webp` | Dashboard, narrow |
| `16-invoices-mobile.webp` | Invoices, narrow |
| `17-shortcuts.webp` | `?` shortcut modal |
| `18-quick-add.webp` | Ctrl/Cmd+K quick add |

Scores are 1–5 for daily polish. 5 would feel as finished as the comparison product on that quality. This is one reviewer’s pass, not a user study.

| Quality | Score | What the screens and code show |
| --- | --- | --- |
| Visual consistency | 3 | One cream / indigo / lime palette, Instrument Serif, Plus Jakarta Sans, Geist Mono (`web/src/index.css`, `docs/ui-primitives.md`). Portal login is a different composition (centered card, purple field). Finance screens are denser than the login. |
| Design system and reuse | 3 | Custom primitives in `web/src/components/ui/` (Button, Card, Input, EmptyState, skeletons). No Radix, no shadcn, no `cmdk`. Raw `bg-white` / `text-gray-*` remain in `Layout.jsx`, `Login.jsx`, toasts and attachments. Portal CSS is a parallel layer. |
| Typography and spacing | 3 | Login and headings are intentional. Invoice detail stacks many buttons and meta lines. List pages are competent tables, not editorial documents. |
| Empty, loading, error | 3 | Shared `EmptyState`, `LoadingState`, `QueryErrorState` on clients, projects, timesheets. Pipeline and search use one-off empty copy. Leads have no page, so they have no empty state. |
| Speed and perceived performance | 2 | Local navigation felt immediate. `npm run build` misses the JS budget by more than 100 KB and the portal chunk by about 10 KB. That is the wrong direction for a product you sell. Lighthouse was not run. |
| Keyboard and command palette | 2 | `g` then `c`/`p`/`i`, `n` then `c`/`p`/`i`, and `?` (`web/src/hooks/useKeyboardShortcuts.js`). Ctrl/Cmd+K opens Quick Add (project, task, client), not search. Notion’s palette searches and jumps anywhere. |
| Mobile | 3 | Login and invoices reflow. Narrow dashboard picks up a bottom bar (Home, Sales, Money, Studio, Settings) plus the header timer and search. Administration and daily work compete for the same thumb zone. |
| Accessibility (WCAG AA) | 2 | Focus rings and button names exist in the primitive docs. Human screen-reader, forced-colour and reflow evidence is still open ([#305](https://github.com/camster91/ashbi-platform/issues/305), [#317](https://github.com/camster91/ashbi-platform/issues/317)). Automated checks are not AA sign-off. |
| Onboarding | 2 | An in-app tour and checklist exist (`web/src/components/OnboardingTour.jsx`, `src/routes/onboarding.routes.js`). First-run is an invite token and an API, not a guided workspace. |
| Navigation and IA | 2 | Sidebar groups: Dashboard, Daily Queue, Inbox, Clients, then Sales, Work, Money, Studio, Settings. That is a lot of product for one person. Bonsai keeps money in one calm flow. Notion keeps almost everything as pages in a short sidebar. Estimates and proposals are separate destinations with a doc that says people cannot tell them apart (`docs/ui-redesign.md`). |

### Against Bonsai

Bonsai’s strength is a short money story: proposal that looks like a document, contract, invoice, timer, client portal, with very little chrome. Hub screens cover those nouns. The proposal and invoice pages behave like admin records (status chips, equal actions, side metadata) rather than a document you would send without editing the layout. Time is closer: a week grid, billable vs not billed, a header timer. The second timer on the project page and the approval step are friction Bonsai does not put in a solo operator’s way.

### Against Notion

Notion’s strength is a quiet page, a database you reshape, and a command palette. Hub tasks have boards, fields and a page body (`NotionEditor.jsx`). The surrounding app does not feel like that. The shell is an agency suite. Wiki and collections are extra products in the Studio group, not the place work starts. There is no palette that finds a client, a task and an invoice in one query (search is a page at `/search`).

### Design-system foundation

Keep the tokens already in `web/src/index.css` and `web/tailwind.config.js`. Do not restyle the app onto default shadcn gray. The brand is the asset.

Use Radix (the behaviour under shadcn) where the custom widgets are weakest: dialog, dropdown menu, popover, tooltip. Add `cmdk`, styled with the existing tokens, and point Ctrl/Cmd+K at it: jump, search, and create. Keep Quick Add as actions inside that palette. Copy components in the shadcn style only when they replace a bespoke widget, and map them onto `--background`, `--foreground`, `--primary`, `--accent`, `--border`, `--radius`. Leave Button, Card and EmptyState as they are until a screen PR needs them.

`docs/ui-redesign.md` already asks for one heading, one primary action, and filters behind a disclosure. Follow that. Do not open a parallel visual language.

### Screen-by-screen redesign order

Each item is one PR. Do not redesign the suite in one branch.

1. **Shell and palette.** Sidebar for a one-person day (Today, Clients, Projects, Time, Money, Inbox). Move Estimates/Contracts/Retainers/Rate cards under Money or the palette. Add the command palette. Files: `web/src/components/Layout.jsx`, `web/src/hooks/useKeyboardShortcuts.js`, `web/src/components/QuickAdd.jsx`, `web/src/App.jsx`.
2. **Dashboard.** One next action, the queue, the timer, unpaid invoices. Drop duplicate KPI rows. `web/src/pages/Dashboard.jsx`.
3. **Clients.** Primary contact, open work, last invoice, one “add client”. Pipeline as a tab or a stage on the client, not a second product, until leads exist. `web/src/pages/Clients.jsx`, `web/src/pages/Client.jsx`.
4. **Project board.** One board, dependency and waiting visible on the card, keyboard move. `web/src/pages/TaskKanban.jsx`, `web/src/components/KanbanBoard.jsx`, `web/src/pages/TaskPage.jsx`.
5. **Time.** One timer. Week grid matches the header. `web/src/pages/Timesheets.jsx`, `web/src/pages/TimeTracking.jsx`, `web/src/components/LiveTimer.jsx`.
6. **Proposal as a document.** Scope, price, terms, preview, one Send. `web/src/pages/Proposals.jsx` and the proposal detail page.
7. **Invoice.** Same document pattern. One primary action from the status (Send, or Copy pay link, or Record payment). `web/src/pages/Invoices.jsx`, `web/src/pages/InvoiceDetail.jsx`.
8. **Inbox.** Unmatched mail and “needs a reply” first. Sync state visible. `web/src/pages/Inbox.jsx`, new triage view on `src/routes/email-triage.routes.js`.
9. **Client portal.** Same tokens as staff, fewer tabs, proposals included. `web/src/pages/ClientPortal.jsx`, `web/src/pages/client-portal/portal.css`.
10. **Narrow layouts** of 1–9, after the desktop structure is stable. `docs/ui-redesign.md`.

Also fix the budget failure before calling the shell PR done, or as the PR immediately before it (`scripts/check-frontend-budgets.mjs`, route splitting in `web/src/App.jsx`).

## Productization (selling this to other agencies)

Today the hub is Ashbi’s deployment. `Organization` exists and requests are scoped, which is the start of multi-tenancy. The commercial shell around it does not exist.

| Need | Now | Missing | Size |
| --- | --- | --- | --- |
| Workspace isolation | JWT organization id, Prisma tenant proxy, integration tests. | Postgres RLS. Raw Prisma imports can bypass the proxy. One shared database. | M for a written isolation review and a ban on new raw reads. L for RLS. |
| Self-serve signup | First user on an empty database, with `ADMIN_INVITE_TOKEN` in production. Further orgs are not created by the product. | Create-a-workspace flow, email verification, “you are not the first org on this server”. | L. `src/routes/auth.routes.js`, new `web` signup routes. |
| Subscription billing for the hub | `Organization.plan` is `FREE` / `PRO` / `ENTERPRISE` and no application code reads it. Stripe bills *their clients’ invoices*. | Stripe Customer for the agency, trials, seat or feature limits, dunning, customer portal. | L. `prisma/schema.prisma`, new billing module, not `src/services/stripe.service.js` (that file is client invoices). |
| White-label | `BrandSettings`: name, logo, colours, invoice footer. Portal and PDFs use it. Default company name in the schema is “Ashbi Design”. | Custom domain, per-tenant email domain, staff shell title/favicon, removal of Ashbi from error copy (`web/src/lib/support.js`). | M for shell and email. L for custom domains. |
| Roles | `ADMIN`, `TEAM`, `CLIENT`, `BOT`. Admins see money and credentials. | Custom roles (billing-only, no credentials). | M. `src/middleware/require-staff.js`, route guards. |
| Import for a new customer | CLI importers for Notion markdown, Bonsai CSV, Slack export, Loom, MarkUp. ClickUp is a dry run. | An in-product import wizard, sample data, and a rollback story for Bonsai. | M for a guided CSV/Markdown upload on top of the existing scripts. L if every source must be self-serve. |
| Security bar for a public repo and other tenants | Secret scan, session revocation, MFA feature, audit events. | Remove the client seed. Close [#296](https://github.com/camster91/ashbi-platform/issues/296). Per-tenant encryption keys are one deployment keyring. | S for the seed file. L for history rewrite and tenant keys. |
| Backups per tenant | Whole-database encrypted backup. Operator export CLI. | Self-serve export in the UI, restore of one workspace, a backup a tenant can see. | M for UI export. L for per-tenant restore. |
| Support path | Optional Sentry. Admin read-only impersonation for 30 minutes inside one org. Break-glass CLI. | A vendor console across tenants, a status page, a named on-call owner. Health’s public `degraded` flag hides the cause. | M. `src/routes/privileged-access.routes.js`, `src/services/runtime-health.service.js`. |
| Legal | Client contracts and proposals can contain terms. | Terms of Service, privacy policy and DPA for *using the hub*. Issue [#310](https://github.com/camster91/ashbi-platform/issues/310) is still the decision. | M, mostly counsel plus pages. |
| Pricing hooks | The unused `plan` column. | Map plan to seats, AI budget, portal, and import. Read the column in one module so later PRs can check it. | M, after the billing model exists. S to add the helper and refuse to invent prices. |

Do not start the commercial work before Cameron can run Ashbi Design on the hub for a month. The productization PRs below are sequenced after the switchover blockers.

## Backlog

Sizes: **S** a focused PR, **M** a few subsystems, **L** a new product surface or an external rehearsal.

### Must fix before switching over

| ID | Item | Size | Files |
| --- | --- | --- | --- |
| M1 | Take the real client book out of the public tree. Replace `prisma/bonsai-seed.js` and `prisma/bonsai-seed.ts` with synthetic data or delete them. History rewrite is a separate decision, not this PR. | S | `prisma/bonsai-seed.js`, `prisma/bonsai-seed.ts` |
| M2 | Confirm the second historical account no longer accepts the rotated password, and record that without identifiers ([#296](https://github.com/camster91/ashbi-platform/issues/296)). Turn on organization MFA for staff. | S | `docs/security/credential-exposure-2026-05.md`, `web/src/components/OrganizationMfaPolicy.jsx` |
| M3 | Make `degraded` explain itself to an admin (backup age, failed-job count, missing owner, missing destination) and set those in production. Do not put the detail on the public probe. | S | `src/services/runtime-health.service.js`, `web/src/pages/Settings.jsx` |
| M4 | One off-host backup copy and one restore drill, written down with the revision ([#282](https://github.com/camster91/ashbi-platform/issues/282)). | M | `scripts/backup-vps.sh`, `scripts/restore-drill-vps.sh`, `docs/backup-and-restore.md` |
| M5 | ClickUp one-way pull: tasks assigned to Cameron, and comments that @mention him. Never write back. Map into existing tasks with a source id. | L | New service and job; `prisma/schema.prisma`; settings UI. Not `src/services/clickup-import-plan.service.js`. |
| M6 | Gmail for the real mailbox: connection status on screen, manual sync, a queue for unmatched mail, send still confirmed by a person. Widen past a 48-hour INBOX if that window loses client mail. | L | `src/services/gmail-sync-scan.js`, `src/routes/gmail.routes.js`, `src/routes/email-triage.routes.js`, `web/src/pages/Inbox.jsx` |
| M7 | Show Google Calendar events in Schedule (read-only inbound is enough). Keep Ashbi-created events pushing out. | M | `src/services/google-calendar-sync.service.js`, `src/routes/google-calendar.routes.js`, `web/src/pages/Schedule.jsx` |
| M8 | Rehearse Notion markdown import and Bonsai CSV import on a copy, with a backup taken first. Add Bonsai run id and rollback before the real run. | M | `scripts/import-bonsai-full.js`, `scripts/import-notion-markdown.js`, `docs/bonsai-migration.md`, `docs/migration-cutover-runbook.md` |
| M9 | One real path: proposal sent by a person, contract signed, invoice, Stripe test payment, webhook, receipt. Fix what breaks. | M | `src/services/stripe.service.js`, `src/routes/invoice.routes.js`, `src/routes/webhook.routes.js`, Mailgun senders |
| M10 | One timer. Project time page uses `TimeSession`. | S | `web/src/pages/TimeTracking.jsx`, `web/src/components/LiveTimer.jsx`, `src/routes/time-session.routes.js` |
| M11 | `npm run build` meets `docs/frontend-performance-budgets.md` again. | M | `web/src/App.jsx`, `scripts/check-frontend-budgets.mjs` |
| M12 | WordPress: either uninstall the old plugin on sites that still call the hub, or review [PR #682](https://github.com/camster91/ashbi-platform/pull/682) as a secured restore. Live hub route is 404. | M | Historical `src/routes/wp-bridge.routes.js` on that PR; site plugins are outside this repo |

### Needed soon after

| ID | Item | Size | Files |
| --- | --- | --- | --- |
| S1 | Staff page for unmatched email and public inquiries, with convert-to-client. | M | `src/routes/leads.routes.js`, `src/routes/client-acquisition.routes.js`, new page under `web/src/pages/` |
| S2 | Command palette (search + jump + create) in place of Quick Add as the only Ctrl/Cmd+K. | M | `web/src/components/Layout.jsx`, `web/src/components/QuickAdd.jsx` |
| S3 | Shell IA for a one-person day, then the screen PRs in the order above. | M each | `web/src/components/Layout.jsx`, then one page per PR |
| S4 | Proposal and invoice as documents with one primary action. | M | proposal and invoice pages |
| S5 | Signed-in portal lists proposals. Portal uses the same tokens as staff. | M | `web/src/pages/ClientPortal.jsx`, `src/routes/client-portal.routes.js` |
| S6 | Task dependency visible on the board. | S | `web/src/pages/TaskPage.jsx`, `web/src/components/KanbanBoard.jsx` |
| S7 | MCP: document `MCP_OAUTH_ENABLED`, run one real ChatGPT connect and revoke in a QA tenant, keep default grant read-only ([#561](https://github.com/camster91/ashbi-platform/issues/561)). | M | `docs/chatgpt-oauth.md`, `.env.example`, `src/auth/mcp-oauth-provider.js` |
| S8 | Human screen-reader pass on login, dashboard, board, invoice, portal ([#305](https://github.com/camster91/ashbi-platform/issues/305)). | M | shell and portal components |
| S9 | Estimate PDF, or stop offering estimates as a separate sendable doc. | S | `src/routes/estimate.routes.js` |

### Nice to have

| ID | Item | Size | Files |
| --- | --- | --- | --- |
| N1 | Self-serve second organization. | L | `src/routes/auth.routes.js`, signup UI |
| N2 | Hub subscription billing that reads `Organization.plan`. | L | new billing module |
| N3 | Custom domain and from-address per tenant. | L | `src/routes/brand.routes.js`, mail config |
| N4 | Custom roles. | M | auth middleware |
| N5 | In-product import wizard. | M | importer scripts, new UI |
| N6 | Per-tenant self-serve export button (CLI already exists). | M | `scripts/export-workspace.js`, settings UI |
| N7 | Terms, privacy, DPA pages. | M | `web/src/App.jsx`, counsel |
| N8 | Passkeys. | M | `src/auth/mfa.js` |
| N9 | Postgres RLS as a second isolation layer. | L | `prisma/migrations` |
| N10 | Vendor support console. | L | new admin app |
| N11 | Radix dialogs/menus skinned with current tokens. | M | `web/src/components/ui/`, `web/src/components/Modal.jsx` |
| N12 | ClickUp historical import that writes, if the ongoing sync is not enough. | M | `scripts/import-clickup-tasks.js` |

## PR order for follow-up agents

Take one row. Do not combine them.

| PR | Takes | Why this order |
| --- | --- | --- |
| 1 | M1 | Public client data is the worst current exposure. Docs-only is not enough; this is a deletion/redaction of seed content. |
| 2 | M2 | Finish the known credential follow-up and turn MFA on. Small, and it should land before more client data is typed in. |
| 3 | M3 | An admin must see why health is degraded before trusting the VPS. |
| 4 | M11 | The build gate is red on this tree. Later UI PRs should start from a green `npm run build`. |
| 5 | M10 | One timer is a small daily-use fix and unblocks trusting time. |
| 6 | M5 | PureSEM does not show up without the ClickUp pull. Largest new feature. One PR, behind a flag, no write-back. |
| 7 | M6 | Gmail triage and connection UI. Do not auto-send. |
| 8 | M7 | Calendar read of Google events. |
| 9 | M8 | Importer rollback, then a rehearsal on a copy. Cameron runs the real import; the PR makes it reversible. |
| 10 | M9 | Stripe and mail proof. Code changes only where the rehearsal fails. |
| 11 | M4 | Off-host backup and a drill. Operator runbook plus any script gap. |
| 12 | M12 | WordPress decision. Review #682 or document uninstall. Do not merge #682 inside an unrelated PR. |
| 13 | S2 + first shell slice of S3 | Palette and a shorter sidebar. |
| 14–20 | Remaining screen PRs in the redesign order | One screen each. |
| 21 | S1, S4, S5, S6, S7, S8, S9 | Soon-after, one each, after daily use has started. |
| 22+ | N1–N12 | Productization. Do not start until Ashbi Design has run a month on the hub. N2 before N7’s pricing claims. N1 before any public signup link. |

## What “switched over” means

Ashbi Design can stop opening Notion and Bonsai when all of these are true:

- M1–M4 are done (data not in git, MFA on, health understood, a backup restored once off the same disk).
- A Notion export and a Bonsai export have been imported, counted, and checked by Cameron, with the source apps still available to read.
- A proposal, a contract and an invoice have gone out from the hub, and a Stripe test payment has reconciled.
- Time for a real week was tracked with the one timer and turned into that invoice.
- Gmail for the studio mailbox is visible in Inbox, and a reply was sent only after a person confirmed it.
- Google events Cameron cares about show on Schedule.
- If PureSEM work should appear in the hub, M5 is on and a week of assigned tasks matched ClickUp. ClickUp remains the place PureSEM is edited.

Until then the source apps stay primary. That is the same gate `docs/replacement-readiness-matrix.md` already states. This audit’s addition is the ClickUp pull, the public seed data, the red frontend budget, and the UI/productization sequence.
