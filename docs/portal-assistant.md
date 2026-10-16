# Client portal account manager

This implementation is a separate, default-disabled client-facing assistant.
Deployment, enabling a client, a real provider response and real client
acceptance are separate gates. Staff agent profiles, conversations, tool role
allowlists and the enforced staff `portalEnabled=false` policy remain intact.

An ADMIN publishes an independent name and instructions at
`/api/client-assistants/:clientId/portal-config` using the current revision
(initially zero). Staff prompts are never copied automatically. These fields
are deliberately client-published. TEAM and CLIENT roles cannot configure it.
An existing organization AI connection or platform provider is governed by the
same kill switches and budget as other features; enabling this configuration
does not connect a provider or supply credentials.

The existing client-session guard and fresh portal principal resolution protect
`/api/client-portal/projects/:id/assistant`. Identity comes from the session and
canonical client/project, never a supplied organization/client identifier.
History belongs to the exact organization, client, project, user and contact.
A different contact at the same client or a replacement contact gets no history.
Support impersonation can read but cannot create, dispatch, cancel or recover.
GET never creates a conversation or run and never calls a provider. Disabled
GET returns only published name, revision and an empty history.

The first explicit Send creates a durable intent with a UUID idempotency key.
It creates the private conversation if needed. Exact replay recovers the same
run; changed input under that key conflicts. A separate explicit dispatch
claims QUEUED exactly once before contacting the model. HTTP loss does not
lose the durable run or authorize a second dispatch. There is one active run
per private conversation. The synchronous bounded dispatcher uses existing
provider governance, not another queue. The client can retrieve status by run
or intent after disconnect; no automatic retry occurs.

The immutable intent expires 60 seconds after creation. A provider call uses
singleAttempt, an abort signal, at most 2048 output tokens, a 16000 UTF-8 byte
response limit and a 100000 byte prompt limit. An aborted/ambiguous provider
attempt is UNKNOWN and cannot dispatch again. Recovery after deadline changes
QUEUED to EXPIRED or RUNNING to UNKNOWN, without another provider request.
Cancellation is durable and aborts an in-process request when possible;
requests in another process still have their own bounded signal and any later
result is discarded. Neither cancellation nor timeout proves upstream billing
was reversed. No background retries are registered.

Statuses are QUEUED, RUNNING, SUCCEEDED, FAILED, UNKNOWN, CANCELLED, EXPIRED and
DISCARDED. FAILED means an empty, nontext or oversized response, or a typed pre-inference
AI_DISABLED / AI_BUDGET_EXCEEDED control denial; UNKNOWN means
an ambiguous provider failure/deadline. A changed principal, session, contact,
client, project binding, enabled flag or config revision after the external
await discards output. Terminal runs cannot be rewritten. A process crash may
leave RUNNING until explicit deadline recovery; status reads do not mutate it.

The fixed model policy treats instructions, canonical fields, prior turns and
questions as untrusted data. Context contains only bounded canonical client
and project identity, project status/dates and this same private conversation's
last four successful turns. SQL validates that snapshot and memory provenance.
There are no tools, private files, staff briefs/transcripts, email, financial
records, service-panel data or credential access. Answers are plain text and
cannot create tickets, send messages, approve work or promise completion.
The existing explicit idempotent human account-manager request is the handoff.

Short serializable phases take parent row FOR SHARE locks before authorization
and run writes. Locks cover user, contact, client, project and configuration
and are released before the upstream await. Settlement reacquires them and
revalidates current authority. SQL triggers also lock and validate origins,
immutable intent, claim, principal, configuration and terminal transitions.
Every state/config change commits with required sanitized audit evidence.
The additive migration creates new tables; old code never reads or writes them,
so it does not change the pre-existing deployment rollback floor.

Focused unit and route fixtures exercise isolation, concurrency, recovery,
audit rollback, source exclusion and no-provider GET behavior. Migrated real
PostgreSQL fixtures additionally exercise raw SQL guards and coordinated
revocation writers waiting on settlement locks. These fixtures must run in
required CI with a disposable PostgreSQL database; a local skip is not proof.
