# Canonical product and release status

This is the repository's authoritative status map as of 2026-08-09. A feature is **code-present** when routes/UI/tests exist, **target-verified** only when target-environment evidence exists, **blocked** when an external decision/provider/human gate remains, and **deferred** when it is explicitly outside the current supported milestone. Code presence is never sufficient evidence for production, accessibility, legal, provider, or market-readiness claims.

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
| Slack inbound/notifications | Deferred, not supported | [#288](https://github.com/camster91/ashbi-platform/issues/288) |
| Notion migration | Deferred, not supported | [#289](https://github.com/camster91/ashbi-platform/issues/289) |
| Google Calendar sync | Validation/provider access pending | [#287](https://github.com/camster91/ashbi-platform/issues/287) |
| Design system/dark mode/visual baselines | In progress | [#118](https://github.com/camster91/ashbi-platform/issues/118), [#315](https://github.com/camster91/ashbi-platform/issues/315), [#316](https://github.com/camster91/ashbi-platform/issues/316), [#322](https://github.com/camster91/ashbi-platform/issues/322) |
| Accessibility | Automated slices deployed; human AT/forced-colour evidence pending | [#305](https://github.com/camster91/ashbi-platform/issues/305), [#317](https://github.com/camster91/ashbi-platform/issues/317), [#318](https://github.com/camster91/ashbi-platform/issues/318) |
| Telemetry/alerts | Runtime health deployed; external destination/owner blocked | [#303](https://github.com/camster91/ashbi-platform/issues/303) |
| ChatGPT-compatible AI bridge | Read-only tenant-scoped context bridge deployed; write tools intentionally gated | [chatgpt-connector.md](chatgpt-connector.md) and action-bridge readiness under the replacement goal |
| Backups/restores | Daily encrypted same-host backup and isolated restore proven; disaster recovery blocked | [#282](https://github.com/camster91/ashbi-platform/issues/282) |
| Privacy/retention | Decision-dependent | [#310](https://github.com/camster91/ashbi-platform/issues/310) |
| Credential key custody/rotation | External approval required | [#381](https://github.com/camster91/ashbi-platform/issues/381) |
| GitHub CI browser/integration execution | Deferred while direct local/VPS verification is the requested path | [#283](https://github.com/camster91/ashbi-platform/issues/283) |
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

## Required verification matrix

Critical states include initial/loading/slow/empty/partial/offline/permission/validation/conflict/rate-limit/server failure/retrying/unsaved/saved/success/fatal recovery; see [workflow-state-matrix.md](workflow-state-matrix.md). Release evidence must cover supported Chromium, Firefox, and WebKit paths; 320/375/430/768/1024/1366/1440/1920 layouts where applicable; 200% text and 400% reflow; keyboard/focus; WCAG 2.2 AA contrast; reduced motion; forced colour; mobile and desktop screen readers; and sanitized visual baselines under [#322](https://github.com/camster91/ashbi-platform/issues/322). Email rendering and provider/OS states require their real target environments.

## Approval boundary

Product, infrastructure, privacy/retention, monitoring ownership, recovery-key custody, payment/email/e-sign providers, live assistive-technology review, and public/paid launch approval remain human or external gates. Documentation must keep those states pending until direct evidence is attached; no contributor should infer approval from tests or route existence.
