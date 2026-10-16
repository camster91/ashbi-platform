# Saved client service reports

Saved reports support staff publication and an explicit ADMIN pull of existing OpenSEO reports. The pull implementation requires migration/deployment and approved credential binding; successful live provider acceptance remains pending. It accepts no HTML, arbitrary provider endpoint or research invocation.

Each canonical client can have up to 50 OpenSEO brand/project mappings. Staff read
enabled mappings; administrators also see disabled mappings. Every operation checks
the current active staff role and non-deleted client in the current organization.
Composite database foreign keys bind both mappings and reports to that client/org.

GET `/api/clients/:clientId/service-panels` and read-only MCP
`get_client_service_panels` return the same bounded projection. `limit` defaults to
20 and permits 1–50 reports per mapping; truncation flags are explicit. Reload saved reports
reads Hub storage only; the separately labeled ADMIN provider refresh is explicit. Status is never-fetched, ready, empty or unavailable.
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
No panel GET or read-only MCP request invokes publication or an upstream fetch.

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
Manual/MCP publication performs no upstream HTTP request or public delivery.
Existing read-only ChatGPT OAuth grants (`workspace:read`) remain unchanged and cannot publish. A separately consented `workspace:service-reports:publish` grant follows the existing narrow OAuth receipt and current ADMIN guards; no grant is silently upgraded. Confirmation
uses the existing API-key action confirmation evidence, not a session step-up
cookie; recent-auth JWT routes and their guards are unchanged.
Remaining activation: approved public-proxy vault credential binding and live provider acceptance. Source-specific metric projections and verified source links remain future work.

Tests cover API/MCP projection parity, current roles, tenant/deleted-client guards,
revision conflict, immutable mapping fields, strict report validation, failed audit
rollback, unavailable preservation and partial/complete replacement. The disposable
PostgreSQL test additionally exercises actual composite FK enforcement, concurrent
publication and transaction rollback; do not claim it ran if no test DB is configured.

## Explicit OpenSEO saved-report pull

Code supports an ADMIN-triggered saved-report read over the real MCP StreamableHTTP SDK at fixed `https://openseo.ashbi.ca/mcp`, using the existing public proxy Basic authentication. It does not activate a credential or guess any client/project mapping. Activation and successful live provider acceptance remain pending. Page loads, the panel GET and read-only MCP never contact OpenSEO.

ADMIN `GET /api/clients/:clientId/service-panel-credentials` returns at most 100 eligible vault ID/label/presence choices, with explicit truncation. Existing mapping PATCH accepts optional `credentialId`: omission preserves, null unbinds, an ID binds only an exact-client/same-org login with the approved declared origin. No new credential type is invented; the existing vault login model has a free-form category. The UI identifies the selected purpose as public-proxy Basic login. Binding alone establishes configured, not verified, status.

ADMIN `POST /api/clients/:clientId/service-panels/:mappingId/refresh` accepts only `{mappingRevision}`. It reads one page of at most 20 existing report IDs (`list_reports`, offset zero), then sequentially gets full summaries with `get_report(includeHtml:false)`. No research or generic tools are exposed. The SDK 1.32.1 sends 2025-era initialize/tool calls with `Accept: application/json, text/event-stream`. The inspected deployed provider classifies these as legacy requests and uses its explicit `enableJsonResponse:true` lane; non-POST legacy requests return405, so the optional SDK GET cannot retain an SSE listener. No modern envelope is claimed. This source-backed protocol match is not live authenticated acceptance. The total operation has a 20-second deadline and 2-MiB aggregate response cap. Socket-level DNS rejects non-public addresses, TLS verifies the fixed hostname, and redirects/alternate URLs are rejected. Partial detail failure marks the observation unavailable and retains all last-good rows. Provider errors and authentication challenges are not returned.

Refresh always has `partial:true`, even if the changing provider page reports a zero total; this API has no immutable snapshot boundary. It never removes stored reports. Mapping `refreshOutcome`, `refreshPartial`, `providerTotalCount` and `lastRefreshedAt` describe that read; retained rows do not become an EMPTY published snapshot. Existing manual and confirmed MCP complete snapshots retain their deliberate replacement semantics.

Per-report `provenance` distinguishes `ADMIN_PUBLISHED_SNAPSHOT` and `OPENSEO_SAVED_REPORT_PULL`. Provider `updatedAt` becomes nullable `providerEditedAt`, not metric observation time; pulled `sourceReportedAt` stays null. Mixed or bounded mappings cannot claim metric freshness from provider edit dates. Both source edit and Hub save dates remain visible. Panel envelope `source` is now `HUB_SAVED_REPORTS` (previously `ADMIN_PUBLISHED_SNAPSHOT`); consumers should use per-row provenance. New observation fields are nullable for older mappings, and only ADMIN receives bound credential ID/configured metadata. TEAM receives safe report/provenance data only.

Both DB phases are short Serializable transactions with current active ADMIN, canonical active client, mapping and credential authority. No lock is held across network latency. Publication rechecks mapping revision/project/enabled/binding and the current encrypted credential fingerprint/updatedAt under row locks; any change prevents the write. Upserts, CAS and required audit evidence share one transaction. Actual PostgreSQL revocation/rotation/remap/concurrency/rollback fixtures are authored for CI; local protocol fixtures do not establish live provider acceptance.

### Rollback floor

Migration `20261016130000_openseo_saved_report_pull` joins the existing chat visibility, OAuth binding, private pilot and Gmail receipt floors in all three authoritative sources: direct controller, migration wrapper and verified-backup catalog query. An old publisher (including 6b) would update a fetched report without clearing its provider provenance/edit date, corrupting truthful attribution after rollback/forward. New manual publication explicitly resets both fields. Therefore 6b is not a serving rollback after130. The first serving rollback must contain130 and its compatible writers; restoring an older binary requires a separately approved, verified full database restore to a pre130 backup. This source change applies no migration and alters no live floor.
