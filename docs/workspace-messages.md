# Workspace messages and client-agent settings

This slice adds staff channels/direct conversations and persistent account-manager
configuration. It is code-present; production, browser-backed populated acceptance
and real-provider verification remain separate. Bot replies, durable agent jobs,
saved assistant conversations, portal assistants and mailbox ingestion are not
implemented by this slice.

## Daily use

Staff open **Work → Messages**. Administrators can create named company channels
with explicitly selected members; staff can start direct conversations. The
server also supports client/project channels bound to existing canonical records.
There is no automatic company-wide membership grant. Direct participant sets are
immutable and normalize to one conversation per organization/participant set.

Messages support replies, older history, safe retry with the same idempotency key,
and colleague names for direct conversations. Channel discovery is paginated and
offers Load more. The UI polls every ten seconds; this slice does not claim live
socket delivery. Existing project chat, its attachments and portal/internal
visibility remain unchanged. Existing Ash chat remains at its prior destination.

Membership is required even for administrators. Removing a member prevents later
history/post access; an authorized manager can re-add active staff with retained
history available. Direct membership cannot be changed to reveal past messages.
Membership changes cannot remove the final active member or the final member
authorized to manage the channel, so retained history cannot be stranded by leaving.
Inactive/departed principals cannot post. Archived/deleted parents and a project
reassigned to another client make its former bound channel unavailable.

Within a client, expand **Account manager → Account manager settings** to save the
name, working preferences, enabled state and client-work plugin selection. GET
returns explicit revision-zero defaults without creating a row. Saves compare the
revision and require audit evidence in the same transaction; a collision keeps
the unsaved draft and offers an explicit reload. Pausing the profile or disabling
client-work blocks generated previews. The deterministic staff work brief remains
available. Preferences are untrusted data under the fixed assistant policy and
cannot grant tools or permission. Client-portal activation remains off.

## API and MCP

- GET/PATCH `/api/client-assistants/:clientId/profile` read/save staff configuration.
- GET `/api/workspace-chat/channels?limit=&after=` pages current memberships.
- GET `/api/workspace-chat/people` lists active staff for the member picker.
- POST `/api/workspace-chat/channels` creates an explicitly scoped conversation.
- GET `/api/workspace-chat/channels/:channelId/messages?limit=&after=` pages history.
- POST the same messages path with content, optional parentId and idempotencyKey.
- POST `/api/workspace-chat/channels/:channelId/read` records an advisory read time.
- PATCH `/api/workspace-chat/channels/:channelId/members/:userId` changes membership.

The existing workspace MCP also exposes `get_client_agent_profile`,
`list_workspace_chat_channels` and `get_workspace_chat_messages` as read-only tools
under `workspace:read`. They use the same services and current staff/membership
checks. No MCP send tool or expanded OAuth action scope is introduced here.

## Storage and validation

Migration `20261015020000_agency_profiles_workspace_chat` adds four directly
tenant-scoped tables. Composite foreign keys bind staff/channel edges to the same
organization; SQL guards enforce canonical client/project binding, active staff
membership and reply-parent scope. Messages and membership changes lock the
channel first, with bounded serializable retries. Duplicate message keys replay
the persisted record only when author, content and parent match.

Focused unit/UI tests cover persistence, conflicting edits, current roles,
membership, DM identity, pagination, reply scope, idempotency, stale channel/client
views and safe rendering. PostgreSQL integration tests cover actual concurrency,
raw-write boundaries, role changes and transaction rollback. Their local absence
is a skip; required CI must run them against its disposable migrated database.
