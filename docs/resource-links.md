# Task and project resources

Resources are named HTTP(S) links on a project or one of its tasks. Equal URLs
remain separate records. The app stores the exact URL, including query and
fragment, without fetching it, generating a preview or granting provider access.

Staff can add resources and reorder the complete active list. The creator or an
admin can edit, share, archive and restore a resource. Every operation checks the
current stored user, organization and canonical project/task. Each target allows
500 active resources; archived history is retained and browsed separately.

Resources are private by default. Explicit sharing exposes only the title, URL,
order and update time in the live client's project portal. Source references,
creator information and internal task identifiers are excluded. The destination
provider still controls access to its files and pages.

The portal loads 100 resources initially. Load more retrieves one additional
page on request; a failed page can be retried without losing visible links.

Staff HTTP endpoints live under `/api/resource-links`; the read-only portal
endpoint is `/api/client-portal/projects/:id/resource-links`. See the generated
[OpenAPI contract](openapi.json) for payloads. Writes use expected revisions;
ordering submits every active ID and revision atomically. Creation requires a
UUID intent: retry the same intent with the identical payload after a lost
response. Reusing it with changed input returns a conflict. Optional source
metadata is immutable caller-provided provenance, not verified provider identity.

MCP reads and previews use the same service. Mutations require the reviewed
fingerprint, idempotency key and explicit confirmation through the existing
transactional action executor. OAuth writes require a new explicit
`workspace:resource-links:write` grant; existing grants gain no write authority.
See [OAuth scope rules](scoped-mcp-oauth-actions.md).

The additive migration creates the resource table, tenant/parent constraints,
immutable provenance and archive/revision guards. Required hosted integration
tests exercise the committed migration against disposable PostgreSQL. Local
unit tests alone do not verify database constraints or concurrency.


Resource links, including archived links, retain their parent task, project and client recovery records. Permanent trash deletion returns HTTP 409 with code `RESOURCE_LINK_RETENTION` when a parent contains retained resources; restore the parent to manage those resources. Empty trash reports the same fixed reason for each retained item. Scheduled expiry counts these items as `retained`, preserves their recovery ledger, and continues with other items; unrelated database failures remain failures. Archiving a link does not authorize its hard deletion or removal of its provenance.
