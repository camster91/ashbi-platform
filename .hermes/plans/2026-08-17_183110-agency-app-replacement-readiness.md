# Ashbi agency-app replacement readiness plan

## Goal

Make Ashbi safe and practical for Ashbi Design to use as its primary replacement for ClickUp, Notion, Slack, Loom, and Bonsai, with ChatGPT/Codex able to use approved tenant-scoped features through explicit, auditable actions.

Replacement-ready means the target workflow is proven with authenticated users, real browser journeys, approved provider sandboxes, recoverable data, monitored production services, and reconciled migration samples. Code presence or a successful deployment alone is insufficient.

## Current context

- Production revision `6522707b0865ec66291471561cebab84e5c31762` is deployed at `https://hub.ashbi.ca` through the immutable VPS controller.
- API, worker, database, Redis, HTTPS, exact revision reporting, and encrypted same-host backup are healthy.
- Health remains degraded because three historical embedding jobs need a valid Ollama Cloud credential and alert destination/owner configuration is incomplete.
- Core task, document, portal, revenue, chat, Slack bridge, Calendar, ChatGPT action, screen-recording, and one-to-one WebRTC code exists at different levels of validation.
- GitHub Actions are intentionally not the production deployment path; VPS release gates remain authoritative.

## GitHub tracking

- Master roadmap: [#393](https://github.com/camster91/ashbi-platform/issues/393)
- Authenticated agency workflows and ChatGPT actions: [#390](https://github.com/camster91/ashbi-platform/issues/390)
- Screen recordings and audio/video calls: [#391](https://github.com/camster91/ashbi-platform/issues/391)
- ClickUp, Notion, Slack, and Bonsai migration pilots: [#392](https://github.com/camster91/ashbi-platform/issues/392)
- Canonical technical backlog and shipping plan: [#290](https://github.com/camster91/ashbi-platform/issues/290) and [#291](https://github.com/camster91/ashbi-platform/issues/291)
- Credential-vault ownership and rotation clearance: [#381](https://github.com/camster91/ashbi-platform/issues/381)

## Execution order

### Wave 0: restore a clean operational baseline

1. Resolve #382 with an approved Ollama credential, retry the three embedding jobs once, and verify clean worker/API health.
2. Complete #303 by configuring a monitored alert destination, named operational owner, privacy controls, and drill evidence.
3. Complete #282 by establishing encrypted off-host backups, approved key custody, and an isolated restore drill with measured RPO/RTO.
4. Keep the immutable deployment controller, exact-revision smoke test, rollback containers, and post-release observation as mandatory gates.

Exit: production reports the expected revision, zero unexplained failed jobs, current backup health, and tested alert delivery to an accountable owner.

### Wave 1: prove the daily agency workflow

1. Run authenticated ADMIN, MEMBER, and CLIENT journeys for clients, projects, tasks, time, docs, inbox/chat, portal, uploads, permissions, offline/failure/retry, accessibility, and responsive behavior.
2. Complete #285 and #286 for daily documents/wiki and client-portal use.
3. Validate the ChatGPT/Codex connector with bounded reads and prepare/confirm actions; test denial, tenant isolation, idempotency, audit records, and prompt-injection boundaries.
4. Record screenshots, action IDs, audit records, and defects without storing secrets or client-sensitive data in GitHub.

Exit: Ashbi Design can complete a representative client project from intake through delivery with a documented fallback and no unowned P0/P1 defect.

### Wave 2: validate external providers and revenue

1. Complete #378 using Stripe test mode, including success, failure, cancellation, duplicate/out-of-order webhooks, and reconciliation.
2. Complete #379 using an approved Mailgun/test email environment for proposal, contract, and invoice delivery plus bounce/retry behavior.
3. Complete #380 with approved e-signature evidence, immutable document, audit, retention, export, and dispute-response requirements.
4. Complete #287 for Google Calendar OAuth. Treat a failed first create without a recorded external event ID as an unknown outcome: reconcile before any retry. Retry only failed updates with a known external event ID. Validate disconnect, revocation, tenant isolation, and the explicitly deferred conflict/delete cases.
5. Complete #288 for Slack OAuth, signed inbound events, mapped threads, confirmed outbound actions, unknown-outcome recovery, disconnect, retention, and notification preferences.

Exit: all selected provider-backed journeys pass in safe test environments and every external side effect is observable, idempotent where required, recoverable, and auditable.

### Wave 3: productionize recording and calls

1. Define recording/call consent, retention, deletion, transcription, accessibility, storage, bandwidth, and incident policies under #310.
2. Validate project-scoped screen capture, upload, playback, authorization, limits, interruption recovery, deletion, and transcript workflow.
3. Configure managed TURN and validate one-to-one audio/video plus in-call screen sharing across restrictive networks and supported browsers/devices.
4. Add quality telemetry, support/runbooks, privacy-safe diagnostics, and an explicit multi-party architecture decision.

Exit: Loom-style asynchronous recordings are production-proven; Slack-call replacement is claimed only for the explicitly supported participant/network matrix.

### Wave 4: migrate and reconcile incumbent data

1. Inventory representative sanitized exports from ClickUp, Notion, Slack, and Bonsai.
2. Run dry-run import/reconciliation tools and resolve missing inputs, unsupported assets, hierarchy, identity, ownership, totals, and timestamp findings.
3. Take an approved backup, perform controlled imports, retain non-overwritable reports/checksums, and verify source-to-destination counts and samples.
4. Export the resulting Ashbi workspace and prove portability and recovery.
5. Pilot one real project per incumbent tool while retaining the original system as read-only fallback.

Exit: each migration has a signed reconciliation report, rollback/recovery evidence, accountable owner, and explicit disposition for every unsupported record.

### Wave 5: replacement decision and staged retirement

1. Re-run the complete authenticated replacement checklist against the exact release artifact.
2. Close or explicitly defer every linked issue with owner, reason, risk, and review trigger.
3. Conduct a time-boxed Ashbi Design dogfood period and compare task completion, communication, billing, migration accuracy, reliability, support burden, and user satisfaction.
4. Before retiring any provider-backed incumbent workflow, complete #381: name the credential-key owner, validate rotation and emergency recovery, and retain the drill evidence.
5. Retire incumbent apps one workflow at a time only after the corresponding exit gate passes; retain export/read-only fallback for the approved transition window.

Exit: product, operations, finance, privacy/legal, and affected users approve the supported replacement scope; no core system is retired based only on code or local tests.

## Likely implementation areas

- `src/routes/`, `src/services/`, `src/jobs/`, and `prisma/` for provider, worker, audit, retention, migration, and recovery behavior.
- `web/src/` for authenticated workflows, media UX, permission/error/retry states, accessibility, and responsive QA fixes.
- `scripts/` for migration reconciliation, release verification, backup/restore, and evidence generation.
- `tests/` and `web/src/**/*.test.*` for integration, browser, tenant-isolation, provider sandbox, and regression coverage.
- `docs/authenticated-replacement-validation.md`, `docs/replacement-readiness-matrix.md`, `docs/product-status.md`, and provider/runbook documentation for current evidence and operational ownership.

## Validation contract

- Source gates: lint, typecheck, unit/integration tests, production build, migration checks, security checks, and performance budgets.
- Release gates: immutable image ID, exact revision, current encrypted backup, migration status, API/worker readiness, zero restart loop, HTTPS, and rollback evidence.
- Product gates: authenticated role journeys, permission/tenant isolation, accessibility, responsive/browser matrix, failure/retry/offline states, and screenshots.
- Provider gates: approved non-production credentials, revocation/replay/error cases, reconciliation, and scrubbed logs.
- Migration gates: complete input inventory, dry run, backup, atomic confirm where supported, non-overwritable report, counts/samples, and fallback.

## Risks and decisions

- Provider credentials, alert ownership, legal/privacy/retention policy, managed TURN, off-host backup destination, and representative source exports require authorized human input.
- Slack history parity, full Notion parity, multi-party calls, and broad autonomous AI writes should remain explicitly deferred unless selected and independently proven.
- ChatGPT/Codex actions must stay allowlisted, tenant-scoped, prepare/confirm gated, idempotent, and auditable; retrieved content is untrusted input.
- Production deployment success does not prove market replacement readiness. Incumbent retirement is a separate business acceptance decision.
