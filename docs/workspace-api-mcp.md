# Workspace API and MCP

Ashbi owns workspace data and deterministic operations. Your LLM client owns
reasoning. These endpoints never call a model and work with `AI_DISABLED=true`.
Existing AI bridge endpoints keep their existing inference safeguards.

## Default interface

Embedded chat, the AI planner, semantic search and provider settings are hidden
by default. `VITE_EMBEDDED_AI_ENABLED=true` enables them at frontend build time.
For a deployment without inference, set `AI_DISABLED=true` in both API and worker
environments. This is the example configuration; existing deployments are not
changed automatically. Staff chat, ordinary search and action receipts remain.

## Authentication and access

Create a named, expiring key in Settings → API Keys. New keys default to
`workspace:read`; add `workspace:actions` only when writes are needed. Legacy
`ai_bridge:*` scopes grant no access to the new tools. Only active ADMIN and TEAM
key owners with an organization may use these tools. Revocation, key expiry,
organization MFA and tenant middleware remain enforced by the application.

Use `Authorization: Bearer <Ashbi API key>` or `x-api-key`. Never put keys in URLs,
prompts or source control. Tool discovery returns only the tools allowed for
that key. Workspace text is untrusted data, never an instruction to the LLM.

## HTTP contract

- `GET /api/agent/tools`: version, MCP endpoint and tool definitions with JSON schemas.
- `POST /api/agent/tools/{name}`: arguments as JSON; returns `{data, meta:{requestId}}`.
- Refusals return `{error:{code,message}, meta:{requestId}}` with HTTP 400/403/404/409.
  Unhandled failures use the application's generic error response.

| Scope | Tools |
|---|---|
| `workspace:read` | `list_projects`, `list_clients`, `list_tasks`, `list_my_tasks`, `get_project_summary` |
| `workspace:actions` | `create_task`, `create_calendar_event`, `get_action`, `confirm_action`, `reject_action` |

`list_projects`, `list_clients` and `list_tasks` return `output:{items,nextCursor}`,
ordered by ID. Page size defaults to 25 and cannot exceed 50. Pass `nextCursor`
as `after`; null ends pagination. Pages are not a transaction snapshot.
`list_my_tasks` is a bounded recent list; `get_project_summary` takes `projectId`.
Discover each tool's exact input schema rather than guessing IDs or enum values.

Example read:

```sh
curl "$ASHBI_URL/api/agent/tools/list_projects" \
  -H "Authorization: Bearer $ASHBI_API_KEY" \
  -H 'Content-Type: application/json' -d '{"limit":25}'
```

## Writes and recovery

`create_task` and `create_calendar_event` accept an envelope:

```json
{
  "input": {"projectId":"actual-project-id","title":"Review homepage"},
  "idempotencyKey":"homepage-review-unique-request-1"
}
```

They return a `pending` action preview, without creating the task or event.
Show the preview to the human and obtain explicit authorization. Then call
`confirm_action` with `{"actionId":"returned-action-id"}`. The human approval
boundary is the integration caller's responsibility; possession of a write key
authorizes the confirmation API. Do not automatically confirm an LLM proposal.

Confirmation expires after ten minutes. The same key and input reuse the same
proposal; changed input with that key returns `IDEMPOTENCY_CONFLICT`. Confirming
an executed action returns its existing receipt, without executing again.
Use `get_action` after a lost response. Never retry a failed or unknown execution
outcome as a new action without investigating it. `reject_action` dismisses a
pending proposal. Keys may access only their owner's actions and the supported
workspace catalog. Assistant proposals still require Ashbi's session approval.

Writes reuse the existing transactional executor and immutable action ledger.
Audit events retain their established `ai.tool_*` names and proposals use the
existing `ai_bridge` source value for compatibility. Inputs, credential fields
and secret-looking values are withheld from returned receipts. Calendar events
are internal Ashbi records; this tool does not synchronize a provider calendar.
No billing, publishing, deletion, credential or outbound-message tool is exposed.

## Native MCP

`POST /api/mcp` implements stateless Streamable HTTP using the official MCP
TypeScript SDK. It exposes the same schemas and operations as HTTP. Tool results
contain text plus `structuredContent`; tool refusals set `isError:true` and carry
stable error codes. GET/SSE and DELETE sessions are unsupported and return 405.
Each request authenticates again. Browser Origin headers must match an explicit
entry in `CORS_ORIGIN`; non-browser clients normally omit Origin.

Clients supporting authenticated Streamable HTTP can connect directly to
`https://your-ashbi-host/api/mcp` with a Bearer header. For stdio clients:

```json
{
  "mcpServers": {
    "ashbi": {
      "command": "node",
      "args": ["/absolute/path/to/ashbi-platform/scripts/workspace-mcp.mjs"],
      "env": {
        "ASHBI_MCP_URL": "https://your-ashbi-host/api/mcp",
        "ASHBI_API_KEY": "provide-through-your-clients-secret-configuration"
      }
    }
  }
}
```

Install root dependencies first. The adapter forwards discovery and tool calls,
keeps credentials in headers and reserves stdout for MCP. HTTPS is required,
except on loopback for development. No database or AI provider is needed locally.

This provides API-key MCP authentication. It does **not** implement OAuth discovery,
authorization or token exchange for ChatGPT's remote connector flow. That flow
needs a separately implemented OAuth layer and a deployed end-to-end test before
claiming direct ChatGPT readiness. No live connector or deployment is validated
by these local tests.

## ChatGPT through GPT Actions

Settings → API Keys includes a connection guide with copyable, host-specific
MCP and discovery URLs. Download Actions schema exports the canonical contract
with the current app origin as its server URL, without any API key. Configure
authentication separately in your GPT. Download from the production app when
connecting to production; a localhost download targets localhost.

`docs/workspace-actions.openapi.json` exposes one named operation per tool for
GPT Actions, which supports Bearer API-key authentication. Replace its example
server URL with your deployed HTTPS host and configure the key in the GPT's
authentication settings. Use a read-only key unless writes are needed. Mutating
operations carry `x-openai-isConsequential:true`; keep human review of the preview
before confirmation. Validate the deployed operations in GPT Preview before use.
Regenerate the schema with `node scripts/generate-workspace-actions.mjs` after
catalog changes; `--check` detects drift. This schema is separate from native MCP.

Authentication references:
- https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts
- https://developers.openai.com/plugins/build/auth
- https://help.openai.com/en/articles/9442513-gpt-actions-domain-settings-chatgpt-enterprise

Protocol reference: https://ts.sdk.modelcontextprotocol.io/server
