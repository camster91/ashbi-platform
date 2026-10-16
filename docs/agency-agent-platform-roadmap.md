# Agency agents and operations: approved direction

Approved October 14, 2026. This is the agent/agency workstream under the [master delivery plan](master-app-delivery-plan.md), not a second release checklist. [Product status](product-status.md) distinguishes code, CI, deployment and target acceptance. Approval establishes product scope; it does not establish missing provider connections, choose unresolved retention policies or complete acceptance.

## Historical October 15 delivery overlay

The W1 foundation is deployed in #608 at `37d02b304898ec5c621199f4a2a880ebd64a6372`: shared staff saved questions, governed no-tools runs, exact-intent recovery, status/cancellation and bounded deadline recovery. Required main CI [38808629217](https://github.com/camster91/ashbi-platform/actions/runs/38808629217) and 169 bounded live checks passed, including 47 agent CRUD checks; normal browser creation/reload persistence followed by separate API archive cleanup passed without Send/provider calls. Prior-turn memory, persisted context observation/source evidence and real-provider/team acceptance remain incomplete W1 work. Restricted tools/MCP actions, portal assistants and later bot/provider integrations remain follow-ups. This does not close the full agency roadmap, whole-app acceptance or source cutover; [#565](https://github.com/camster91/ashbi-platform/issues/565) owns the execution queue.

Historical October 15 implementation note (superseded status, retained evidence): the first slice provided a staff preview, curated read-only `client-work` plugin and shared deterministic brief. The [staff profile/messages follow-up](workspace-messages.md) added persistent profile configuration and human company/direct conversations. Shared staff questions/durable runs were deployed as #608 at `37d02b3`; migrated CI and bounded CRUD/browser acceptance passed without a live model request. At that checkpoint prior-turn memory, persisted context evidence, restricted plugins, bot execution and mailbox/provider adapters remained follow-ups. The e7 implementation boundary below supersedes that dated build status; it does not relabel the older acceptance as e7 evidence.

## Current execution reference — October 16, 2026

The [master delivery plan](master-app-delivery-plan.md) is the single current status entrypoint, with [#565](https://github.com/camster91/ashbi-platform/issues/565) as its execution checklist. Its exact merged e7 source snapshot supersedes future-code statements in the dated overlay above. This roadmap preserves approved scope and acceptance criteria; its original sequence is not a queue to rebuild completed foundations.

## Product and architecture

Hub holds canonical records and runs account-manager capabilities. Humans and clearly identified bots collaborate in the app; ChatGPT connects through Hub MCP. All entry points share backend services, client identities, permission checks, human approvals and action receipts. Client profiles must not duplicate clients or become permission boundaries. Agency and freelance work remain shared with the Ashbi team.

Use a small harness over existing governed providers, tool execution and workers. Do not install a full coding environment or fork Pi for account management. Predictable workflows run as ordinary code; models help interpret, summarize and draft. Consider a small runtime dependency only when a concrete requirement justifies it.

Plugins are reviewed, code-owned modules. A plugin declares identity/version, capabilities, tools, input schemas, role/scope requirements, external effects and approval requirements. Registration alone grants no access. Credentials stay server-side, external connections are explicitly mapped, and client-specific enablement must be enforced in backend services before execution. Arbitrary third-party plugin uploads, a marketplace and persistent per-client plugin configuration are not implemented by the first slice.

## Original delivery sequence and acceptance criteria

| Order | Work | Required evidence |
| --- | --- | --- |
| 1 | Shared account-manager brief and curated plugin discovery through UI/API/MCP | Same client scope and role restrictions; real SDK discovery/calls; source provenance; bounded reads; partial/truncated/empty/error states; no model call for a work brief |
| 2 | Persistent client profiles, conversation/run identity and controlled agent jobs | Reuse canonical clients; explicit principal and requester; role/client isolation; durable status/cancel/results; time, steps and spend limits; no automatic retry of ambiguous external effects |
| 3 | App-wide human/bot chat | Audit existing chat first; company/client/project channels and DMs, threads, membership, attachments and source-record links; guest isolation; mention/assignment rules; loop prevention; revocation and search acceptance |
| 4 | Email communication plugin and unified intake | Audit existing email first; approved mailbox access, canonical contact matching, unmatched/ambiguous review, deduplication, threading and attachment policy; unanswered requests and follow-ups; unrelated mail excluded from client context; read/draft first; explicit approved sending |
| 5 | Influencers Link WhatsApp pilot | Dedicated account/provider/group mapping, authenticated events, verified mentions, idempotent intake and synthetic negative tests before live pairing; outbound policy separate |
| 6 | OpenSEO and other service panels | Explicit client-to-project mapping; authorized reads; observed/fetched times; empty/stale/unavailable states; no automatic paid research |
| 7 | Scope, retainers, proofing and client decisions | Extend existing billing/review/knowledge features; included work and revisions, proposed change orders, version-specific sign-off and source-linked decisions; no inferred approval or invented completion |
| 8 | Capacity, profitability and client portal | Reuse workload/time/expense/invoice/portal features; currency-preserving costs and margin definitions, role-limited finance, client-only audiences; populated acceptance |
| 9 | Meetings, client health, brand assets and service playbooks | Proposed meeting follow-through; explainable health signals; approved assets/version/license metadata; reusable workflows; corrections and human review |

Email, WhatsApp and in-app chat feed one client communication timeline while preserving source, audience and channel identity. Reading an external message must not automatically share it with clients or authorize a reply. Converting a message into a task must preserve its source and show whether it is proposed or committed.

## Daily experience

Use the existing work queue as the foundation of **Needs attention**: requests, approvals, blockers, deadlines and agent handoffs in one daily view. Preserve existing navigation and working routes while testing any later Today/Clients/Work/Chat/Reports organization; this direction does not authorize deleting Finance, Knowledge or Settings workflows.

Agents show identity, current state, evidence, pending approvals and outcomes. A source link is navigation, not a completed handoff. Track actor, requesting human, organization, client, run and action identity separately. A bot message or model-generated text never supplies approval authority.

Long work must survive closed chat sessions, expose durable run identifiers and allow result retrieval from both app and MCP. Adapt at the MCP boundary to supported task capabilities rather than assuming every client implements the same extension. Record which client capabilities were actually verified.

Keep asset origin, license/usage rights, supplied sources, AI involvement and approved versions. Content Credentials interoperability can be added where useful; provenance is not proof of factual accuracy, rights ownership or client approval.

## Implementation boundary at merged e7

Source `e7c7bed2654867146166c7303c1caa4e6405fd4a` includes staff profiles, saved conversations/runs, bounded source context/memory, human channels/attention, a default-disabled account-manager bot pilot, operation-specific OAuth writes/consent, native Gmail identity/bounded INBOX scanning, human portal handoffs and explicit document compare/manual reconciliation. They are implementation inputs to final release and real provider/team acceptance, not unfinished foundation builds. No new provider call or real ChatGPT grant is proved by that source snapshot.

Portal AI remains disabled by SQL/profile policy. WhatsApp transport and live OpenSEO reads are not implemented; saved service reports already are. Full Sent/history mailbox coverage, unified chat-attention/agent-run projection into the existing queue, trustworthy profit/currency definitions and invoice-view producer semantics retain the precise boundaries in the [seven current gaps](master-app-delivery-plan.md#validated-remaining-implementation-and-policy-gaps). Source-primary one-time input/cutover and real revenue, provider, accessible daily-use and recovery acceptance remain open. Realtime document convergence is not claimed by manual conflict recovery. Do not install another agent harness, queue or generic plugin uploader to recreate existing services.

## Standards references

- [MCP Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks)
- [NIST agent identity and authorization concept](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents)
- [C2PA specifications](https://spec.c2pa.org/specifications/)
