# Agency replacement-readiness matrix

This is the working acceptance map for making Ashbi the agency's primary operating system. It distinguishes code presence from proven replacement capability. A row is only **ready** when its listed evidence exists in the target environment; route existence or unit tests alone do not qualify.

| Agency need | Ashbi capability | Current state | Evidence required for replacement readiness |
| --- | --- | --- | --- |
| ClickUp: projects, tasks, owners, time, status | Clients, projects, tasks, time tracking, team operations | Code-present and deployed | Authenticated dogfood across create/edit/assign/complete/offline/recovery flows; export and permission checks |
| Notion: project wiki and working documents | Project docs/notes and Docs navigation | Code-present; parity incomplete | Nested-page/template/mention workflow, import sample, real-tenant editing and recovery evidence |
| Slack: internal/client conversation | Chat, inbox, realtime notifications, AI chat, optional Slack-compatible outbound webhook | Partial; outbound adapter code-present, inbound/channel bridge deferred | Configure and verify `SLACK_AGENCY_HUB_WEBHOOK_URL`, then prove delivery/retry behavior; channel/thread parity decision, notification preferences, retention decision |
| Loom: async screen explanation | Project-scoped browser screen recording and authenticated WebM attachment playback | Code-present; recording/storage limits not yet production-proven | Authenticated screen-capture/upload/playback evidence, retention/deletion decision, larger-file/object-storage and media-processing plan, and accessibility/transcript workflow |
| Slack huddles/calls | One-to-one project-room WebRTC audio/video with in-call screen sharing | Code-present; NAT traversal and multi-party calling not yet production-proven | Managed TURN credentials, restrictive-network call evidence, call-quality/observability support plan, consent/retention decision, and multi-party architecture before Slack-call replacement claims |
| Bonsai: proposals and approvals | Proposals, estimates, client approval portal | Code-present; provider lifecycle pending | Full authenticated and public approval journey, email delivery, audit trail, cancellation/retry states |
| Bonsai: contracts and signatures | Contracts and client signing portal | Code-present; e-sign evidence pending | Real signing test, signed-document retention/export, replay/expiry/revocation tests |
| Bonsai: invoices and payments | Invoices, Stripe links, expenses | Code-present; revenue lifecycle pending | Stripe test-mode lifecycle, webhook retry/idempotency, transactional email and overdue recovery |
| Agency safety net | Backups, restore tooling, soft deletion, session revocation | Same-host backup/restore proven; disaster recovery pending | Off-host encrypted backup, isolated restore drill, RPO/RTO evidence, key custody approval |
| ChatGPT/AI control plane | Tenant-scoped OpenAI-compatible context bridge | Read-only bridge code-present; action bridge not yet enabled | Connector/authentication test, provider health, prompt-injection review, allowlisted write tools with confirmation/idempotency/audit, and authenticated dogfood |
| Operational confidence | Health endpoints, worker health, release rollback | Deployed; telemetry degraded | Alert destination/owner, embedding failures cleared, rollback drill, incident escalation evidence |
| Accessible daily use | Shared UI, reduced motion, contrast, keyboard affordances | Automated slices deployed | Screen-reader, forced-colour, 200%/400% reflow, mobile/desktop manual evidence |
| Migration off existing tools | Import/export and data mapping | Tenant-scoped Bonsai import and portable workspace export code-present; migration not yet proven | Run `scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm`, retain its manifest/checksum securely; run `scripts/import-bonsai-full.js --dry-run --organization-id <id> --csv-dir <export> --summary-file <report>`, review complete input inventory/counts, then use explicit `--confirm` only after backup and reconciliation approval; sample ClickUp/Notion/Slack/Bonsai exports still required |

## Replacement gate

Ashbi should not become the sole system of record until every **Bonsai/revenue**, **backup/recovery**, **conversation**, and **migration** row has target evidence, and the ClickUp/Notion daily workflow has passed an authenticated agency dogfood run. Open external or human gates remain explicitly pending in `docs/product-status.md` and their linked issues.

## Next implementation slices

1. Add a deterministic export/import inventory and reconciliation contract for the supported client/project/document records.
2. Close workflow-state gaps in the highest-value revenue and portal actions.
3. Add managed TURN credentials and a media retention/transcription decision before treating recordings or calls as a replacement capability.
4. Produce a repeatable authenticated dogfood checklist and attach target evidence per row.
5. Re-run production health, security, browser, and rollback verification after each deployed slice.
