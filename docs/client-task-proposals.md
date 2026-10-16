# Client task proposals

Implementation is reviewed locally; required CI, deployment and live acceptance
are pending. The account-manager profile keeps `client-work` read-only and
selects no task plugin by default. Administrators can explicitly enable
`client-task-actions` for an enabled client profile.

Staff can prepare an unassigned task in an active project belonging to the
canonical client, review the stored server preview, then explicitly confirm
with recent authentication. The existing workspace executor commits the task
and receipt together in a Serializable transaction. It rechecks the current
requester and approver, profile revision, enabled plugin and client/project
binding. Model responses do not automatically call this tool.

MCP exposes `create_client_task` under `workspace:actions`. Client-bound receipts
require fresh authority through the workspace or dedicated client routes;
generic legacy approval endpoints do not expose these receipts. Internal task
creation has no outbound message, billing, assignee or arbitrary-tool effects.

The browser retains only a scoped opaque intent and input hash. Reopening reads
the receipt without creating or confirming. Unknown outcomes retain the same
intent until a definitive server result is available. Permission or profile
changes hide controls and invalidate old previews.

Focused tests cover opt-in settings, source/role isolation, atomic execution,
recovery and stale UI responses. Real PostgreSQL concurrency/rollback tests
must pass the required hosted gates before merge.
