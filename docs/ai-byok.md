# Organization AI provider: bring your own key

Status: **slice 1 of #413** (governed BYOK AI control plane). Code-present,
not provider- or target-verified. Numbers marked *Proposal* are defaults for
the owner to confirm or change.

An organization admin can connect the workspace's own OpenAI-compatible
provider account. The workspace's AI features then run on that account, within
a monthly budget, and either the workspace or the whole deployment can turn AI
off at once. Organizations that connect nothing keep using the platform
provider exactly as before.

## How a call is routed

Every AI feature calls `getProvider()` / `aiClient` (`src/ai/providers/index.js`,
`src/ai/client.js`). Both now go through `src/ai/governance.js`, which reads
the organization from the request or job context
(`getRequestOrganizationId()`: set by the tenancy middleware for requests and
by `runTenantJob` for background jobs) and decides, in this order:

| Step | Condition | Result |
| --- | --- | --- |
| 1 | Deployment kill switch on (`AI_DISABLED=true`, or the operator toggle) | `503 AI_DISABLED`, no provider contacted |
| 2 | No organization in context (unscoped jobs, `/api/bot` without an org) | Platform provider, unchanged |
| 3 | Organization `aiDisabled` | `503 AI_DISABLED`, no provider contacted |
| 4 | Connection `status = active` | Budget check, then one call to the organization's provider; one `AiUsageRecord` |
| 4b | Connection `status = disabled` (its key failed validation) | `503 AI_CONNECTION_DISABLED`; never falls back to the platform |
| 4c | Stored key cannot be decrypted (key version missing) | `503 AI_CONNECTION_UNAVAILABLE`; never falls back |
| 5 | No connection, or `status = revoked` | Platform provider, unchanged |

The organization's kill switch and connection are cached per API or worker
process for **30 seconds** (*Proposal*, `AI_ORG_CACHE_TTL_MS`). Admin changes
invalidate the cache of the process that handled them at once; other processes
(the worker, other API instances) see them within the TTL.

`Ash chat` (`/api/ash-chat`) keeps its own provider chain but applies the kill
switches and, for an organization with an active connection, answers through
it.

### Failure behaviour

- **One request, no retries.** The adapter makes exactly one HTTP request per
  call, with a 60-second timeout (`DEFAULT_REQUEST_TIMEOUT_MS`). A failure is
  reported, never silently retried, so it cannot spend the budget twice.
- **No silent fallback.** A BYOK failure is never re-sent to the platform
  provider: the organization chose where its data goes.
- **Typed errors.** Failures become `AiProviderError` with a fixed message per
  type and code `AI_PROVIDER_<TYPE>`:

  | Type | Upstream | HTTP to caller |
  | --- | --- | --- |
  | `auth` | 401, 403 | 502 |
  | `quota` | 402, or 429 with `insufficient_quota` | 502 |
  | `rate_limit` | other 429 | 502 |
  | `timeout` | no answer in 60 s, 408, 504 | 504 |
  | `invalid_request` | other 4xx (for example an unknown model) | 502 |
  | `upstream` | 5xx, network error | 502 |
  | `invalid_response` | 2xx without a message | 502 |

  The provider's response body is never included: some providers echo part of
  the key back in their error text.
- **Clear errors in the product.** The AI routes (`/api/ai/*`, search `ask`,
  email triage, invoice chaser, paste intake, project plans, the AI bridge)
  and the global error handler answer `{ error, code }` with the codes above,
  `402 AI_BUDGET_EXCEEDED` and `503 AI_DISABLED`, instead of a generic 500 or a
  canned answer. The AI bridge uses its OpenAI error shape
  (`{ error: { message, type: "ai_control_error", code } }`).

## Setup

Settings → **AI provider (bring your own key)** (admins only), or the API:

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET /api/ai-connections` | admin | Masked connection, the workspace kill switch, and month-to-date usage |
| `POST /api/ai-connections/connect` | admin + step-up | `{ baseUrl, apiKey, allowedModels, defaultModel, monthlyBudgetCents }` |
| `POST /api/ai-connections/validate` | admin | Re-check the stored key |
| `POST /api/ai-connections/rotate` | admin + step-up | `{ apiKey }` |
| `POST /api/ai-connections/revoke` | admin + step-up | Wipe the stored key |
| `PATCH /api/ai-connections/settings` | admin | `allowedModels`, `defaultModel`, `monthlyBudgetCents` |
| `POST /api/ai-connections/disable`, `/enable` | admin + step-up | Workspace kill switch |
| `POST /api/settings/ai-kill-switch` | platform operator + step-up | `{ disabled }`, deployment kill switch |

Step-up means the admin re-authenticated in the last 10 minutes
([privileged-actions.md](privileged-actions.md)); the web app prompts for it.

**Connect** accepts any OpenAI-compatible endpoint: `baseUrl` may be given with
or without a trailing `/v1`; calls go to `<baseUrl>/v1/chat/completions`.
Before anything is stored the server:

1. checks the URL (below);
2. calls `GET /v1/models` with the key and requires the default model to be
   listed; if the provider has no models endpoint (400/404) it sends a one-token
   completion instead.

Only if that succeeds is the key encrypted and saved. Connecting again replaces
the existing connection (one per organization).

### Base URL policy (SSRF)

`src/security/outbound-url-policy.js`:

- `https` only. Plain `http` is accepted only for `localhost`, `127.0.0.1` or
  `::1` outside production (local model servers in development).
- No credentials, query string or fragment in the URL.
- In production the host is resolved with `dns.lookup` (all addresses) and
  every address must be publicly routable: loopback, RFC 1918 private,
  link-local (including `169.254.169.254` cloud metadata), carrier-grade NAT,
  IPv6 unique-local and link-local, multicast, documentation, benchmarking and
  unspecified ranges are rejected, including IPv4-mapped and NAT64 IPv6 forms.
- Because DNS can change after validation, in production the same check runs
  again before **every** request to the provider. A rebinding window between
  that lookup and the connection's own lookup remains; pinning the resolved
  address in the HTTP client would close it (not done in slice 1).

## What is stored, and how

`ai_provider_connections` (one row per organization, `organizationId` unique):

| Field | Content |
| --- | --- |
| `baseUrl` | Normalized base URL |
| `encryptedApiKey` | The key as a `src/utils/crypto.js` AES-256-GCM envelope (`v1:<keyVersion>:…`), the same format and key custody as the credential vault ([credential-vault-security.md](credential-vault-security.md)). `null` after revoke. A database CHECK requires it for `active` rows and forbids it for `revoked` rows |
| `keyLast4` | Last four characters, for display and audit |
| `allowedModels`, `defaultModel` | Calls use the default model; a caller may request another model only if it is allowed |
| `monthlyBudgetCents` | Budget in US cents |
| `status`, `disabledReason` | `active`, `disabled` (key failed validation) or `revoked` |
| `lastValidatedAt`, `lastValidationError` | Last check and its error *type* only |
| `createdById`, `rotatedAt`, `revokedAt` | History |

`npm run rotate:credential-keys` re-encrypts these keys along with the vault.

`ai_usage_records`: one row per BYOK call (successful or not): organization,
connection, model, prompt and completion tokens, estimated cost, feature (the
route pattern, or `background_job`), request id, success and error type. No
prompt or response text is stored.

The key is never returned by the API (responses list fields explicitly and
show `keyLast4` only), never written to audit metadata (host and last four
only), and never logged: the provider keeps it in a non-enumerable property
that JSON and `util.inspect` skip, error messages never include provider
text, and `apiKey` is a redacted log path. The unit tests check responses,
captured logs, usage records and audit rows for the raw key.

Both tables are direct tenant-scoped models in the Prisma tenant proxy; one
organization's admin cannot read or change another's connection.

## Rotation and revocation

- **Rotate**: submit the new key. It is validated against the stored base URL
  and default model first; on failure the old key stays in place and keeps
  working. On success the ciphertext is replaced, `rotatedAt` is set and a
  disabled connection becomes active again. Revoke the old key at the provider
  afterwards.
- **Validate**: re-checks the stored key. A rejected key (`auth`) or a base URL
  that no longer passes the policy disables the connection (calls fail with
  `AI_CONNECTION_DISABLED` rather than using a dead key); a later successful
  check re-activates it. Transient failures only record the result.
- **Revoke**: wipes `encryptedApiKey` and sets `status = revoked`. The workspace
  falls back to the platform provider (turn AI off first if that is not
  wanted). Also revoke the key at the provider: Ashbi cannot do that for you.

## Budgets

- Cost is estimated from token usage and `AI_MODEL_PRICES`, a JSON object of
  US cents per million tokens keyed by model id
  (`{"example-model":{"input":15,"output":60}}`). Prices are deployment
  configuration rather than code so they can follow vendor price changes.
  A model without a price is metered with `estimatedCostCents = null`, does
  **not** count toward the budget, and is shown to admins as unpriced tokens.
- Before each BYOK call, if month-to-date (UTC calendar month) estimated spend
  is at or above `monthlyBudgetCents`, the call is refused with
  `402 AI_BUDGET_EXCEEDED` and no request is sent. `ai.budget_exceeded` is
  audited at most once per organization per hour per process (*Proposal*).
- After a call, when spend first reaches **80%** of the budget (*Proposal*,
  `AI_BUDGET_ALERT_RATIO`), `ai.budget_alert` is audited once per month (checked
  in process and against `audit_events`, so restarts and other instances do
  not repeat it).
- The budget is a soft cap: calls already in flight when the limit is reached
  complete and are counted, so spend can exceed the budget by at most the
  cost of concurrent calls.

## Kill switches

| Switch | Who | Effect | Persistence |
| --- | --- | --- | --- |
| `AI_DISABLED=true` | Deployment (env) | Every AI call fails with `AI_DISABLED` | Until the env changes; the toggle below cannot override it |
| `POST /api/settings/ai-kill-switch` | Platform operator (`PLATFORM_OPERATOR_USER_IDS`), step-up | Same | In memory, per API process, like the platform provider switch: the worker and other instances are not affected and a restart clears it. Use `AI_DISABLED` for a durable stop |
| `POST /api/ai-connections/disable` | Organization admin, step-up | Every AI call for that organization fails with `AI_DISABLED`, BYOK or platform | `organizations.aiDisabled`; every process within the cache TTL |

Embeddings for semantic search (`src/services/embedding.service.js`) do not
go through the chat provider and are not affected by BYOK or the kill switches
in slice 1.

## Audit events

`ai.connection_connected`, `ai.connection_validated`, `ai.connection_rotated`,
`ai.connection_revoked`, `ai.connection_settings_changed`, `ai.disabled`,
`ai.enabled`, `ai.budget_alert`, `ai.budget_exceeded`. Fields are listed in
[audit-events.md](audit-events.md).

## Proposals for owner approval

| Setting | Proposed value | Where |
| --- | --- | --- |
| Per-process organization cache | 30 seconds | `AI_ORG_CACHE_TTL_MS`, `src/ai/governance.js` |
| Spend alert threshold | 80% of the monthly budget, once per month | `AI_BUDGET_ALERT_RATIO` |
| `ai.budget_exceeded` audit throttle | 1 per organization per hour per process | `AI_BUDGET_EXCEEDED_AUDIT_WINDOW_MS` |
| Provider request timeout | 60 seconds, no retries | `DEFAULT_REQUEST_TIMEOUT_MS`, `src/ai/providers/openai-compatible.js` |
| Budget range | 1 cent to 1,000,000 USD per month | `aiConnectionConnectSchema` |
| Step-up for validate and settings | Not required (connect, rotate, revoke and kill switches are) | `src/routes/ai-connection.routes.js` |

## Slice 2 (not built yet)

- A **tool registry**: which tools an AI call may use, per organization.
- An **approval queue** for AI-proposed actions.
- An **adversarial evaluation suite** (prompt injection, data exfiltration).

They attach at `createAiGovernance({ beforeCall, afterCall })` in
`src/ai/governance.js`: both hooks receive the resolved route (platform or
BYOK), the organization and the call options before any provider is
contacted, and the usage afterwards.
