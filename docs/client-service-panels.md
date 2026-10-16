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
source timestamps. `sourceFreshness` is unknown without source time; supplied source
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

MCP publication is deliberately not exposed until the shared executor has a closed,
client-bound preview/confirmation/receipt policy. No generic write bypass is added.
Future work: verified provider adapters, approved origins/source links, scoped MCP
publication, provider acceptance and source-specific report projections.

Tests cover API/MCP projection parity, current roles, tenant/deleted-client guards,
revision conflict, immutable mapping fields, strict report validation, failed audit
rollback, unavailable preservation and partial/complete replacement. The disposable
PostgreSQL test additionally exercises actual composite FK enforcement, concurrent
publication and transaction rollback; do not claim it ran if no test DB is configured.
