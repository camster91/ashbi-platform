# Connected-workflow contract

This contract governs integrations between Ashbi, conversational AI clients,
and workspaces such as Slack and Notion. It deliberately separates **search
and context** from **actions that change data or communicate externally**.

## Product principle

An integration must be useful at the level a person actually authorized, while
remaining understandable and reversible. Workspace installation alone does not
grant Ashbi or an AI client unrestricted access to organization data.

## Connection model

Every connection records the following independently:

| Control | Requirement |
| --- | --- |
| Organization installation | An organization administrator approves the provider app, its requested scopes, and a named connection owner. |
| User consent | A person connects their own provider identity before Ashbi acts as that user or searches content available only to that user. |
| Resource routing | Project channels, documents, calendars, and client spaces are explicitly mapped. Unmapped resources are out of scope. |
| Capability | The connection declares whether it can search, import, create, update, send, or delete. Write capabilities are not inferred from read scopes. |
| Lifecycle | The UI exposes connection owner, granted scopes, mapped resources, last success/error, reconnect, and disconnect. Disconnect revokes use immediately and clears provider tokens. |
| Audit | Ashbi retains the actor, connection, mapped resource, requested action, result, correlation/idempotency key, and a minimal failure reason. It does not retain raw provider payloads unless an approved retention policy requires it. |

## AI interaction boundary

The current ChatGPT-compatible bridge remains read-only. It may summarize and
retrieve tenant-scoped Ashbi context, but it must say that a provider search or
write has not occurred unless an explicit connected action succeeded.

A future action bridge may offer a small allowlist, beginning with draft and
preview operations. A consequential operation--sending a Slack message,
creating or changing a calendar event, notifying a client, charging a payment,
or deleting data--requires all of the following:

1. the authenticated user has the Ashbi role and provider permission;
2. the target project/resource is explicitly mapped to the connection;
3. the UI shows a human-readable preview of the target and effect;
4. the user confirms the exact action at execution time;
5. the request carries an idempotency key and produces an audit record; and
6. the result is reported with a provider link or a clear retry-safe error.

AI instructions and retrieved text are untrusted input. They cannot broaden
the action allowlist, alter tenant scope, substitute for confirmation, or
reveal provider credentials.

## Provider-specific first slices

| Provider/workflow | First supported direction | Deferred until evidence and policy exist |
| --- | --- | --- |
| Slack | Mapped-channel inbound events to project chat; installation and mapping administration | Thread/channel parity, outbound delivery/retry, broad history search, retention policy, and sandbox approval |
| Notion | Controlled Markdown export import into an explicitly selected project | Live workspace sync, full-page search, templates/mentions parity, and a connection/webhook policy |
| Google Calendar | Ashbi-authoritative outbound creation/update for an explicitly selected calendar | Inbound or two-way reconciliation, recurring-event conflict policy, deletes, and sandbox approval |
| ChatGPT/Codex | Read-only, tenant-scoped Ashbi context and declared reusable workflow instructions | Allowlisted write tools once confirmation, auditing, provider credentials, and dogfood evidence exist |

## Required proof before enabling a write capability

Each provider/action pair needs a disposable sandbox run covering successful
execution, denied permission, unmapped resource, expired/revoked connection,
duplicate delivery, retry-safe provider failure, disconnect, and tenant
isolation. Attach the evidence to the corresponding issue before describing
the capability as provider-verified or replacement-ready.

