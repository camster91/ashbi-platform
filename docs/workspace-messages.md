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

## Client and project channel creation

The Team messages form offers staff direct messages, client channels and project
channels. Only administrators see company channel creation, matching the existing
backend policy. Client/project selectors read the canonical paginated APIs; project
choices are restricted to the selected client and reset when that client changes.
Changing a selector or opening the form sends no creation request.

Channel membership stays explicit: the creator and selected active staff receive
access. A client/project label does not invite the client, grant portal access, or
change assignments, billing or underlying record permissions. The backend rechecks
the current staff actor, members and canonical non-deleted client/project on submit.

A failed lookup blocks creation and offers retry. On an uncertain non-direct channel
creation response, the form preserves its draft, blocks repeat creation and offers
Reload conversations (and existing channel pagination) so the user can locate the
result. Reload never posts again. This is bounded recovery in the current form;
non-direct creation does not yet have a durable server idempotency key, so this UI
does not claim exactly-once recovery across browser reloads. Direct-message
creation retains the backend's existing participant-set deduplication.

Bot participation, structured mentions, handoff execution and source-linked agent
replies remain separate unfinished work. No new bot identity, provider call or
transport is added by these selectors.
