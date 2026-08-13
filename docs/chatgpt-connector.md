# ChatGPT connection contract

Ashbi exposes an opt-in, tenant-scoped OpenAI-compatible bridge for users who
want ChatGPT (or another compatible client) to work with Ashbi context.

## Connection

1. An authenticated Ashbi user creates an API key under Settings → API keys.
2. The connector calls `GET /api/ai-bridge/capabilities` with `x-api-key: ashbi_…`.
3. ChatGPT-compatible clients send OpenAI-shaped requests to
   `POST /api/ai-bridge/v1/chat/completions`.

The response uses the standard `chat.completion` shape. The bridge injects only
the authenticated organization's bounded project, task, and client context.
API keys are hashed at rest, tenant scope comes from the key owner, and provider
credentials are never returned.

## ChatGPT Action setup

For a private custom GPT, import
[chatgpt-actions.openapi.yaml](chatgpt-actions.openapi.yaml) into the Actions
editor and configure API-key authentication with the `x-api-key` header. This
schema intentionally exposes only the capability manifest and the existing
prepare/confirm action protocol. It does not grant search access to Notion or
Slack, and it cannot bypass Ashbi's tenant, role, mapping, confirmation, audit,
or idempotency checks.

The assistant must call `getAshbiCapabilities` first. For a write, it calls
`prepareAshbiAction`, presents the returned preview, and calls
`confirmAshbiAction` only after the same user explicitly approves that exact
preview. ChatGPT Actions require an OpenAPI schema and workspace/domain policy
approval; see [OpenAI's Actions configuration guide](https://help.openai.com/en/articles/9442513).

## Current boundary

This first bridge is read-only context chat. It must not claim that a write,
email, payment, signature, deletion, or external integration occurred. A
separate action bridge exposes two allowlisted operations: `create_task` and
`send_slack_message`. The Slack action can post only to an active,
outbound-enabled channel that an Ashbi administrator mapped to the selected
project. To reply, it may include an Ashbi root `threadMessageId`; Ashbi
verifies that it is a mapped-project Slack thread before preview and again at
confirmation. The connector never accepts a raw Slack timestamp as a target.

1. Send a task request to `POST /api/ai-bridge/v1/actions/prepare` with an
   idempotency key.
2. Review the returned project/task preview and expiry time.
3. Send `{ "confirm": true }` to
   `POST /api/ai-bridge/v1/actions/<action-id>/confirm`.

Only the API-key owner may provide explicit user confirmation for the action.
Ashbi records the input hash, preview, confirmation, result, and final status
before returning success. The
chat-completions endpoint itself remains read-only. Email, payment, signature,
deletion, provider actions, and every other workflow action remain unavailable
until separately allowlisted and verified. Slack installation, provider
approval, sandbox verification, retention, and outbound retry/recovery remain
separate gates. If a Slack post has an uncertain provider outcome, Ashbi marks
the action failed and retains only its attempted mapping and channel with
`deliveryState: "UNKNOWN"`; a person must reconcile it before creating a new
message action. The connection and action
requirements are defined in
[connected-workflow-contract.md](connected-workflow-contract.md).
