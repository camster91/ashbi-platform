# Client assistants, mention intake and dashboard panels

This extends the shared Ashbi workspace. Agents are optional capabilities attached to existing clients and projects, not duplicate client records or a new top-level navigation system. The first implementation slice is a staff-only client assistant preview. WhatsApp transport, client-facing conversations and OpenSEO dashboard adapters are planned and are not installed or enabled by this slice.

## First working slice: staff preview

Open a client and expand **Assistant preview**. ADMIN and TEAM users submit one question explicitly. The response is generated through the existing governed provider (workspace BYOK, budget, usage records and kill switches), with feature `client_assistant_preview`. No call runs when the page loads.

`POST /api/client-assistants/:clientId/preview` accepts only `{message}` (1–2,000 characters). It resolves the client and up to 25 projects through the tenant proxy and explicit organization/client/deletion filters. The model sees only client ID/name/domain and project ID/name/status/start/end dates. It sees no contacts, finance, credentials, internal chat, internal notes, AI summaries or other clients. The response includes the exact context used and observation time; the UI labels a truncated project list. Foreign, missing and deleted clients have the same 404 response. CLIENT and BOT principals are refused. The route permits at most five requests per minute per IP through the existing rate limiter.

This is single-question staff preview: no persisted conversation, custom persona configuration, autonomous tools, client portal chat or channel delivery. A draft in the answer is text only. It does not create a ticket or claim an action happened. The existing staff tool catalogue is not made available to client principals. Unknown provider errors are redacted.

Code: `src/services/client-assistant-context.service.js`, `src/routes/client-assistant.routes.js`, `web/src/components/ClientAssistantPreview.jsx` and its integration into the existing client page. No database migration or credentials are required to store new profiles in this slice. An operational AI provider is required to generate a real response; credentials and existing kill switches are not changed here.

## Influencers Link: mention to ticket

Target flow: a verified mention of the bot in an explicitly mapped Influencers Link group creates one intake ticket, retaining the original request and source identifiers. A deterministic mention-and-routing step does not need an LLM. Optional AI can suggest a title, tags or a summary later; it must not turn a quoted instruction into staff authority.

Before channel activation, establish the dedicated bot account/number, eligible provider transport, exact group, allowed intake senders and target client/project. Group support for the actual existing group must be tested; do not assume an official Cloud API account can simply join an ordinary existing group. Meta's Groups documentation could not be retrieved during this discovery (HTTP 429), so no account eligibility or participant limits are represented as verified here.

A possible self-hosted transport is WAHA, whose primary documentation describes receiving group messages, authenticated webhook events and linked sessions. It is a WhatsApp Web transport, not proof of official Meta Business API support. Its session availability and account restrictions must be evaluated before adoption. No installation, QR pairing, live group ingestion, credential configuration or outbound message was performed.

Use the existing Slack installation/channel-mapping and signed-event patterns rather than the deployment-wide legacy bot secret:

- Bind a verified installation/session and group to the existing organization, client and optional project. The inbound body cannot choose its tenant or client.
- Verify the provider webhook signature over the original body and its documented replay controls. Enforce active bindings, body/media limits and transport-specific mention metadata.
- Ignore unmapped groups, nonmentions, own-bot messages and duplicate event deliveries. A display-name substring is not a verified mention.
- Create one ticket per stable provider message/event identity, with a transactional receipt and source provenance. Edited/revoked messages require an explicit update policy; they must not silently create duplicates or delete work.
- Keep ticket creation internal to the intake queue. Acknowledgments and later updates need a separate explicit channel delivery policy. Never send internal staff links, client portal capability tokens or unrelated client data into a group.

Expected first acceptance: one synthetic mention creates one correctly scoped ticket, a redelivery creates none, and foreign-group/nonmention/forged-signature tests create nothing. Only then run an approved pilot in the actual group.

## Client-facing assistants

After staff preview is accepted, add client-owned assistant profiles, client/portal-principal-bound conversations, pause controls and a human handoff. Names and instructions are configuration; the server's data and tool boundaries remain authoritative. Personalization must not grant an agent staff access.

Portal context is built with the same whitelisted approach, using the authenticated portal principal's client ID. Extend it deliberately to explicitly shared documents/messages and published dashboard metrics. Keep internal and client-visible channels separate. Answers should cite source records and observation times. Start with answering questions and drafting requests; review task/status tools separately. Existing governance, budgets and pending-action receipts remain the enforcement layer for staff actions.

Do not expose the generic AI Team history or organization-wide AI bridge as client chat. The current generic route has seven hardcoded roles, and its history schema does not provide client-assistant/conversation identity. The current tool registry accepts ADMIN/TEAM only; changing that catalogue to admit CLIENT/BOT is outside this slice.

## OpenSEO and other panels

Discovery verified the OpenSEO MCP connection through a zero-credit project-list read: 63 projects are visible, including Influencers Link and several of its brands. A zero-credit read of the Influencers Link parent project's saved reports returned none; dashboard UI must therefore support a useful empty state. This connection in the development task does not establish credentials or integration inside the deployed Hub.

Build a server-side adapter with explicit client-to-OpenSEO-project allowlists, supporting several brand projects per agency client. Do not map by label alone or display the global OpenSEO workspace in a client iframe. Recheck the Hub principal and configured project mapping before every upstream read, keep credentials on the server, pin the provider origin and reject arbitrary browser-supplied URLs/project IDs.

Start with existing report/audit summaries and deep links. Return source ID, observation time, fetch time, staleness and unavailable/empty status alongside each metric. Do not fabricate SEO scores or rankings, publish private reports, connect deferred Google accounts or start paid research during a dashboard refresh. Paid tools require a separate explicit budgeted action.

Use the same adapter contract for later uptime, hosting, commerce or analytics panels. Panels should fail independently, preserve original currency/date semantics, and expose only the fields that the client's role may see. Read-only panels can ship independently of conversational AI.

## Delivery order

1. Staff client-context preview and its permission/error tests (this slice).
2. Dedicated WhatsApp account/provider validation and the mapped, idempotent mention-to-intake service; synthetic tests before live group setup.
3. Explicit OpenSEO project mappings and a read-only dashboard panel with empty/stale/unavailable states.
4. Persisted client conversations, staff-managed assistant profiles and portal access after isolation tests.
5. Additional agent actions/panels, each with its own scope, action receipts and acceptance evidence.

The existing source-app migration continues separately, with sources primary until final verification. Adding agents does not complete that migration or change the approved release's protected deployment gate.

## Primary references

- [WAHA receiving messages](https://waha.devlike.pro/docs/how-to/receive-messages/)
- [WAHA webhook events and authentication](https://waha.devlike.pro/docs/how-to/events/)
- [Meta WhatsApp Groups documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) (retrieval blocked during this review; eligibility unverified)
- [Existing governed AI tool registry](ai-tool-registry.md)
- [Existing BYOK governance](ai-byok.md)
