# Shared client account-manager conversations

Status: **deployed W1 foundation**, verified at `37d02b304898ec5c621199f4a2a880ebd64a6372` (#608). Required main CI [38808629217](https://github.com/camster91/ashbi-platform/actions/runs/38808629217) passed. The release passed 169 bounded live checks, including 47 agent-conversation CRUD checks, and normal browser creation/reload persistence followed by separate API archive cleanup. No Send or provider call was made during that acceptance. Prior-turn memory, persisted context observation/source evidence and real-provider/team acceptance remain open; deployment does not establish full W1 or source-app cutover. [#565](https://github.com/camster91/ashbi-platform/issues/565) owns the current queue.

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
sent as conversation memory to the provider. Prepared runs retain one
`contextObservedAt` timestamp and a versioned `contextSnapshot` containing only
the canonical client's id/name/domain, up to 25 project id/name/status/date
records, and a truncation flag. The worker commits this evidence with its
permanent claim before inference and uses exactly that snapshot and timestamp
in the prompt. Failed, cancelled or unknown runs can retain prepared evidence;
it does not prove a provider request happened. Legacy runs remain null and
never reconstruct history from current records. Database guards enforce the
paired fields, bounded whitelist, canonical client and write-once evidence.
Full W1 prior-conversation memory and real-provider acceptance remain TODO.
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
The user can submit a new explicit request with a new intent key.
Migrated-database CI and bounded deployed CRUD/browser acceptance passed;
actual model/provider acceptance remains separate.

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

## Bounded prior-turn memory (stacked implementation, not yet deployed)

Newly prepared runs retain `memorySnapshot` alongside their unchanged context v1 snapshot in the same permanent claim. Its v1 schema is `{version:1,turns:[{runId,prompt,response,responseTruncated}],truncated:boolean}`. Legacy NULL means no retained memory evidence; an explicit empty turns array means preparation found no eligible history.

History is limited to four successful prior question/answer pairs from this exact organization and conversation, oldest to newest. Sources must have finished strictly before the new run was created; creation time and run ID form the chronological cutoff and tie breaker. The query takes five candidates to detect omitted older history. Prompts retain their exact original text (at most 2,000 JavaScript UTF-16 code units); response prefixes retain at most 4,000 code units and never split a Unicode surrogate pair. The serialized UTF-8 memory limit is 8,192 bytes; the builder reserves 100 bytes for PostgreSQL JSONB serialization whitespace. Older pairs are removed first, then the latest answer prefix is shortened if necessary. Truncation is explicit. Total provider prompt input is capped at 96 KiB.

The exact retained memory is supplied as quoted prompt data, never as system instructions or reconstructed current facts. Current shareable client/project context takes precedence. Snapshot preparation checks current staff/client/conversation access and enabled profile revision in the database. Guards reject foreign, failed, future or duplicate source runs, changed original question text, invented answer text, unmarked response prefixes and later replacement/backfill. Run replay, cancellation, deadline expiry and ambiguous provider outcomes never rebuild memory or dispatch a second inference. Existing staff permissions protect retained history in API reads and workspace exports. Provider-backed and team acceptance remain separate from mock-provider CI evidence.
