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

## Current boundary

This first bridge is read-only context chat. It must not claim that a write,
email, payment, signature, deletion, or external integration occurred. A
separate action bridge exposes one internal, allowlisted operation:
`create_task`.

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
until separately allowlisted and verified. The connection and action
requirements are defined in
[connected-workflow-contract.md](connected-workflow-contract.md).
