# Agency agents and operations: approved direction

Approved October 14, 2026. This is the agent/agency workstream under the [master delivery plan](master-app-delivery-plan.md), not a second release checklist. [Product status](product-status.md) distinguishes code, CI, deployment and target acceptance. Approval establishes product scope; it does not establish missing provider connections, choose unresolved retention policies or complete acceptance.

## Product and architecture

Hub holds canonical records and runs account-manager capabilities. Humans and clearly identified bots collaborate in the app; ChatGPT connects through Hub MCP. All entry points share backend services, client identities, permission checks, human approvals and action receipts. Client profiles must not duplicate clients or become permission boundaries. Agency and freelance work remain shared with the Ashbi team.

Use a small harness over existing governed providers, tool execution and workers. Do not install a full coding environment or fork Pi for account management. Predictable workflows run as ordinary code; models help interpret, summarize and draft. Consider a small runtime dependency only when a concrete requirement justifies it.

Plugins are reviewed, code-owned modules. A plugin declares identity/version, capabilities, tools, input schemas, role/scope requirements, external effects and approval requirements. Registration alone grants no access. Credentials stay server-side, external connections are explicitly mapped, and client-specific enablement must be enforced in backend services before execution. Arbitrary third-party plugin uploads, a marketplace and persistent per-client plugin configuration are not implemented by the first slice.

## Delivery sequence and acceptance

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

## Current implementation boundary

The first slice provides a staff preview, curated read-only `client-work` plugin and shared deterministic brief. It does not implement persistent client profiles, configurable plugin installations, durable agent jobs, app-wide bot chat, new mailbox connections, WhatsApp delivery or OpenSEO adapters. Existing task/finance/chat/email/portal code must be audited and extended before claiming any replacement is complete.

## Standards references

- [MCP Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks)
- [NIST agent identity and authorization concept](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents)
- [C2PA specifications](https://spec.c2pa.org/specifications/)
