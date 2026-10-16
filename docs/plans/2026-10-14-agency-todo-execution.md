# Ashbi Agency TODO Implementation Plan

> **For implementation:** Use delegated development task by task, with specification and code-quality review before integration. The lead owns shared schema, migrations, registration and release coordination. This planning pass does not implement product changes.

**Goal:** Finish the approved shared-team agency workspace, with app-native account managers, human/bot communication, scoped ChatGPT MCP, usable business workflows and a verified source-to-Hub cutover.

**Architecture:** Extend the existing Fastify services, governed tool executor, Prisma records, tenant boundaries, BullMQ workers and domain-event outbox. The app, API and MCP call the same services. Deterministic work does not require a model; model-generated work stays bounded and consequential actions follow the existing approval/receipt policy.

**Tech Stack:** Existing Node ESM/Fastify, Prisma/PostgreSQL, BullMQ/Redis, React/Vite, Socket.IO and workspace MCP. No full Pi installation, stripped-down fork, new external control plane or arbitrary plugin loader is required.

Prepared October 14, 2026 from three parallel read-only agent audits of main `80054ded43666a4988b3bcec03db17d14f0f4f14`. [Master delivery plan](../master-app-delivery-plan.md) remains the execution ledger; [product status](../product-status.md) owns capability classifications; [replacement readiness](../replacement-readiness-matrix.md) owns target acceptance. This document expands the approved [agency-agent roadmap](../agency-agent-platform-roadmap.md) into work packages.

## Current execution overlay — October 15, 2026

[Launch evidence](../launch-status.md) records verified production `37d02b304898ec5c621199f4a2a880ebd64a6372`, including #608 saved staff questions/durable runs, #609 unused-export cleanup and #606 retained document history. Required main CI 38808629217 and 169/169 bounded live API checks passed. Normal browser creation/full-reload persistence and separate API archive cleanup passed without Send or provider calls. This is the shipped W1 foundation, not complete W1 or whole-app acceptance.

Prior-turn memory, persisted context observation/source evidence, real-provider/team acceptance, restricted tools/MCP actions, portal assistants, bot execution, reliable mailbox ingestion, WhatsApp/OpenSEO adapters, simultaneous editing and cutover remain open. Reuse deployed #597 profiles/human messaging, #598 stored timelines, #600 Gmail receipts and #608 conversation/run services. [#565](https://github.com/camster91/ashbi-platform/issues/565) and the [master delivery ledger](../master-app-delivery-plan.md) own current status and order; the work packages below retain their dated design context.

For the shipped conversation/run foundation, the actual schema/service names and `/api/clients/:clientId/assistant/conversations` contracts in [client-agent-conversations.md](../client-agent-conversations.md) supersede the proposed W1/W2 names and routes below. Extend that implementation for remaining memory, tools and approvals; do not create another runtime from the historical design sketch.

## 1. Historical starting point — October 14 plan baseline

The following list preserves the original planning baseline and earlier reconciliation notes. Its **Still missing** and **Release snapshot** entries are historical, not the current implementation queue; use the current overlay and delivery ledger above. The completion rule after the list still applies to remaining work.

- **Merged:** #592 Note audiences, #593 navigation simplification, #594 export repair and #595 client account-manager brief/plugin discovery. Do not reopen them as implementation TODOs.
- **Already available:** project chat, threads, files/reactions, portal visibility rules, email inbox/draft workflows, Gmail transport, project communication history, workload/time/billing/reviews, governed AI sessions, action receipts, MCP and workers. Extend these modules rather than replacing them wholesale.
- **Still missing:** saved client-agent conversations/durable runs, client-bound plugin execution and bot mention execution, reliable mailbox-level ingestion, WhatsApp/OpenSEO adapters, remaining collaboration/history and agency-operation deltas, plus real acceptance and cutover. Profiles, human channel/DM membership and the stored communication projection are already merged/deployed; extend their existing services.
- **Release snapshot:** #595 main CI [38662512953](https://github.com/camster91/ashbi-platform/actions/runs/38662512953) was running when checked. The waiting production run [38649706109](https://github.com/camster91/ashbi-platform/actions/runs/38649706109) targets older `0a02e146`, not #595. Deployment is already authorized; protected execution and exact-version verification remain necessary.

A work package is complete only when its behavior is implemented, relevant tests pass, review findings are resolved, the exact head passes required CI, and it merges normally. Deployment and target acceptance are separate checks. The whole approved TODO is complete only after all work packages and their provider/target gates have evidence; a merged foundation is not the entire product.

## 2. Parallel team and ownership

| Role | Owns | Integration rule |
| --- | --- | --- |
| Lead/integrator | Scope, schema/migrations, shared registration, tenant metadata, API contracts, canonical docs, PRs and releases | Freeze shared contracts before component implementation; serialize schema and shared-file edits |
| Agent A: runtime | New profile/conversation/run services, job processor, restricted plugin context and backend tests | Reuse the existing executor/governance/outbox; no parallel registry |
| Agent B: communication | New channel/membership and mailbox/timeline services, transport adapters and tests | Preserve existing project chat, source messages and delivery workflows |
| Agent C: UI/QA | New client controls, Messages surface, synthetic fixtures and end-to-end acceptance | Verify real state after reload, permissions, mobile/keyboard/error/reconnect behavior |

Workers write only their assigned new files. The lead integrates existing-file changes, or explicitly reallocates ownership before edits. Every agent verifies host, effective permissions and needed callable tools; no agent changes production, credentials or access to work around a missing capability.

## 3. Delivery order

```text
W0 Ledger + exact release readiness
  |
  +-- W1 Profiles/history --> W2 Durable runs --> W3 Restricted plugins/MCP + W3b portal assistant
  |                                            |
  +-- W4 Channels/DMs -----------------------> W5 Bot mentions/UI
  |
  +-- W6 Mailbox identity/ingestion ----------> W7 Client timeline/intake
  |                                            |
  |                                            +-- W8 WhatsApp pilot
  +-- W9 OpenSEO panels                         |
  +-- W10 Document collaboration/history        |
  +-- W11 Existing agency workflow gaps --------+
                                               |
                         W12 Integrated QA --> W13 Input rehearsal
                                               |
                             W14 Release + final delta + cutover
```

W4 and W6 can proceed while runtime work is underway after schema contracts are agreed. OpenSEO read panels and policy-independent document work do not wait for chat or WhatsApp. Existing tested releases can ship independently; do not wait for the whole expansion to deploy every useful increment.

### W0 — Reconcile the ledger and freeze releases

**Lead owns:** `docs/master-app-delivery-plan.md`, `docs/product-status.md`, `docs/replacement-readiness-matrix.md`; existing release workflow and `scripts/smoke-production-health.mjs` are verification references.

1. Remove stale owner-hold language and merged-feature build TODOs. Preserve outstanding target acceptance.
2. Check main CI for the exact chosen revision. Record which protected run would deploy that revision; supersede older waiting runs only through the authorized release process.
3. W0 release execution is complete through the explicitly owner-authorized SSH controller; see launch evidence. Preserve permanent review rules. Coolify adoption remains separate and must be completed before using it as controller.
4. Verify encrypted backup/rollback evidence, deployed revision and strict API/database/Redis/worker readiness. Explain any degraded services separately.

**Exit:** exact release revision is independently verified, or the precise missing execution capability is recorded. This gate does not halt unrelated implementation. The owner is not asked to approve deployment again.

### W1 — Persistent client agent profiles and conversations

**Extend existing:** `src/services/client-agent-profile.service.js` and the shipped profile controls. Create only the missing client-bound conversation service/history components and focused tests; preserve saved profile identity and revision checks.

**Modify under lead ownership:** `prisma/schema.prisma`, a committed migration, `src/utils/prisma-tenant-proxy.js`, `src/utils/tenant-relations.js`, `src/routes/client-assistant.routes.js`, existing Account manager integration and workspace tools.

1. Define `AgentProfile` bound to organization and canonical client, optional project, name, bounded instructions, enabled state, revision, selected curated plugins and actor timestamps.
2. Add conversation/message identity and explicit audience. Normal client account-manager discussions are shared with the authorized Ashbi team; private conversations are an explicit audience choice. Channel-linked messages inherit current membership rather than maintaining a second conversation ACL. Profiles and business records remain shared with the Ashbi team.
3. Store source references and observation time. Keep input/history/output sizes bounded; never persist a failed partial answer as a successful response.
4. Add revision-checked settings, reloadable history and disabled/provider-unavailable states in the existing client page.

**Exit:** staff can configure, ask, reload and continue a client conversation. Foreign principals and mismatched client-bound requests cannot read it; staff can still legitimately switch between authorized clients. Demoted/deactivated actors lose access; client switches do not leak cached content. The deterministic brief works with AI disabled. Document agent transcript audience, archive/export/deletion behavior as part of the implementation; do not silently reuse a document-version purge policy or introduce an automatic purge. This is implementation work within the approved persistence scope, not a new blanket approval gate.

### W2 — Durable agent runs

**Create:** `src/services/agent-run.service.js`, `src/jobs/agent-run.js`, focused unit and database crash/replay tests.

**Modify:** schema/migration, `src/jobs/queue-names.js`, `queue.js`, `worker.js`, existing domain-event dispatch and client assistant routes.

1. Persist `AgentRun` with organization/profile/conversation/requester, idempotency key scoped to organization + requester/profile with an input hash, profile/toolset version, lifecycle, deadline, lease/heartbeat, cancellation, output/error, approval action IDs, step checkpoints and correlation references.
2. Use database/outbox dispatch into BullMQ. A committed request must survive Redis/enqueue interruption.
3. Execute through current tenant job helpers and the existing bounded session runner. Recheck requester, membership, enabled profile and permissions when work starts and before approved actions. Resuming after approval uses stored action IDs/checkpoints and must not replay earlier model/tool effects.
4. Expose queued, running, waiting-for-approval, succeeded, failed, cancelled and uncertain outcomes. Cancellation must not imply that an already accepted provider call was refunded or undone.
5. Recover deterministic work safely. Never automatically resend an ambiguous external action; reconcile through its existing receipt/provider identity.

**Exit:** a run survives leaving the page and worker restarts, duplicate requests do not duplicate work, disabled/revoked access prevents queued execution, cancellation is truthful, budgets remain enforced and uncertain sends are not replayed.

### W3 — Client-bound plugins and MCP operations

**Extend:** `src/services/client-account-manager.service.js`, `src/integrations/workspace-account-manager-tools.js`, `workspace-tools.js`, `src/ai/tools/registry.js` and `executor.js` only where necessary.

Effective tools are the intersection of actor permissions, organization scope, profile client/project scope, enabled code-owned plugin tools, provider grants and operation policy. Configuration can narrow access; it cannot grant authority. Enforce client filters in service queries, not only in the system prompt—even an ADMIN's client-bound agent must not read a different client.

Pass a restricted view of the existing workspace registry/executor into the bounded session runner; its current default AI registry is smaller and must not become a divergent catalogue. Start with `client-work`, then communications read/draft, intake and SEO read capabilities as their underlying services ship. Declare plugin version, scopes, audiences, tools, effects and required provider connection. Do not add arbitrary npm installation, URL-based tool discovery or a second tool executor.

Proposed transport contract (these new routes/tools are planned, not currently implemented):

| Operation | App/API | MCP policy |
| --- | --- | --- |
| Read profile/history/run | Existing `/api/client-assistants/:clientId` namespace, with scoped subresources | `workspace:read`; no hidden inference or delivery |
| Configure profile/start/cancel run | Explicit staff action calling the shared service | Separate action scope and existing operation-specific confirmation/idempotency policy |
| Approve consequential action | Existing pending-action flow | Existing preview, authorized confirmation and immutable receipt |

The current ChatGPT OAuth connection grants read scope only. Add any action consent deliberately; do not silently enlarge existing grants or classify a paid model run as a read.

**Exit:** app/API/MCP agree on state and denials; cross-client tool inputs, forged tools, stale grants and prompt-injected permission changes fail. Unconfigured plugins report unavailable, not connected.

### W3b — Client-facing account managers in the portal

This remains a required approved slice, not implied by staff assistant acceptance. After W1–W3, add a separately enabled client-facing profile surface, portal-principal-bound conversations and human handoff. Use the existing portal authentication and derive client identity from that principal, never a caller-selected tenant/client or a staff conversation ID. Reuse bounded context with only explicitly client-visible projects, documents, messages and published panels; do not expose staff transcripts, finance, internal notes or the organization-wide tool catalogue.

Add the assistant to the existing client portal with saved history, source references, unavailable/paused states and a clear request-for-human flow. Staff see the resulting handoff in their authorized client workspace; a handoff is recorded only when that record exists. Read/draft/request intake can be enabled independently of client write or external-send tools. Portal access defaults off until deliberately enabled for that client through the staff configuration.

**Exit:** two real synthetic client principals can each converse with their own enabled assistant, reload their own history and request a staff handoff. Foreign profile/conversation IDs, guessed staff history, revoked portal access, disabled profiles and hidden documents/messages are denied. Client-origin instructions cannot turn into staff authority; no bot/client gets generic staff MCP scope. Include portal mobile/keyboard and prompt-injection tests. W12 must verify this slice before the approved agent TODO is complete.

### W4 — Company channels and direct conversations

**Already merged/deployed in #597:** `src/services/workspace-chat.service.js`, workspace chat routes/UI and membership tests. Reuse this foundation for missing bot/mention behavior; do not create a second channel/DM system.

**Extend:** schema, domain registration, `src/auth/socket-auth.js`, realtime subscriber/emitter integration and existing navigation/Chat page under lead ownership.

1. Introduce organization-owned channel and membership records for company, client, project and direct conversations. Staff members added to a channel can read its retained authorized history. Keep DMs participant-only, with an organization-scoped unique identity derived from sorted participant IDs; changing a DM participant set creates a new conversation rather than revealing old history. External client access is not granted by staff membership or an email match.
2. Add stable channel message/reply identity. Keep existing project `ChatMessage` and portal visibility intact; do not force a fake project onto company chat or silently duplicate historical messages.
3. Enforce membership for history, search, files, sockets, reconnect and every send. Revoked membership must stop subsequent delivery/read access, including already-open sockets.
4. Reuse existing attachment validation, reactions and thread behavior where compatible. Show source audience clearly.

**Exit:** two staff can hold a company/channel/DM conversation; outsiders cannot enumerate or join it; guest clients cannot see staff channels; legacy internal/client project chat tests still pass.

### W5 — Human/bot Messages experience

**Create:** explicit bot identity/membership and durable mention bindings; extend W4 components and W2 run integration.

1. Provide one Messages surface within existing navigation: channel/DM list, conversation, threads, unread position and reconnect/retry state. Keep current Ash conversations reachable until deliberately migrated.
2. Use explicit selected IDs for mentions. The existing display-name regex does not authorize a bot invocation.
3. Actual bot execution depends on W2 durable runs, W3 client-bound tools and W4 membership. The Messages UI can proceed earlier against fixtures. A committed human mention/assignment creates one run through W2. Bot/system events do not recursively start more bots. Recheck current membership before posting results.
4. Show working, waiting-for-approval, completed, failed and cancelled states with source links and the requesting human. A result message is not proof that its proposed action executed.

**Exit:** an @mention gets one scoped agent response; duplicate jobs do not duplicate replies; bot loops, removed memberships and disabled profiles are handled; desktop/mobile/keyboard use and channel switching are verified.

### W6 — Reliable mailbox identity and ingestion

**Existing foundations:** `src/routes/gmail.routes.js`, `scripts/gmail-sync.js`, `src/services/gmail-sync-matcher.js`, inbox/thread/response routes, `ProjectCommunication` and `web/src/components/project/ProjectCommunications.jsx`.

**Create:** `MailboxConnection`, connection-owned provider identity/cursor state, `src/services/mailbox-connection.service.js`, `mailbox-sync.service.js`, synthetic provider fixtures and database tests.

1. Represent mailbox ownership and permitted viewers/senders, encrypted credentials, connection status and refresh/revocation. Retain the deployment-owned Gmail connection as a legacy adapter during transition.
2. Key provider identities by connection/provider/native ID, migrating the existing global `ProjectCommunication.gmailMessageId @unique` constraint before multi-mailbox ingestion. Replace substring identity matching and unsafe subject-only association; preserve original IDs, headers, mailbox and direction.
3. Paginate inbox and sent mail, including replies sent outside Hub; checkpoint and resume safely through interruptions and moved/archived messages. Preserve attachment metadata/original availability and explicitly label body truncation/completeness. The current rolling inbox-only scan and skipped Ashbi outbound messages cannot establish complete correspondence.
4. Match canonical contacts explicitly. Ambiguous/multi-company correspondence goes to existing unmatched review; it must not be filed under the first plausible client.

**Exit:** synthetic multi-page inbox/sent history is complete, duplicates across retries are prevented, equal provider IDs in two mailboxes do not collide, cursor recovery works and cross-mailbox/tenant access is refused. Live connection waits for the specified mailbox and provider consent.

### W7 — Client communication timeline and intake

**Already merged/deployed in #598:** `src/services/client-communications.service.js`, shared route/tool adapters and the client Communications component. Extend this stored projection only for verified missing sources/intake; it does not establish live mailbox synchronization.

1. Begin after W6 identity contracts; new channel messages additionally depend on W4. Project a paginated timeline from existing `Thread`/`Message`, `ProjectCommunication` and permitted chat/source records. Link/deduplicate identities; do not create a third competing copy of every email body.
2. Label source, sender, mailbox, audience, original/observed time, task linkage and incomplete sources. Internal notes remain internal; no client access is inferred from a matching email address.
3. Let staff turn a request into a source-linked task/intake record with an explicit outcome. Agents can summarize and draft using authorized records and citations.
4. Reuse existing response approval/delivery. Add a durable send attempt/outbox boundary where necessary so provider acceptance followed by a lost response cannot cause duplicate mail. Preserve draft/approved/sending/provider-accepted/uncertain distinctions. Provider acceptance is not proof of recipient delivery; delivered/bounced labels require actual provider evidence.

**Exit:** client mail sent inside and outside Hub appears once, unanswered requests can be identified, source links work, recipients/mailbox changes invalidate stale approval, and no inbox read/draft silently sends or marks a message delivered.

### W8 — Influencers Link WhatsApp mention intake

**Create:** provider-specific signed event adapter, mapped installation/group configuration, transactional intake receipt and synthetic webhook tests. Reuse existing Slack event-auth/mapping patterns and W7 deterministic intake/receipt contracts; WhatsApp does not depend on a completed timeline UI or AI runtime; avoid the legacy deployment-wide bot secret.

Verified mentions from the explicitly mapped group create one internal intake ticket, retaining sender, source message and attachments/provenance. Reject unmapped groups, nonmentions, own-bot events, forged requests and replay duplicates. Define edit/delete behavior. An external sender is never a staff principal.

**Exit:** synthetic acceptance passes before live pairing; an approved real group pilot creates one correctly scoped ticket and redelivery creates none. Provider eligibility, dedicated account/number and group access are activation gates. Outbound acknowledgments/replies require their own deliberate delivery policy.

### W9 — OpenSEO and other service dashboards

**Create:** `src/services/client-panel.service.js`, provider-specific OpenSEO read adapter, explicit client-to-provider-project mappings, panel UI and fake-provider tests.

Use authorized saved data first; publish source ID, observation/fetch time and empty/stale/unavailable states. Support several brand projects per client. Credentials remain server-side, origins are pinned and browser-supplied arbitrary upstream URLs/project IDs are refused. A dashboard refresh must not start paid SEO research.

**Exit:** one client sees only its mapped reports/metrics and canonical deep links; empty/missing/stale/provider failure states remain useful; live provider access and the actual mappings are verified separately. Other panels reuse this contract rather than embedding global authenticated dashboards.

### W10 — Document collaboration and retained recovery

**Extend:** current note/wiki services, audience authorization and editor components; use [the existing decision packet](../document-recovery-decision.md).

1. First write a two-browser acceptance case for simultaneous editing, reconnect and permission revocation. Select a compatible collaboration implementation against the actual editor and authenticated realtime infrastructure; validate checkpoint/conflict recovery before adopting a library or storage format.
2. Keep stale-write draft recovery throughout migration. Concurrent editing is complete only when both users' changes survive; presence indicators alone do not satisfy it.
3. Implement retained snapshots and restore-as-a-new-revision only under an explicit bound/authority policy. The existing recommendation is **last 100 revisions, administrator restore**, and remains a proposal.
4. Restore current authorization, hierarchy and permitted references; unavailable attachments/parents stay visible as unavailable rather than being recreated silently.

**Exit:** two editors converge after reconnect without lost content; foreign/private history stays inaccessible; approved retention boundaries, restore concurrency, export and backup recovery are tested. Policy-independent collaboration work can proceed before the history decision.

### W11 — Close agency-operation gaps without rebuilding modules

| Existing area | Remaining delta/acceptance |
| --- | --- |
| Retainers/time/billing | Explicit included-work/revision allowances, remaining entitlement and proposed scope changes; no invented prices or automatic client commitments |
| Proofing/reviews/knowledge | Decisions and sign-off linked to the exact reviewed version; approved versus draft content visible |
| Workload/time/expenses/invoices | Capacity and cost/margin definitions, currency preservation and unknown-cost states; no fabricated profitability from missing rates |
| Client portal | Requests, progress, files, approvals and invoices through explicit client audiences; actual role/denial journeys |
| Meetings/health/playbooks | Proposed follow-through, explainable risk signals and reusable service workflows using current task/knowledge modules |
| Brand assets | Approved versions, source files, supplied license/usage metadata and unavailable rights information |
| Scheduled agents | Internal brief/draft only after W2; timezone/DST, occurrence idempotency, budgets and pause/cancel tests; outbound delivery remains separate |

**Exit:** audit each module, implement only the actual delta, then prove the representative workflow. Existing calls/media, accessible use, alerting and disaster recovery retain the acceptance requirements in the replacement matrix; they are not silently declared complete or removed from scope.

### W12 — Independent integrated QA

Agent C tests the frozen candidate while A/B fix reproduced defects. Use disposable org A/B, ADMIN/TEAM, client A/B, bot and revoked/inactive principals. Verify tenant/client/channel isolation, settings and saved state after reload, membership revocation, prompt injection, stale approvals, duplicate events, worker restart, cancellation, provider failure and ambiguous outcomes.

Run one agency and one freelance project through client request → internal discussion → task → agent draft → review/approval → time/expense → invoice → sandbox payment/webhook → receipt. Test tax/currency/partial payment/refund/retry behavior separately. Real ChatGPT discovery/read/action-consent/revocation must be tested in the actual supported connection; a local SDK test does not substitute for that acceptance.

Add desktop/mobile/keyboard, screen-reader/reflow, reconnect/offline and media/browser coverage according to the existing runbooks. Record screenshots/traces, exact revision, test identity and reproducible issues. Fix critical/high defects before the relevant feature ships; track lower-priority gaps explicitly.

### W13 — Reviewed one-time input rehearsal

Sources stay primary during the parallel run. Finish canonical-client, owner, time precision, multi-company contact, unavailable-company, financial-document and source-file exceptions in the private reconciliation packet. Verify source coverage rather than treating search samples as a full export.

Before input, protect the destination with verified encrypted database/uploads backup and isolated restore evidence. A scoped directory export alone is insufficient. Preserve existing provider-linked financial records regardless of QA/test-looking labels.

Rehearse the reviewed bounded input in disposable staging without sends, reminders, charges or live recurrence. Reconcile counts, relationships, ownership, checksums/files and monetary totals per original currency. Document conflicts and rollback. Do not build a reusable importer framework or automatic dual-write synchronization.

### W14 — Release, final delta and team cutover

Freeze a tested revision, execute protected release and verify deployed revision/readiness/rollback. Perform the reviewed bounded initial population and verify readback, then run populated target QA while sources stay primary. Recollect source changes, review conflicts and apply the final bounded delta. Record a consistency cutoff and a short source handoff window so new changes cannot fall between systems. Obtain Cameron/Bianca workflow acceptance and the actual cutover decision, then make Hub primary for new work.

Retain source access/exports and a tested fallback. Switching work to Hub does not by itself authorize cancelling subscriptions or deleting source data. Final acceptance includes restored data integrity, provider behavior, team permissions, communication delivery evidence and remaining exceptions.

## 4. Historical first execution checklist — superseded by #597/#598

The foundation instructions below record the original work split and must not queue profiles/channels/timelines for rebuilding. Current execution starts with the pilot acceptance in #565, then the remaining gaps in the delivery ledger.

1. Lead records the profile/run/channel/mailbox model contracts and intended audiences; agents review them before schema edits.
2. Agent A adds focused failing profile ownership/revision tests, then the smallest service and migration-backed persistence slice. Prove save/reload through the client UI before extending model behavior.
3. Agent B adds membership isolation/revocation tests and the smallest staff channel/DM slice; independently specifies connection-scoped email identity against synthetic fixtures.
4. Agent C builds the client controls and Messages states against the agreed service DTOs, then runs the cross-role browser scenarios.
5. Lead integrates one migration and registration change at a time. Add a real database test for each new ownership edge; regenerate Prisma before validating tenant relation metadata.
6. Run focused tests first, fix the cause of failures, then required suites. Update route ownership/access snapshots and OpenAPI when routes change. Commit named files and open a bounded PR with exact acceptance evidence.
7. Merge the tested head normally. Verify deployment separately, then move to the next work package. Do not count a provider adapter as connected solely because mock tests pass.

Representative regression to establish before implementation:

```javascript
// Proposed new service contract, not an existing callable operation.
await assert.rejects(
  readAgentRun(prisma, orgBStaff, orgAClientId, orgARunId),
  { code: 'NOT_FOUND' },
);
// Also deny another client's run within org A, even for a client-bound ADMIN agent.
// Repeat starts with the same idempotency key must return the same durable run.
```

Commands (expected: relevant new assertions pass, zero failures; do not hardcode a future test count):

```text
node scripts/run-node-tests.mjs src/tests/unit/<assigned-test>.test.js
node scripts/run-node-tests.mjs src/tests/integration/<assigned-test>.database.test.js
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js <changed-backend-files> --max-warnings 0
cd web
node node_modules/vitest/vitest.mjs run src/tests/<assigned-test>.test.jsx
node node_modules/eslint/bin/eslint.js <changed-frontend-files> --max-warnings 0
node node_modules/vite/bin/vite.js build
cd ..
node scripts/check-frontend-budgets.mjs --dist web/dist
node scripts/generate-openapi.mjs --check
git diff --check
```

Database commands require the documented disposable test database, not production credentials. Required GitHub checks remain authoritative for the complete quality/integration/browser suite. No tests were executed during this planning-only pass.

## 5. Decisions and access gates

| Gate | Concrete requirement | Work that can continue now |
| --- | --- | --- |
| Future controller adoption | Direct-VPS release is verified. Complete and authorize the Coolify handoff before changing controller; do not revive a failed workflow as deployment proof | Current pilot QA and bounded local/synthetic implementation |
| History | Choose retained revision bound and restore authority; recommendation already prepared: 100/admin | Collaboration, conflicts and permission tests |
| Mailboxes | Identify company/client-work mailboxes, viewers/senders and provider OAuth consent; exclude unrelated personal mail | Connection adapters, pagination/identity tests and UI |
| WhatsApp | Dedicated account/number, supported provider and verified group/mention path | Signed adapter, mapping and replay tests |
| OpenSEO | Server credential/grant and reviewed client-to-project mappings | Adapter/panel contracts and fake-provider tests |
| Revenue and cost | Authorized sandbox accounts, issuer/tax/currency choices and actual cost inputs | Workflow fixes, currency tests and unknown-cost UI |
| Input/cutover | Honor approved consolidation/parallel running; resolve remaining exact mapping/financial exceptions and record the final switchover | Source reconciliation, backup/restore and disposable rehearsal |

Access gates are localized to the affected activation; they must not become a reason to halt the whole workstream. No arbitrary completion percentage or calendar promise is assigned to this multi-wave plan. Reassess the remaining effort after each merged vertical slice and keep one canonical ledger current.
