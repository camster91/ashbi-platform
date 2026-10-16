# Human attention in team messages

Staff can explicitly select up to 29 other current active human members when
sending a workspace message. Typing an `@name` has no authorization effect.
The message, normalized recipient IDs, attention rows and required audit event
commit together. A unique message intent and SHA-256 of the content, reply and
sorted recipients make replay safe; changed recipients conflict with that intent.

The personal attention inbox loads 20 pending requests per page, with explicit
pagination. Its count describes loaded requests, not a global unread total.
Each request shows its source message/conversation. Only its current recipient
can acknowledge it. Acknowledged means seen, not a completed task, reassignment,
or delivery of an email/push notification. Repeating acknowledgement retains
the first timestamp and audit record.

Current active staff identity, tenant, channel membership (including ADMIN),
canonical client/project and unarchived channel remain necessary for inbox,
message reads, recovery and acknowledgement. Revoked access hides cached UI
results on a failed refresh. The existing human-only guards, fixed direct
membership and last-manager protections remain unchanged. PostgreSQL triggers
validate recipient membership and human identity with channel-first locking,
bind attention to its immutable source, and enforce complete recipients at
transaction commit. The nullable message intent hash preserves legacy rows.
Deleting a reply parent retains the existing `ON DELETE SET NULL` behavior.

Unknown send outcomes freeze the in-memory draft and recipients. This browser
stores only the actor/organization/channel-scoped opaque intent and payload
hash, never message text. After reload, check the author's saved receipt or
re-enter the exact original message/reply/recipients to reuse that intent.
A missing receipt remains uncertain and never generates a replacement key.
Other channel members cannot recover an author's intent receipt. Storage
failure disables sending. Recovery never submits automatically.

Read-only MCP `list_workspace_chat_attention` uses the same current-recipient
service and page-count semantics. It cannot send or acknowledge. The existing
operator organization offboarding export includes attention evidence alongside
its channel/message tables; that offline operator export is not an MCP access
bypass. No bot principal, model run, provider, task creation, external sending,
or automatic human acknowledgement is introduced.

Validation includes permission/replay/rollback unit tests, UI uncertainty and
selection tests, isolated actual-SQL checks, and a migrated PostgreSQL fixture
covering concurrent replay/acknowledgement and revocation. The full PostgreSQL
fixture requires a disposable loopback test database or CI; skipped local
database tests do not count as successful database validation. This feature
is not a production release or a completed bot pilot.
