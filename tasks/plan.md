# Simple Ashbi workspace implementation plan

> **Historical planning reference — 27 October 2026:** The owner closed all
> remaining issues and PRs. The linked execution queue and the hold on #684 below
> record earlier direction; #684 is now closed unmerged. These closures do not
> establish delivery or acceptance. Follow the current owner request for new work.

Decision date: 23 October 2026. Canonical execution tracker: [#565](https://github.com/camster91/ashbi-platform/issues/565). Tasks live in GitHub Issues, not a second checklist here.

## Outcome and authority

Replace Cameron and Bianca's daily Bonsai and Notion workflows with one small agency app and client portals. This is an internal two-person product, not a general-market SaaS or an AI agency operating system. Clients are additional restricted principals, not two unrestricted shared accounts.

The owner authorized planning, GitHub issue cleanup and reviewable source cleanup. This does not authorize production migration, deployment, client invitations/messages, financial transactions, source cancellation or changing release settings. The owner explicitly chose to leave PR #684 open and leave automatic Coolify settings unchanged. A main-branch merge can deploy: do not merge or enable auto-merge of this plan or cleanup work without a verified separately approved release path.

Replacement is the destination. Bonsai/Notion remain operational only until reconciliation and cutover acceptance; there is no requirement to keep Notion as the permanent project system.

## Capability map

| Module | Responsibility | Depends on |
| --- | --- | --- |
| foundation | Workers runtime, D1 constraints, sessions, private storage, backup/export | — |
| client-work | Clients, contacts, projects, tasks, boards, assignments, deadlines | foundation |
| documents | Notes, basic hierarchy, project files, approval records | client-work |
| time | One running timer per staff user, manual and billable time | client-work |
| commerce | Proposals, contracts, deposits, Stripe invoice drafts/status | documents, time |
| portal | Own-client access to permitted project, file, approval and commercial records | commerce |
| migration | Reconciled source identities, original files and history | portal |

Build foundation first, then complete retained workflows in vertical slices. Reuse the existing React interface and validated contracts where practical. Do not rewrite every module simply because the target runtime differs. Module implementation issues remain Preparation until the prototype and their dependencies pass.

## Product scope

Keep clients/contacts; project/task list and board; assignments/dates/comments; documents/checklists/basic hierarchy; files and ordinary search; one timer/manual time; proposals; contract templates and signing evidence; project approvals; fixed-price/time invoices/deposits; per-client portal and a focused daily dashboard. Preserve financial/retainer/recurrence history. Recurring billing activation and formal signature evidence remain explicit decisions rather than silently removed features.

Proposed staff navigation: Dashboard, Clients, Projects, Documents, Finance, with Settings secondary. Portal navigation exposes only the relevant client's permitted records. #309/#315/#316 own the reusable UI patterns and design review before large screen changes.

Defer new embedded AI/BYOK/semantic search, general staff chat, calls/recording/transcription, Slack/WhatsApp intake, broad mailbox/calendar sync, native packages and SaaS entitlements. Existing code/data is not automatically disposable. A minimal sender can still be needed for access links, proposals and contracts. Preserve export/import tooling until migration completes.

## Architecture hypotheses to prove

- Workers serves the existing frontend assets and a small protected API; D1 stores the retained relational data; R2 stores private originals and exports. This is a target, not a completed or proven migration.
- #689 must exercise Worker-compatible authentication, D1 concurrency/transactions and actual PostgreSQL-specific dependencies before choosing an adapter or replacing Prisma. PostgreSQL-specific migrations, triggers and raw SQL cannot simply be replayed into D1.
- Replace Redis/BullMQ and always-running workers with bounded request handling, scheduled jobs or Cloudflare queues only where retained behavior needs them. Remove the readiness dependency only after equivalent work delivery/recovery exists.
- No persistent local disk. R2 keys alone never grant access: staff/client authorization governs upload, download, search and sharing.
- Stripe Invoicing owns newly issued invoices. Existing `stripe.service.js` uses Checkout and must not be mistaken for native Stripe invoice support. The app prepares reviewed charges/source claims, stores Stripe IDs and reconciles signed events. Stripe handles hosted invoice/payment/PDF delivery.
- Preserve integer-minor-unit money, separate CAD/USD totals, explicit taxes, source time locks, unknown outcomes and idempotency. Do not reissue or charge imported historical invoices.
- Keep ordinary comments/status refresh simple; no always-on Socket.IO service is required by default. Preserve deliberate client approvals and document edit conflicts.
- Cost target: stay within free or existing paid-account allowances for two staff users and modest client activity. Account-wide usage, CPU, D1 queries/storage, R2 operations, jobs, email and Stripe fees must be measured. There is no hard $0/$5 all-services guarantee.

## Ordered GitHub work

| Phase | Parent | Ordered execution references |
| --- | --- | --- |
| 1: Scope and safe cleanup | #695 | #309 scope/UI, #686 dependency inventory, #687 dead routes, #688 native packages, #278 authoritative docs |
| 2: Runtime and privacy | #696 | #689 vertical prototype, #416 identity, #417 private files, #282 restore, #303 operational health |
| 3: Daily work | #697 | #690 clients, #405 statuses, #691 project/tasks, #692 timer, #285 documents, #461 dashboard |
| 4: Commercial workflows and portal | #280 | #693 invoice drafts, #694 event sync, #378 Stripe sandbox, #379 delivery, #380 contract evidence, #286 portal |
| 5: Source reconciliation | #414 | Notion/Bonsai/existing-Postgres mappings, synthetic rehearsal, held-record exceptions, financial/file reconciliation |
| 6: Acceptance and cutover | #698 | #403 isolated integrated QA, #398 two-person daily use, #305/#317/#318/#320 accessibility and recovery |

Checkpoint after each phase: working retained behavior, exact test evidence, unresolved risks and reviewer acceptance before dependent work. Split slices exceeding about five files or containing independent outcomes before implementation. Do not treat closure of an obsolete issue as delivery of its functionality.

## Test and acceptance strategy

Current repository commands remain `npm run lint`, `npm run type-check`, `npm test`, `npm --prefix web test`, `npm run build` and `npm run check:secrets`. These verify the existing runtime; they do not prove Workers/D1 compatibility. #689 introduces documented local Workers commands and focused D1 integration checks before migration work begins.

Retain tests for identity/MFA/client isolation, approved visibility, exact money, time locks, source claims, signed documents, webhook replay, file integrity, edit conflicts and restore. Remove feature-specific tests only after their actual consumers are retired; preserve any unique security/accessibility assertion. Never reduce CI thresholds or remove failing tests to make the port green.

Every UI slice needs a representative 390 px phone, 768 px tablet and 1440 px desktop journey, keyboard focus/labels/contrast, clear loading/empty/error/retry states and no horizontal overflow. Private application/preview pages must not be indexed, and analytics/logging must not disclose client content, financial values, tokens or private URLs. Public SEO is not an internal-app feature requirement.

Final synthetic acceptance: staff creates client/project/task, records time and notes/files, prepares proposal/contract, client accesses only permitted records, approved invoice reaches sandbox payment, duplicate/reordered signed events remain correct, exports restore into isolation and both staff users can work without silent overwrites. Follow with separately authorized source-data rehearsal and normal daily use. No real card charge is a test.

## Migration and rollback

1. Privately inventory existing exports and source coverage; reuse prior mapping evidence without assuming completeness or requesting exports into public Git.
2. Map Notion hierarchy/content/files and Bonsai client/project/time/proposal/signed-contract/invoice/payment/retainer records. Existing app/Postgres data is a third source, not disposable history.
3. Rehearse with synthetic exports. Preserve source IDs, original bytes/hashes, authors/timestamps, ownership, permissions and separate currency totals. Unknown blocks/formulas/attachments become explicit held items.
4. Verify retry/idempotency, export/restore and source delta handling before any approved company import. Historical imports must not invite clients, send invoices/reminders or trigger billing.
5. Get cutover approval for the exact candidate and mappings; retain source exports/fallback. Source deletion and subscription cancellation are separate actions.

Rollback before cutover is the existing application and untouched source systems. After new writes begin, use a documented write fence and reviewed delta export/reconciliation before switching back; DNS rollback alone cannot restore missing data. Repair the security scanner without reverting redaction of exposed customer data. Historical Git remediation remains separate.

## Cleanup inventory and existing work

See [feature-cleanup-inventory.md](../docs/feature-cleanup-inventory.md). PR #683 is audit evidence, #685 is an earlier slimming proposal with two unresolved dependency findings, #682 is a separate WordPress bridge proposal and #684 is held security work. No existing PR is silently merged, closed, overwritten or rebased by this plan.

## Open decisions and inputs

- #689: prove transaction/CPU/storage/runtime fit and choose the Worker adapter/auth/storage implementation.
- #380/#310: approve contract signing evidence, privacy and retention; do not confuse a recorded click with a fully specified signing workflow.
- #405/#414: approve source status mappings and unsupported source-content disposition before real data changes.
- #378/#379: approved sandbox credentials/endpoints and test recipients; secrets never belong in issues or the repository.
- #398: actual import/cutover timing, client access activation and eventual cancellation. No dates or approvals have been invented.
