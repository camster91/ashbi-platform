# Optional scoped MCP OAuth actions

This branch depends on the reviewed saved-report publication implementation in
PR #625 (`37a8139`). It does not enable a connection, alter an existing grant,
change deployment settings, or invoke a provider. Existing connections and
authorization requests without explicit scopes default to `workspace:read`.

## Grant contract

`workspace:client-tasks:write` permits only `create_client_task`.
`workspace:service-reports:publish` permits only
`publish_client_service_report_snapshot`. Optional scopes require a current
active ADMIN. They never imply API-key `workspace:actions`, billing, calendar,
generic records, arbitrary HTTP, provider access or assistant-run authority.

OAuth requests must include `workspace:read` and may explicitly request either
optional scope. Consent preview returns `scopes` (the read-only default),
`requestedScopes`, and `optionalScopes` (requested choices with labels).
POST consent accepts optional `scopes`: omitted means read-only; a selection
must include read and be a subset of the original request. Existing nonce,
account/session binding, same-origin check, recent-auth requirement and
single-use PKCE exchange remain required. Optional checkboxes start unchecked.

Scopes are copied exactly from consent to code, persisted access-key row and
Redis grant/refresh family. No fallback to supported scopes widens an existing
grant. Refresh accepts omitted scopes or the identical normalized original set;
other sets are rejected. Narrowing requires a new authorization, never a silent
upgrade or misleading response. Access validation and refresh verify persisted
key scopes match the grant. Write grants stop working upon ADMIN demotion,
deactivation, session revocation, required MFA, tenant change, key revocation,
expiry or scope changes. Read-only TEAM grants retain their previous policy.

## Action contract

Preparation freezes preview/input and stores an immutable, nullable
`authorizationBinding` on the existing action receipt. It identifies the OAuth
key, actor, organization, session version, public client and required scope.
Existing API-key/session actions retain NULL and their previous authorization.
Different OAuth connections, API keys and session callers cannot adopt an
OAuth-bound receipt, even if they belong to the same user.

`get_action`, `confirm_action`, `reject_action`, preparation replay and terminal
receipt replay derive permission from the **stored target action**, never just
the fact a control is advertised. A report grant cannot control a task, a task
grant cannot control a report, and neither can control legacy broad actions.
Every receipt is still owner/organization bound and checks current canonical
client/project/profile or mapping authority. Closed generic HTTP/legacy receipt
guards and OAuth token audience restrictions stay in place. MCP currently has
no by-intent lookup; retry the same preparation key/input to recover its receipt.
Unknown responses are not permission to create another intent.

Preparation and confirmation/rejection reread persisted key authority and the
current ADMIN inside their Serializable transaction. Confirmation retains the
tool's own fresh requester/approver/client checks, preview rederivation, mapping
CAS, idempotency and atomic mutation/receipt/audit guarantees. Revocation before
the claim does not add approval or failure evidence to a pending receipt.

MCP security schemes advertise each action's narrow scope and alternative narrow
scope schemes for shared controls. Scope hints do not replace server checks.
Confirmation records `method: oauth_confirm`, `reauthenticated: false`.
An explicit `confirm_action` call proves an authenticated API request, **not a
fresh human click**. Initial browser consent has recent authentication; a separate
per-action browser approval gate is outside this feature.

## Verification boundary

Focused tests cover old grants, optional consent/downscoping, refresh escalation,
scope/target matrices, SDK discovery metadata, wrong grants, current authority,
replays and transaction-time revocation. A disposable PostgreSQL regression
checks the additive binding constraint/immutable trigger and publication
transaction guard. If its loopback fixture is unavailable, report it skipped;
unit or isolated SQL checks do not prove the full PostgreSQL path.
