# Shared client account-manager conversations

Status: **code-present, unshipped**. This documents the durable conversation
follow-up under the existing agency plan. It does not establish production
migration, a working provider connection, real-client acceptance or source-app
cutover.

`ClientAgentConversation` attaches a staff-shared conversation to one canonical
client and organization. `ClientAgentRun` stores each submitted question,
response when available, requester, profile revision and durable run status.
All current active ADMIN and TEAM members in that organization can read these
conversations. CLIENT and BOT principals cannot read them; a conversation's
creator does not make its transcript private from the Ashbi team. Current
client and staff authority are checked again on each request.

The API lives under
`/api/clients/:clientId/assistant/conversations`. History uses bounded keyset
pages; conversation detail also returns its active run independently of the
history cursor. The requester's opaque intent lookup supports recovery after
a lost response. A missing receipt is a current read result and cannot prove
that a delayed start will never commit.

Questions are limited to 2,000 characters and conversation titles to 200.
The transcript is application data, not audit metadata or an outbox payload.
Each request uses the current bounded client/project snapshot and that run's
question. Earlier conversation turns are stored for staff to read but are not
sent as conversation memory to the provider. The run does not persist the
context observation time (`observedAt`) or source references, so the complete
W1 conversation-memory/context-evidence acceptance remains TODO.
Run-request events carry only `clientId`, `conversationId`, `runId` and
`requestedById`. Safe HTTP projections exclude input hashes, intent keys,
worker claim tokens and profile instructions. Provider credentials remain in
the existing connection system.

Archiving preserves stored conversations and runs. An administrator or the
conversation's creator may archive with the observed revision; reading an
archived conversation requires the explicit history flag. The implementation
adds no automatic time-based transcript purge. This storage
behavior does not resolve the wider workspace retention decision (#310).
Soft trash and conversation archival retain the stored transcript; permanently
purging a canonical client cascades to its conversations and runs.
Cancellation is available to the requester or a current administrator; it
does not promise that a provider request already dispatched was stopped or
that it incurred no usage.

Queue delivery has three bounded attempts with exponential backoff starting
at two seconds. A worker permanently claims `QUEUED` as `RUNNING` before
provider work; retrying delivery cannot reclaim a running or terminal run or
repeat its inference. Recovery marks a run still queued after ten minutes
`FAILED` with `RUN_QUEUE_EXPIRED`, without invoking the provider or enqueueing
another run. An expired running deadline becomes `UNKNOWN`; it is not
automatically retried because provider usage or an answer may already exist.
The separate minute-based maintenance job performs expiry scans on the existing
scheduled-maintenance queue; it never delays the outbox dispatcher. Provider
waiting is bounded by the remaining 120-second run deadline, including time
already spent preparing context. The worker aborts supported transports and
releases its slot even if a provider ignores cancellation; late results cannot
replace the terminal outcome. Cancellation/timeout still cannot prove that an
upstream request incurred no usage.
The user can submit a new explicit request with a new intent key. These are
code behaviors awaiting migrated-database and deployment acceptance.

The per-feature Claude SDK call uses `singleAttempt: true`, disabling SDK
retries and setting a 90-second request timeout. The existing BYOK adapter
already makes one fetch. Neither transport setting proves that an ambiguous
provider timeout incurred no usage, so running expiry remains `UNKNOWN`.

The operator-only [workspace export](workspace-export.md) includes archived
conversations and their retained questions, responses and outcomes for active
clients in the requested organization. It omits request intent keys, input
hashes and worker claim tokens. Children of trashed clients follow the
existing export exclusion. This export is private organization data and must
be delivered through the established offboarding process, not a public or
client-portal transcript endpoint.
