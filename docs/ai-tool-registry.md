# Governed AI tool registry, approval queue and receipts

Status: **slice 2 of #413** (governed BYOK AI control plane). Code-present,
not target-verified. Choices marked *Proposal* are defaults for the owner to
confirm or change before this is treated as policy.

Slice 1 ([ai-byok.md](ai-byok.md)) decides *whether* an AI call may happen
and on whose account. Slice 2 decides *what an AI caller may do*: which tools
exist, who may use them, which records they may touch, and that nothing
changes until a person approves it.

| Part | Code |
| --- | --- |
| Tool registry | `src/ai/tools/registry.js` |
| Execution engine | `src/ai/tools/executor.js` |
| Assistant tool session (model loop) | `src/ai/tools/session.js` |
| Assistant session, approval queue and receipts API | `src/routes/ai-tool.routes.js` (`/api/ai-tools`) |
| Web | Settings → **AI approvals** (`web/src/components/AiApprovals.jsx`): "Ask the assistant", the queue and receipts |
| Receipts table | `ai_bridge_actions` (Prisma `AiBridgeAction`), migration `20260926130000_ai_tool_receipts` |
| Adversarial evaluation | `src/tests/ai-eval/`, see [ai-evaluation.md](ai-evaluation.md) |

## Tool classes

| Class | Runs | Approval |
| --- | --- | --- |
| `read` | Directly; returns data | None |
| `draft` | Directly; produces text or a proposal without writing anything | None |
| `prepare` | Creates a pending action | A person approves before anything changes |
| `execute` | Creates a pending action; runs once on approval | Always (`requiresConfirmation` is forced to `true`) |

No `draft` or `prepare` tool is registered yet; the classes exist so they can
be added without changing the executor.

## Registry fields

Every tool is declared in code with `defineTool` and frozen. Registration
throws `ToolRegistrationError` when a rule below is broken, so a bad tool
stops the process at start-up instead of running.

| Field | Rule |
| --- | --- |
| `name`, `description` | Lower snake case name, unique; non-empty description |
| `class` | `read`, `draft`, `prepare` or `execute` |
| `roles` | Non-empty subset of `ADMIN`, `TEAM`. `CLIENT` and `BOT` principals can never use a tool |
| `inputSchema` | A Zod schema. Bridge tools use `.strict()` and a transform that yields exactly the object the AI bridge hashed before the registry existed, so idempotency keys keep matching |
| `resolveScope` | Given the tenant Prisma client, the user and the parsed input, proves every referenced record belongs to the caller's organization (and that the user may use it) and returns the ids as `inputScope`. Queries name `organizationId` explicitly as well as going through the tenant proxy. A foreign or missing record is `RECORD_NOT_FOUND` either way, so the answer is no existence oracle |
| `requiresConfirmation` | Always `true` for `prepare` and `execute` |
| `idempotency` | `required` for `prepare` and `execute` |
| `timeoutMs` | 1 ms to 60 s |
| `retry.maxAttempts` | Must be `1` for `prepare` and `execute`: approved actions are never retried |
| `external`, `irreversible` | See default deny |
| `rollback` | Required for `prepare`/`execute`: how to undo it, or what a failure leaves behind |
| `approval` | `approverRoles` and `requesterMayApprove` (when `false`, a different user must approve) |
| `run` / `preview` + `execution` | `run` for read/draft. For prepare/execute, `preview` builds what the approver sees, and `execution` is either `transaction` (claim, write and receipt in one database transaction) or `external` (claim and re-check the target in a transaction, then deliver with the timeout) |

### Registered tools

| Tool | Class | Roles | Flags | Notes |
| --- | --- | --- | --- | --- |
| `list_projects` | read | ADMIN, TEAM | | The organization's projects (id, name, status, health) |
| `list_my_tasks` | read | ADMIN, TEAM | | Open tasks assigned to the caller, in the caller's organization only |
| `get_project_summary` | read | ADMIN, TEAM | | One project, scope-checked, with its open task count |
| `get_ai_usage_summary` | read | ADMIN | | Month-to-date BYOK usage (no key material) |
| `create_task` | execute | ADMIN, TEAM | | AI bridge action |
| `create_calendar_event` | execute | ADMIN, TEAM | | AI bridge action; Ashbi calendar only, never synced |
| `send_slack_message` | execute | ADMIN, TEAM | **external**, **irreversible** | AI bridge action (post or thread reply). On the allowlist |

Staff may use every project of their organization (the same rule as project
rooms, `src/auth/project-room-access.js`); the resolvers enforce the
organization, and the executor enforces the role.

## Default deny

A tool flagged `external` (reaches a third party) or `irreversible` (cannot be
undone from Ashbi: sending email, publishing, billing, deletion, credential
access, third-party account changes) is rejected at registration unless its
name is on `EXTERNAL_TOOL_ALLOWLIST`.

*Proposal*: the allowlist holds only `send_slack_message`. It was already
confirm-gated by the AI bridge before this registry existed, it only posts to
a channel an admin explicitly mapped to the project, and a failed delivery is
kept for manual reconciliation, never retried
([slack-outbound-recovery-policy.md](slack-outbound-recovery-policy.md)). It
is marked `external` and `irreversible` (a posted message cannot be recalled
from Ashbi), and the web app asks for a second confirmation before approving
it. Adding any other external or irreversible tool is a
reviewed change to the allowlist, not to the tool.

## Approval flow

```
AI caller ──invoke──► validate input ─► role ─► kill switches ─► idempotency ─► scope ─┐
                                                                                       │
           read/draft: run, redact secrets, return output ◄────────────────────────────┤
           prepare/execute: pending action (ai.tool_prepared) ◄────────────────────────┘
                                   │
  person ──approve (step-up)──► approver allowed? ─► kill switches ─► not expired ─► claim ─► execute once
        └─reject (step-up)────► REJECTED (ai.tool_rejected)
```

1. **Invoke** (`executor.invoke`). In order: the tool must exist; the
   serialized input must be at most 16 KB (*Proposal*,
   `MAX_TOOL_INPUT_BYTES`); it must pass the Zod schema; the caller's role
   must be allowed; the deployment and organization kill switches must be off;
   prepare/execute tools need an idempotency key; the scope resolver must
   succeed. Any refusal throws and records `ai.tool_denied` with a reason
   code. Read/draft tools then run with their timeout and return output with
   secrets redacted. Prepare/execute tools create a pending row with the input
   hash, requester, tenant, input scope and correlation id (the request id),
   expiring after 10 minutes (*Proposal*, `APPROVAL_TTL_MS`).
2. **Approve** (`executor.approve`) — only a person:
   - through `POST /api/ai-tools/approvals/:id/approve` (session plus step-up
     re-authentication), or
   - through the AI bridge's `POST /api/ai-bridge/v1/actions/:actionId/confirm`
     (the API key's owner confirming their own action; evidence
     `method: api_key_confirm`). This is the bridge's existing public
     contract and is unchanged; an API key cannot re-authenticate. An
     action an **assistant** proposed (`source: assistant`) can never be
     approved this way (`403`): only in a step-up session.

   An ADMIN may approve any action in the organization. A TEAM member may
   approve only their own, and only when the tool has
   `requesterMayApprove: true` (all current tools; *Proposal*). A tool with
   `requesterMayApprove: false` needs a different ADMIN.

   **Every status change is conditional on the status it expects**: the claim
   is `PENDING_CONFIRMATION` → `EXECUTING` and also requires the action to be
   unexpired at that instant; completion and failure expect `EXECUTING` (or
   `PENDING_CONFIRMATION` when a transaction rolled the claim back); expiry is
   `PENDING_CONFIRMATION` → `EXPIRED` only. An approver who loses a race gets
   `409 ACTION_UNAVAILABLE`, never a 500 or a receipt that did not happen, so
   a double click or two approvers execute an action once. The integration
   test races two approvers against PostgreSQL in both execution modes.

   **Approvers see everything that will be written.** Previews carry every
   persisted, user-visible field in full (title, description, location,
   dates, message text). Lists truncate long text; the web page shows the full
   text in a "Show full details" disclosure, rendered as React text only.
3. **Reject** (`executor.reject`): the requester may withdraw their own
   action and an ADMIN may reject any, with a reason from a closed list
   (`not_needed`, `incorrect`, `unsafe`, `other`). Rejecting is allowed while
   AI is switched off: it only removes work.

There is no approval tool: a model cannot approve its own proposal.

### Idempotency, timeouts and failures

- Execution is idempotent by (tool, idempotency key, input hash), keyed per
  requester. The same key with the same input returns the stored action or
  receipt (`idempotent: true`); the same key with another tool or input is
  `409 IDEMPOTENCY_CONFLICT`. In an assistant session the key is always
  derived from the session id and the call's position (turn and index); a key
  the model supplies is ignored, so a model cannot replay a person's key to
  fetch a receipt or collide with their actions.
- Approved actions are never retried. A database action that fails (or
  exceeds its timeout: transaction-mode tools run under `timeoutMs` too) rolls
  back and ends `FAILED` with `outcome: failed`; the receipt still records the
  approver and `ai.tool_approved` precedes `ai.tool_failed`. An external delivery that throws
  or exceeds its timeout after it was attempted ends `FAILED` with
  `outcome: unknown` (and, for Slack, `result.deliveryState: UNKNOWN` with the
  target) so a person reconciles it; approving again answers `409`.
- A target that disappeared before delivery is `ACTION_TARGET_UNAVAILABLE`
  with `outcome: failed`.
- A process that dies between claim and completion leaves the row
  `EXECUTING`; treat that like `unknown`.

## Receipts

The `ai_bridge_actions` row is the receipt. Slice 2 extended the AI bridge's
existing action ledger rather than adding a table, because it already had the
tenant, requester, idempotency key, input hash, preview, status, result and
timestamps, and its prepare/confirm flow is the approval flow.

| Field | Meaning |
| --- | --- |
| `organizationId` | Tenant (direct tenant model in the Prisma tenant proxy) |
| `userId` | Requester (actor) |
| `action`, `toolClass`, `source` | Tool, its class, and `ai_bridge` or `assistant` |
| `input`, `inputHash`, `inputScope` | Normalized input, its hash, and the record ids the resolver proved |
| `preview` | What the approver saw |
| `status`, `outcome` | `PENDING_CONFIRMATION`, `EXECUTING`, `EXECUTED`, `FAILED`, `REJECTED`, `EXPIRED`; outcome `succeeded`, `failed` or `unknown` |
| `approverId`, `approvalEvidence` | Who decided, and `{ method, approverRole, requesterApproved, reauthenticated, approvedAt or rejectedAt, requestId, reason }`. `approverId` has no foreign key so the receipt outlives the account |
| `result`, `errorCode` | Result ids (secret-redacted) or the error code; never provider text |
| `correlationId` | The request id of the call that prepared it; audit events carry it too |
| `createdAt`, `expiresAt`, `confirmedAt`, `executedAt`, `rejectedAt` | Timestamps |

**Immutable once terminal.** A `BEFORE UPDATE` trigger
(`ai_bridge_actions_receipt_immutable`) rejects any update to a row whose
status is `EXECUTED`, `FAILED`, `REJECTED` or `EXPIRED`, for every database
role. CHECK constraints close the `status`, `outcome`, `source` and
`toolClass` vocabularies. Deletes follow the organization and user lifecycle
(`ON DELETE CASCADE`). **Until #310 decides retention, deleting an
organization or a user erases their receipts** (the `ai.tool_*` audit events,
which are append-only, remain).

**No secrets.** Outputs and receipt results pass through `redactSecrets`,
which drops fields named like passwords, tokens, keys, ciphertext or hashes
(and every field on the log redaction list, `src/utils/log-redaction.js`), and
masks credential-shaped values wherever they appear in free text: provider,
Stripe, Slack, GitHub, AWS, Google and Ashbi keys, Slack webhook URLs, JWTs,
PEM private keys, bcrypt hashes, Ashbi ciphertext, passwords in URLs, bearer
tokens and `password=`/`api_key=`/`token=` pairs. Execution failures log only the tool,
action id, error code, outcome and error name, never the error object or
message, because a provider error can echo a token back.

## API

Staff only (`ADMIN`, `TEAM`). An ADMIN sees the organization's actions; a
TEAM member sees only their own. Records of another organization are `404`.

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET /api/ai-tools/catalog` | staff | The registry, without code |
| `POST /api/ai-tools/sessions` | staff, 10/min per user | Run one assistant session (see [Assistant sessions](#assistant-sessions)) |
| `GET /api/ai-tools/approvals` | staff | Pending actions, newest first (`limit`) |
| `GET /api/ai-tools/approvals/:id` | staff | One action or receipt |
| `POST /api/ai-tools/approvals/:id/approve` | staff + step-up | Approve and execute once |
| `POST /api/ai-tools/approvals/:id/reject` | staff + step-up | `{ reason }` |
| `GET /api/ai-tools/receipts` | staff | Decided actions; filters `status`, `outcome`, `tool`, `source`, `requesterId`, `before` (ISO time, page with `nextBefore`), `limit` |

The web page (Settings → **AI approvals**) lists pending actions with Approve
and Reject (with a reason) and recent receipts with a status filter; an
unknown outcome is labelled "delivery unknown — check before redoing". The
step-up prompt is the shared ReauthDialog.

## Kill switches and budgets

- The deployment and organization kill switches
  ([ai-byok.md](ai-byok.md#kill-switches)) block `invoke` and `approve`:
  nothing runs and nothing executes while AI is off (`503 AI_DISABLED`,
  audited as `ai.tool_denied`). A kill-switch state that cannot be read fails
  closed. Pending actions stay pending and can still be rejected.
- Budgets meter model calls, not tool executions. In an assistant session
  every model turn is a governed, metered call, so when the BYOK budget is
  exhausted the next turn is refused before the provider is contacted and the
  session stops with `AI_BUDGET_EXCEEDED`; no further tool calls are made.
  *Proposal*: a person approving an already-prepared action is not blocked by
  the budget, since it spends no tokens.
- The slice-1 `beforeCall`/`afterCall` hooks are not used: tool calls are
  governed in the executor, where the tool, input and records are known,
  rather than at the model call.

## Assistant sessions

`runToolSession` (`src/ai/tools/session.js`) runs a model that answers with
`{"tool_calls":[{"name","arguments"}]}` or
`{"final": "..."}`. It advertises only the tools the caller's role may use,
feeds tool results back marked as data rather than instructions, and bounds
the loop (*Proposals*: 6 turns, 4 tool calls per turn, 32,000-character
replies).

### `POST /api/ai-tools/sessions`

The HTTP route that drives one session for the signed-in staff member
(`ADMIN` or `TEAM`; a `CLIENT` session is refused by the tenant guard with
`CLIENT_SESSION_FORBIDDEN` and by the route with `403`). It is tenant-scoped
like every `/api/ai-tools` route and needs no step-up: a session only reads
and proposes, and approving what it proposed still needs step-up in the
queue.

- **Body**: `{ "prompt": string }`, trimmed, 1 to 4,000 characters
  (*Proposal*, `AI_TOOL_SESSION_PROMPT_MAX`); any other field is `400`. The
  server generates the session id (a UUID); a client cannot choose it, so it
  cannot steer the idempotency keys derived from it.
- **Rate limit**: 10 sessions per user per minute (*Proposal*,
  `AI_SESSION_RATE_LIMIT`), on top of the per-IP API limit; over it is `429`
  with `code: AI_SESSION_RATE_LIMITED` and `Retry-After`. A session is at most
  6 metered model calls, so one person can cause at most 60 a minute, and the
  BYOK budget still applies.
- **Governance**: before anything runs, the kill switches and connection
  state are checked and a refusal answers with the usual AI error
  (`503 AI_DISABLED`, `503 AI_CONNECTION_DISABLED`,
  `503 AI_CONNECTION_UNAVAILABLE`). Each model turn then goes through the same
  governed call as every other AI feature (`aiGovernance.chat`, feature
  `ai_tools`) with the request context pinned to the caller's organization:
  platform or BYOK routing, budget check, one `AiUsageRecord` per BYOK turn.
  A switch flipped, a budget spent or a provider failure mid-session ends it
  with `200` and a `stoppedReason` (`AI_DISABLED`, `AI_BUDGET_EXCEEDED`,
  `AI_CONNECTION_*`, `AI_PROVIDER_*`, or `MAX_TURNS`), keeping the steps
  already taken. A platform provider error is reported as
  `AI_PROVIDER_UPSTREAM`; its message is never logged or returned.
- **Response**:

  ```json
  {
    "sessionId": "uuid",
    "turns": 2,
    "final": "text or null",
    "stoppedReason": null,
    "steps": [
      { "turn": 1, "tool": "list_projects", "status": "ok", "reason": null, "actionId": null, "output": [] },
      { "turn": 1, "tool": "create_task", "status": "pending_approval", "reason": null, "actionId": "cuid", "output": null },
      { "turn": 1, "tool": "get_project_summary", "status": "denied", "reason": "RECORD_NOT_FOUND", "actionId": null, "output": null }
    ]
  }
  ```

  `output` is only present for read/draft tools and is the executor's
  tenant-scoped, secret-redacted result; `final` passes through
  `redactSecrets` too. The model's raw arguments are never returned.
- **Audit and logs**: one `ai.tool_session_run` event per session that ran,
  with the session id and counts only (turns, tool calls, reads, pending,
  denied, `stoppedReason`, whether it answered) — never the prompt, the
  answer or tool output. The prompt is not stored or logged; tool calls are
  audited by the executor as before (`ai.tool_prepared`, `ai.tool_denied`).

The web page (Settings → **AI approvals** → "Ask the assistant") posts the
prompt, renders the answer as React text (never HTML), lists the steps, links
pending actions to the queue on the same page and refreshes it, and explains
a `stoppedReason` in plain language.

## Adding a tool (a reviewed change)

1. Add a `defineTool` spec to `BUILTIN_TOOLS` in `src/ai/tools/registry.js`:
   a strict Zod schema, the narrowest roles, a scope resolver that names
   `organizationId` for every referenced record, and for prepare/execute a
   preview, an execution mode and a rollback note.
2. If it is external or irreversible, justify it in review and add it to
   `EXTERNAL_TOOL_ALLOWLIST` and to the table above.
3. Add tests: a unit test for its schema and scope, and the tool to the
   relevant scenarios in `src/tests/ai-eval` (cross-tenant, permission,
   secrets). `npm test` runs them.
4. Update this document.

## Audit events

`ai.tool_prepared`, `ai.tool_approved`, `ai.tool_rejected`,
`ai.tool_executed`, `ai.tool_failed`, `ai.tool_expired`, `ai.tool_denied`,
`ai.tool_session_run`; fields in [audit-events.md](audit-events.md).

## Proposals for owner approval

| Setting | Proposed value | Where |
| --- | --- | --- |
| External/irreversible allowlist | `send_slack_message` only | `EXTERNAL_TOOL_ALLOWLIST` |
| Approval window | 10 minutes | `APPROVAL_TTL_MS` |
| Requester may approve their own action | Yes for every current tool (the bridge contract); per-tool `requesterMayApprove` | `approval` in each tool |
| Who may approve others' actions | ADMIN only | `executor.approve` |
| Step-up for approve and reject in the queue | Required | `src/routes/ai-tool.routes.js` |
| Largest tool input | 16 KB serialized | `MAX_TOOL_INPUT_BYTES` |
| Session limits | 6 turns, 4 tool calls per turn, 32,000-character replies | `src/ai/tools/session.js` |
| Session route | 4,000-character prompt; 10 sessions per user per minute; no step-up to ask (approving still needs it) | `AI_TOOL_SESSION_PROMPT_MAX`, `AI_SESSION_RATE_LIMIT` |
| Budget does not block approving a prepared action | Tokens are not spent by execution | `executor.approve` |
| Rejection reasons | `not_needed`, `incorrect`, `unsafe`, `other` | `REJECTION_REASONS` |
