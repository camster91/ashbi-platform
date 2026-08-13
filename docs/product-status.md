# Canonical product and release status

This is the repository's authoritative status map as of 2026-08-13. A feature is **code-present** when routes/UI/tests exist, **target-verified** only when target-environment evidence exists, **blocked** when an external decision/provider/human gate remains, and **deferred** when it is explicitly outside the current supported milestone. Code presence is never sufficient evidence for production, accessibility, legal, provider, or market-readiness claims.

The active agency-replacement acceptance map is [replacement-readiness-matrix.md](replacement-readiness-matrix.md).

## Current supported milestone

The supported milestone is a controlled Ashbi agency-operations deployment: authenticated staff/client workflows, project and task management, finance document preparation, collaboration/docs, client portal, and WordPress operations on `hub.ashbi.ca`. It is not yet proven as a general-market replacement for ClickUp, Notion, Slack, or Bonsai. The milestone/deferral decision remains tracked in [#277](https://github.com/camster91/ashbi-platform/issues/277); the complete backlog and release plan are [#290](https://github.com/camster91/ashbi-platform/issues/290) and [#291](https://github.com/camster91/ashbi-platform/issues/291).

| Capability | Classification | Authoritative evidence or remaining gate |
| --- | --- | --- |
| Authentication, session revocation, roles, tenancy | Code-present and production-deployed | Security/unit/integration coverage; authenticated manual evidence remains in [#319](https://github.com/camster91/ashbi-platform/issues/319) and [#305](https://github.com/camster91/ashbi-platform/issues/305) |
| Clients, projects, tasks, time, team operations | Code-present and production-deployed | Final supported workflow/IA decision in [#309](https://github.com/camster91/ashbi-platform/issues/309) |
| Proposals, contracts, invoices, estimates, expenses | Code-present; provider lifecycle not cleared | Full revenue journey [#280](https://github.com/camster91/ashbi-platform/issues/280), Stripe [#378](https://github.com/camster91/ashbi-platform/issues/378), email [#379](https://github.com/camster91/ashbi-platform/issues/379), e-sign/retention [#380](https://github.com/camster91/ashbi-platform/issues/380) |
| Project docs/wiki | Code-present; broader real-tenant evidence pending | [#285](https://github.com/camster91/ashbi-platform/issues/285) |
| Authenticated client portal | Code-present; controlled QA evidence pending | [#286](https://github.com/camster91/ashbi-platform/issues/286) |
| Role-aware onboarding | Code-present; product approval/live role captures pending | [#111](https://github.com/camster91/ashbi-platform/issues/111) |
| Undo/recovery and workflow states | Partially migrated | [#108](https://github.com/camster91/ashbi-platform/issues/108), [#320](https://github.com/camster91/ashbi-platform/issues/320) |
| PWA and push preferences | Code-present; live browser/OS permission delivery pending | [#321](https://github.com/camster91/ashbi-platform/issues/321) |
| WordPress bridge/fleet | Code-present and tenancy-hardened | Continue target workflow evidence under release/backlog tracking |
| Project screen recordings and calls | Code-present; target network and retention evidence pending | Project-scoped browser WebM recording and one-to-one WebRTC audio/video UI; managed TURN, retention/processing policy, and authenticated browser evidence remain required before Loom/Slack-call replacement claims |
| Slack inbound/notifications | Code-present; not production or provider verified | Signed/replay-safe inbound events, OAuth v2/encrypted setup, tenant project/channel mapping, idempotent inbound receipts, mapped chat delivery, and confirmed outbound mapped posts are committed; deployment, Slack app approval, sandbox verification, retention, thread/channel parity, and outbound retry/recovery remain under [#288](https://github.com/camster91/ashbi-platform/issues/288) |
| Notion migration | Controlled Markdown-export importer and durable source reconciliation code-present; target migration evidence pending | The importer reports planned hierarchy, changed-source/destination conflicts, and unsupported assets without overwriting them; follow [notion-markdown-migration.md](notion-markdown-migration.md), retain backup/reconciliation evidence, and validate a real project import before replacement claims ([#289](https://github.com/camster91/ashbi-platform/issues/289)) |
| Google Calendar sync | Per-user OAuth and explicit outbound primary-calendar create/update code-present; validation/provider access pending | Encrypted refresh-token lifecycle, idempotent external IDs, and an atomic in-progress sync claim are committed; provider configuration, calendar selection, conflict/delete and provider-failure recovery policy, and sandbox evidence remain under [#287](https://github.com/camster91/ashbi-platform/issues/287) |
| Design system/dark mode/visual baselines | In progress | [#118](https://github.com/camster91/ashbi-platform/issues/118), [#315](https://github.com/camster91/ashbi-platform/issues/315), [#316](https://github.com/camster91/ashbi-platform/issues/316), [#322](https://github.com/camster91/ashbi-platform/issues/322) |
| Accessibility | Automated slices deployed; human AT/forced-colour evidence pending | [#305](https://github.com/camster91/ashbi-platform/issues/305), [#317](https://github.com/camster91/ashbi-platform/issues/317), [#318](https://github.com/camster91/ashbi-platform/issues/318) |
| Telemetry/alerts | Runtime health deployed; external destination/owner blocked | [#303](https://github.com/camster91/ashbi-platform/issues/303) |
| ChatGPT-compatible AI bridge | Read-only tenant-scoped context bridge plus confirmed task creation and mapped Slack post code-present; target validation pending | [chatgpt-connector.md](chatgpt-connector.md) and the [authenticated replacement validation runbook](authenticated-replacement-validation.md); actions require separate confirmation, idempotency, tenant ownership, and an audit record. Other actions and provider effects remain gated |
| Backups/restores | Daily encrypted same-host backup and isolated restore proven; disaster recovery blocked | [#282](https://github.com/camster91/ashbi-platform/issues/282) |
| Privacy/retention | Decision-dependent | [#310](https://github.com/camster91/ashbi-platform/issues/310) |
| Credential key custody/rotation | External approval required | [#381](https://github.com/camster91/ashbi-platform/issues/381) |
| GitHub CI browser/integration execution | Deferred while direct local/VPS verification is the requested path | [#283](https://github.com/camster91/ashbi-platform/issues/283) |
| Development dependency vulnerability | Upstream remediation pending | Dependabot [alert #127](https://github.com/camster91/ashbi-platform/security/dependabot/127) traces the high-severity `extract-zip` advisory through Lighthouse CI; no patched `extract-zip` version is published and the suggested downgrade would regress the release toolchain |
| Application composition modularization | Deferred P2 maintainability work | [#308](https://github.com/camster91/ashbi-platform/issues/308) |
| Cross-repository issue/release operating system | Planning/tracking, not a product capability | [#292](https://github.com/camster91/ashbi-platform/issues/292) |
| UX tracking and polished-release roadmap | Meta tracking; child evidence remains authoritative | [#323](https://github.com/camster91/ashbi-platform/issues/323), [#324](https://github.com/camster91/ashbi-platform/issues/324) |

## Authoritative engineering paths

- Setup and checks: [README.md](../README.md), `.env.example`, and root/web package scripts.
- Schema: `prisma/schema.prisma` plus the committed `prisma/migrations` chain. Shared/production environments use `prisma migrate deploy`.
- Release gates: [release-gates.md](release-gates.md).
- Production deployment and rollback: [deployment-and-rollback.md](deployment-and-rollback.md).
- Encrypted backup and isolated restore: [backup-and-restore.md](backup-and-restore.md).
- Runtime objectives, telemetry privacy, escalation, and drills: [observability-and-slos.md](observability-and-slos.md).
- Security headers, upload policy, soft deletion, credential vault, and session revocation: the corresponding files under `docs/` and `docs/security/`.
- Connected provider/AI permissions, approval, and audit boundaries: [connected-workflow-contract.md](connected-workflow-contract.md).
- Target-environment dogfood, provider, migration, revenue, media, and recovery evidence: [authenticated-replacement-validation.md](authenticated-replacement-validation.md).

## Required verification matrix

Critical states include initial/loading/slow/empty/partial/offline/permission/validation/conflict/rate-limit/server failure/retrying/unsaved/saved/success/fatal recovery; see [workflow-state-matrix.md](workflow-state-matrix.md). Release evidence must cover supported Chromium, Firefox, and WebKit paths; 320/375/430/768/1024/1366/1440/1920 layouts where applicable; 200% text and 400% reflow; keyboard/focus; WCAG 2.2 AA contrast; reduced motion; forced colour; mobile and desktop screen readers; and sanitized visual baselines under [#322](https://github.com/camster91/ashbi-platform/issues/322). Email rendering and provider/OS states require their real target environments.

## Approval boundary

Product, infrastructure, privacy/retention, monitoring ownership, recovery-key custody, payment/email/e-sign providers, live assistive-technology review, and public/paid launch approval remain human or external gates. Documentation must keep those states pending until direct evidence is attached; no contributor should infer approval from tests or route existence.
