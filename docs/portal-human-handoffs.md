# Human account-manager requests from the client portal

Backend slice only; no provider, model, notification, email, task completion,
staff chat membership or autonomous work is started. Existing client profile
`portalEnabled=false` rules and database constraints remain unchanged. A request
is a durable human follow-up request, separate from an AI assistant conversation.

## Portal contract and principal ownership

Under `/api/client-portal/projects/:id/account-manager-requests`:

- POST accepts only `{question,idempotencyKey}`: trimmed plain text of 1–2000
  characters and a UUID. Returns `{request,idempotent}`.
- GET accepts `limit` (20 default, 50 maximum) and opaque `after`; returns
  `{items,nextCursor}`. There is no global count.
- GET `/by-intent/:key` and GET `/:requestId` return `{request}`.

The request projection is exactly `{id,projectId,question,status,createdAt,
updatedAt}`. Status is `PENDING`, `CLAIMED` or `RESOLVED`; no owner, staff notes,
audit metadata or internal channel membership is included. The question is
plain untrusted text for a human; render it as text, never HTML or a model prompt.

Every entry point uses the existing typed client-session guard and re-resolves
the active user, contact, matching email, client and current session version.
The project must still belong to that active canonical client. Receipts, replay
and pagination are scoped to the exact user AND contact, not just the client.
Another contact at the same client cannot read, recover or use its cursor.
Deleting/recreating a contact with the same email does not inherit history.
`GET /api/client-portal/me` adds `handoffIdentity:{organizationId,userId,contactId}`
from the freshly resolved principal. Use these server IDs with project ID to
namespace pending opaque browser intents; do not parse JWTs for that identity.

`creationSessionVersion` is immutable origin evidence, not a permanent history
restriction: a new valid session for the same user/contact can read its own old
request, while an old revoked JWT is refused immediately. Contact/requester IDs
are historical scalars without deletion-blocking user/contact foreign keys.

Persist the scoped opaque intent before POST; do not persist the question in
browser storage. Unknown network responses, 409 or missing receipts must retain
that intent for explicit recovery. Repeating the same intent/question/project
returns the existing receipt. Changed question/project conflicts. Concurrent
creation commits at most one record; a Serializable/unique conflict returns 409
and is reconciled by the original intent. No automatic mutation retry exists.

## Staff lifecycle

`/api/portal-handoffs` lists bounded pages with `limit`, `after`, optional
`projectId`, `clientId`, `status`, and `owner=me|everyone`. GET `/:requestId`
reads a record. Current active ADMIN/TEAM identity, organization and canonical
active client/project are checked on every call, including inside every
Serializable mutation.

- POST `/:requestId/claim` accepts `{revision}` and claims only for the caller.
- POST `/:requestId/resolve` accepts `{revision}`; only the owner or ADMIN may
  resolve a claimed request. Resolution does not complete a project task.
- POST `/:requestId/requeue` accepts `{revision,reason}`; ADMIN only. Reason is
  `OWNER_UNAVAILABLE` (owner must no longer be active same-organization staff)
  or explicit `RECOVERY`. It clears the claim for a new human owner.

Each transition advances revision once; stale revisions and competing claims
conflict. Resolved records cannot reopen. Raw database guards retain immutable
origin, text, intent, digest and timestamps, check current staff/owner authority,
and reject invalid transitions and deletion. Required audit and state write
commit atomically; audit metadata contains IDs/status/revision/requeue reason,
never the question. No arbitrary assignee field or private staff-note field exists.

## Existing operator queue and retention

The existing work queue adds `portal_handoffs` for ADMIN/TEAM, with the same
fresh authority, canonical project/client gates, owner/client/project/view filters,
101-row source cap and partial/truncated-source reporting. Open requests map to
`needs_action`; the source URL is the existing project page. Its generic title
does not include the question, so the existing account-manager brief cannot
forward a client question to a model. It is not a second queue or a new MCP tool.
Staff and queue selection join the stored client/project/organization tuple
before cursor and limit. Existing project reassignment remains supported, but
requests bound to its old client disappear from current reads/actions/queue;
they are not inherited by the new client. No project-remapping restriction is added.

Organization-owner offboarding export includes retained requests and principal
audience evidence, omitting opaque intent and input digest. This operator export
is not a client/staff read bypass. Future retention or hard deletion requires a
separate policy; no deletion endpoint is provided.

Local unit/HTTP tests use synthetic data. The migrated PostgreSQL concurrency
and raw-guard suite requires disposable CI. A local skip is not database proof,
and this backend slice alone is not a production release or completed portal UI.

