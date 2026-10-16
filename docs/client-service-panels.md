# Saved client service reports

Status: code implemented; production migration, deployment and acceptance pending.
This is an administrator-published snapshot store, not an OpenSEO connection.
No upstream request, paid research, credentials, HTML or arbitrary source URL is accepted.

Each canonical client can have up to 50 OpenSEO brand/project mappings. Staff read
enabled mappings; administrators also see disabled mappings. Every operation checks
the current active staff role and non-deleted client in the current organization.
Composite database foreign keys bind both mappings and reports to that client/org.

GET `/api/clients/:clientId/service-panels` and read-only MCP
`get_client_service_panels` return the same bounded projection. `limit` defaults to
20 and permits 1–50 reports per mapping; truncation flags are explicit. Refresh
reads Hub storage only. Status is never-fetched, ready, empty or unavailable.
Hub `lastSuccessAt`/`hubStoredAt` are distinct from nullable administrator-supplied
source timestamps. `sourceFreshness` is unknown without source time or when
reports are omitted by the bounded read (with `sourceObservedAt: null`); a
Hub-storage-ordered page cannot establish the newest source date for the complete
mapping. Supplied source
time is not provider authenticity evidence. Hub storage staleness uses 24 hours.
No source links are emitted in this slice.

JWT ADMIN routes create a mapping (`POST .../service-panels`), edit its label/enabled
state (`PATCH .../service-panels/:mappingId`), and publish supplied report metadata
(`POST .../service-panels/:mappingId/snapshots`). The provider, canonical client and
provider project identifier cannot be remapped. Publication requires the observed
mapping revision and matching provider project identifier, reauthorizes inside a
serializable transaction, and increments revision atomically with an audit event.

Publication accepts at most 50 reports, unique opaque report identifiers, bounded
plain text, and nullable non-future source dates. A complete OK snapshot removes
reports absent from that snapshot. A partial OK snapshot only replaces supplied
reports. Explicit complete EMPTY clears reports. UNAVAILABLE preserves the last
successful reports and source data, recording only a stable failure code and attempt.
No UI read or refresh invokes publication or an upstream fetch.

API keys with `workspace:actions` can prepare `publish_client_service_report_snapshot`
with `{ input: { clientId, mappingId, snapshot }, idempotencyKey }`; `snapshot` is
exactly the existing strict publication body. The existing 16 KiB serialized-tool
input ceiling still applies (and the schema permits no more than 50 reports).
A fresh administrator is required at preparation and confirmation. The tool returns
a reviewed canonical destination, exact report text, replacement/deletion counts
and a warning that complete/EMPTY snapshots irreversibly remove omitted reports.
Only an explicit `confirm_action` commits publication, audit and receipt together
inside one Serializable transaction. `get_action` and idempotent replays recover
receipts after the mapping revision advances; they still require current admin,
client and mapping/provider-project authority. Generic AI approval/receipt and
legacy bridge routes exclude this client-bound action.

This internal irreversible operation has one explicit literal entry in the closed
registry allowlist and advertises `destructiveHint: true`; it is never retried.
There is no upstream HTTP request, verified provider origin or public delivery.
Existing ChatGPT OAuth grants and consent remain read-only (`workspace:read`);
this tool is unavailable to them and no grant is silently upgraded. Confirmation
uses the existing API-key action confirmation evidence, not a session step-up
cookie; recent-auth JWT routes and their guards are unchanged.
Future work: verified provider adapters, approved origins/source links, separately
consented OAuth writes, provider acceptance and source-specific report projections.

Tests cover API/MCP projection parity, current roles, tenant/deleted-client guards,
revision conflict, immutable mapping fields, strict report validation, failed audit
rollback, unavailable preservation and partial/complete replacement. The disposable
PostgreSQL test additionally exercises actual composite FK enforcement, concurrent
publication and transaction rollback; do not claim it ran if no test DB is configured.
