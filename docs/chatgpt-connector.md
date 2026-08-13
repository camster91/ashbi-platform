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
future action bridge will expose allowlisted operations with explicit user
confirmation, idempotency keys, durable audit records, and role/tenant checks.
That boundary is required before ChatGPT can operate all Ashbi features. The
connection and action requirements are defined in
[connected-workflow-contract.md](connected-workflow-contract.md).
