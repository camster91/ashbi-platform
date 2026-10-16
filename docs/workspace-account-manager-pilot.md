# Workspace account-manager pilot

Backend pilot only; disabled installations are the default. No provider response,
production enablement or end-to-end UI acceptance is claimed by local stub tests.
An existing materialized client profile is explicitly installed in one internal
CLIENT or PROJECT channel by an active ADMIN who is also a current member. Its
canonical organization/channel/client/project/profile identity cannot be remapped.
Company and direct channels are excluded. Enabling requires an enabled client-work
profile; no tools, BOT credentials, external messages or autonomous loops exist.

## API and typed cards

All endpoints below are JWT staff routes under
`/api/workspace-chat/channels/:channelId/account-manager` and require current
channel membership, including ADMIN. POST root accepts only `{profileId}` and
creates a disabled binding. GET root returns `{binding:null|{id,channelId,clientId,
projectId,profileId,enabled,revision,createdAt,updatedAt}}`. PATCH `/:bindingId`
accepts `{revision,enabled}` with CAS and current ADMIN authority.

POST `/requests` accepts `{bindingId,sourceMessageId,idempotencyKey}` (UUID). A
source must be one persisted human staff message in the exact channel, maximum
2000 trimmed characters. No implicit truncation or bot-generated source exists.
At most one durable invocation exists per source/binding, and one requester/key
cannot be reused for another input. An ambiguous response must be recovered with
the original key using GET `/requests/by-intent/:key`, never a blind new intent.

GET `/requests` accepts limit (20 default,50 maximum) and opaque after cursor.
GET `/requests/:invocationId` reads one typed card. POST
`/requests/:invocationId/cancel` accepts `{}`; only requester or ADMIN may cancel.
Cancellation stops future delivery, without claiming the dispatched provider or
usage stopped. Current members can read retained history after installation or
profile pause. By-intent recovery remains requester-only.

Cards have kind `ACCOUNT_MANAGER_DRAFT`, scope `WORKSPACE_CHANNEL`, sourceMessageId,
requestedById, bindingId, conversationId, runId, profileRevision, bindingRevision,
run status, deliveryState (`PENDING`,`DELIVERED`,`SUPPRESSED`), deliveryCode and
created/started/finished/delivered/suppressed timestamps. Response is non-null
only for a committed SUCCEEDED+DELIVERED pair. These are separate typed records,
never human chat messages. The two MCP tools `list_workspace_account_manager_requests`
and `get_workspace_account_manager_request` are read-only and use the same current
membership checks. They cannot install, enable, start or cancel inference.

## Authority and lifecycle

Each invocation has a dedicated source-bound conversation, no prior-turn memory.
Ordinary shared conversation lists exclude source-bound rows before pagination;
direct transcript/run/read/by-intent/cancel routes authorize the current source
membership and label its audience explicitly. Memory selection excludes private
source conversations. No shared client memory receives private prompts/answers.

Request, worker claim, preparation, final pre-dispatch checks and successful
settlement re-read the current requester, canonical channel/client/project,
materialized profile, enabled binding and their frozen revisions. Channel locks
are transaction-local and never span inference. The existing permanent run claim,
120-second deadline, single provider attempt, governed metering and cancellation
are reused. Private conversation archival also prevents claim and successful delivery; ordinary
shared conversation archive behavior is unchanged. Late revocation suppresses the answer; UNKNOWN retains uncertainty
without automatic inference retry. Successful answer, delivery CAS and audit
commit in one Serializable transaction. Database guards preserve immutable
source identities, exact tenant FKs, unique invocation and paired delivery state.

Migration `20261016090000_workspace_account_manager_pilot` is a confidentiality
rollback floor in the controller, migration launcher and verified-backup query.
Future integration with OAuth migration060 must retain BOTH floors. Old images
which treat all client conversations as shared must never serve this database.

Organization-owner offboarding export includes bindings, invocation outcomes and
explicit conversation audience metadata; it is not an ordinary staff read API.
Profile/membership changes do not erase historical records. Retention/removal of
private source evidence needs an explicit future policy; this pilot exposes no
hard-delete endpoint. No cross-request memory, scheduled autonomous work, real
provider acceptance or external-channel bot integration is claimed.
