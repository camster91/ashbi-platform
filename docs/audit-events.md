# Audit event log

Ashbi Hub keeps an append-only, per-organization record of sensitive revenue,
authentication and administrative actions. It is the evidence trail asked for
in #412 ("audit history must be append-only for privileged and automated
actions; mutable presentation records are not sufficient evidence").

- Table: `audit_events` (Prisma model `AuditEvent`), added by migration
  `20260925130500_audit_events`.
- Writer: `recordAuditEvent` / `recordRequestAuditEvent` in
  `src/services/audit-event.service.js`.
- Reader: `GET /api/audit-events` (admin only), shown in the web app under
  **Settings → Activity log**.

Related #412 references, all generated and checked for drift:

- [data-dictionary.md](data-dictionary.md): every model, its table, tenant
  scoping, soft-delete support and fields, generated from `prisma/schema.prisma`.
- [api-access-matrix.md](api-access-matrix.md): every API route and the auth
  guard it runs, with the reason each public route is public.
- [openapi.json](openapi.json): the OpenAPI 3.1 contract generated from the
  routes and their Zod validators; see [api-contract.md](api-contract.md).

## Guarantees

| Guarantee | How it is enforced |
| --- | --- |
| Append-only | A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise `audit events are append-only`. The request-scoped Prisma proxy also rejects `update`, `updateMany`, `upsert`, `delete` and `deleteMany` on the model, and the HTTP API has no write route. |
| Tenant-scoped | `organizationId` is required and indexed. The model is a *direct* tenant model in `src/utils/prisma-tenant-proxy.js`, so request-scoped reads are filtered to the caller's organization and request-scoped writes overwrite any forged `organizationId`. |
| History outlives its subjects | `actorUserId` and `entityId` have no foreign keys, so deleting a user or record does not remove or rewrite its history. The organization FK is `ON DELETE RESTRICT`: an organization with audit history cannot be hard-deleted until the retention policy decides how (see #310). |
| Never breaks the business action | `recordAuditEvent` never throws. On failure it logs `Audit event write failed` with the action name and error code (never the metadata) and returns `null`. The invoice still sends and the password still changes. Alert on that log line. |
| Closed vocabulary | Unknown actions and actor types are dropped and logged; metadata fields outside the action's allowlist are dropped; the database also checks `actorType` and the `action` format. |
| One event per transition | Public approvals and signatures use a compare-and-set `updateMany` on the current status and emit only when exactly one row changed, so a double click or replayed link yields one event (and one automation run). |

A PostgreSQL superuser can still bypass triggers (for example with
`session_replication_role = replica`). Production application roles must not
be superusers; the integration test uses this only to clean up disposable
rows.

## Event fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | cuid | Primary key. |
| `organizationId` | string | Owning tenant. Taken from the signed-in principal, or, on public and webhook routes, from the owning client or invoice. |
| `actorUserId` | string or null | The acting user. `null` for public capability links (proposal approval, contract signing), Stripe webhooks, and failed sign-ins (the caller is not authenticated). |
| `actorType` | enum | `USER`, `CLIENT`, `SYSTEM`, `WEBHOOK`, `BOT`. |
| `action` | string | One of the catalog actions below (`domain.verb`, lower snake case). |
| `entityType` | string | Fixed per action (see catalog). |
| `entityId` | string or null | The id of the affected record. |
| `requestId` | string or null | The Fastify request id. The same value is the `traceId` in request logs and error bodies, so an event can be joined to its request. |
| `ip` | string or null | Network prefix only: IPv4 `/24` (`203.0.113.0/24`), IPv6 `/48`. The full address is never stored. Webhook events store no address. |
| `metadata` | JSON object | Flat ids, enums, amounts and flags only (see rules below). |
| `createdAt` | timestamp | Server time of the write. |

### Metadata rules

Metadata is an **allowlist per action**: `AUDIT_EVENT_CATALOG` in
`src/services/audit-event.service.js` lists the only fields each action may
carry (the Metadata column below). `sanitizeAuditMetadata(metadata, action)`
drops every other field, whatever its name. Allowed values are:

- finite numbers, booleans and `null`;
- dates, stored as ISO-8601 strings;
- strings of at most 128 characters matching `^[A-Za-z0-9_.:/@+-]*$` (ids,
  enums, currency codes, hashes, model names). Strings with spaces or other
  characters, and longer strings, are dropped rather than truncated, so free
  text cannot be stored under an allowed field name.

Nested objects and arrays are dropped. Metadata therefore never holds payment
notes, signer names, email addresses, API key material or password hashes.

## Event catalog

| Action | Entity type | Actor | Emitted by | Metadata |
| --- | --- | --- | --- | --- |
| `invoice.sent` | `invoice` | USER | `POST /api/invoices/:id/send`, `POST /api/invoices/bulk/send` | `fromStatus`, `toStatus`, `deliveryAccepted`, `paymentLinkAttached`, `total`, `currency`, `bulk` (bulk only) |
| `invoice.paid` | `invoice` | USER or WEBHOOK | `POST /api/invoices/:id/mark-paid`, `POST /api/invoices/bulk/mark-paid`, Stripe `checkout.session.completed` (`/api/webhooks/stripe`, `/api/invoices/stripe-webhook`) | `fromStatus`, `toStatus`, `method`, `bulk`, `total`, `currency`; Stripe: `stripeEventId` |
| `payment.recorded` | `invoice_payment` | USER or WEBHOOK | Same paths as `invoice.paid`; `entityId` is the `InvoicePayment` id | `invoiceId`, `amount`, `method`, `source` (`manual` or `stripe_checkout`), `bulk`, `currency`, `stripeEventId` |
| `proposal.approved` | `proposal` | CLIENT | `POST /api/portal/proposal/:viewToken/approve` (the SPA portal, `via: portal_link`) and `POST /api/proposals/client/:viewToken/approve` (`via: public_link`) | `fromStatus`, `toStatus`, `total`, `via` |
| `contract.signed` | `contract` | CLIENT | `POST /api/portal/contract/:signToken/sign` (the SPA portal, `via: portal_link`) and `POST /api/contracts/sign/:signToken` (`via: public_link`) | `fromStatus`, `toStatus`, `signingMethod` (`type` or `draw`), `documentHash` (SHA-256 of the signed content), `via` |
| `user.role_changed` | `user` | USER (admin) | `PUT /api/team/:id` when the role actually changes | `fromRole`, `toRole` |
| `user.deactivated` | `user` | USER (admin) | `PUT /api/team/:id` when `isActive` goes true → false | `fromActive`, `toActive` |
| `user.reactivated` | `user` | USER (admin) | `PUT /api/team/:id` when `isActive` goes false → true | `fromActive`, `toActive` |
| `auth.login_failed` | `user` | USER or CLIENT | `POST /api/auth/login` (any failure) and `POST /api/auth/client/login` (wrong password) for an **existing** account; unknown emails have no tenant and are not logged | `portal` (`staff` or `client`), `accountActive` |
| `auth.password_changed` | `user` | USER | `POST /api/auth/change-password`, `POST /api/auth/reset-password`, `POST /api/team/:id/reset-password` | `method` (`self_service`, `reset_link`, `admin_reset`), `sessionsRevoked`, `apiKeysRevoked` (admin reset) |
| `auth.mfa_enabled` | `user` | USER | `POST /api/auth/mfa/confirm` | `recoveryCodesIssued` |
| `auth.mfa_disabled` | `user` | USER | `POST /api/auth/mfa/disable` | `method` (`totp` or `recovery_code`) |
| `auth.mfa_reset` | `user` | USER (the acting admin) | `POST /api/auth/mfa/admin/users/:userId/reset` | `wasEnabled` |
| `auth.mfa_recovery_code_used` | `user` | USER | `POST /api/auth/login/mfa` signed in, or `POST /api/auth/reauth` re-authenticated, with a recovery code | `remaining` |
| `auth.mfa_failed` | `user` | USER | `POST /api/auth/login/mfa` rejected a code (bounded by the per-account attempt budget: at most 5 per lockout window) | `reason` (`invalid`, `replayed`, `locked`) |
| `auth.reauthenticated` | `user` | USER | `POST /api/auth/reauth` succeeded (step-up re-authentication for a privileged action, see [privileged-actions.md](privileged-actions.md)) | `method` (`password`, `totp` or `recovery_code`) |
| `auth.reauth_failed` | `user` | USER | `POST /api/auth/reauth` rejected the password or code. Throttled like `auth.login_failed`: at most one per account per 60 seconds (`REAUTH_FAILURE_AUDIT_WINDOW_MS` in `src/auth/reauth.js`) | `reason` (`invalid_password`, `invalid`, `replayed`, `locked`) |
| `api_key.created` | `api_key` | USER | `POST /api/api-keys` | `ownerUserId`, `expires`, `expiresAt`, `scopes` (granted scopes sorted and joined with `+`, e.g. `ai_bridge:actions+ai_bridge:read`; never the key) |
| `api_key.revoked` | `api_key` | USER | `DELETE /api/api-keys/:id` | `ownerUserId` |
| `settings.ai_provider_changed` | `settings` | USER (platform operator) | `POST /api/settings/ai-provider`; `entityId` is `ai_provider`. The provider is deployment-wide; the event is filed under the operator's organization | `fromProvider`, `toProvider`, `fromModel`, `toModel` |
| `client_portal.document_deleted` | `attachment` | CLIENT | `DELETE /api/client-portal/documents/:docId` | `projectId`, `clientId`, `mimeType`, `size` |
| `ai.connection_connected` | `ai_provider_connection` | USER (admin) | `POST /api/ai-connections/connect` after the provider accepted the key (see [ai-byok.md](ai-byok.md)) | `keyLast4`, `baseUrlHost` (host only, never the full URL or key), `defaultModel`, `allowedModelCount`, `monthlyBudgetCents`, `replacedStatus` (the previous connection's status, or `null`) |
| `ai.connection_validated` | `ai_provider_connection` | USER (admin) | `POST /api/ai-connections/validate` | `keyLast4`, `baseUrlHost`, `result` (`ok` or `failed`), `errorType` (`auth`, `quota`, `rate_limit`, `timeout`, `invalid_request`, `upstream`, `invalid_response`, `unsafe_url`), `fromStatus`, `toStatus` |
| `ai.connection_rotated` | `ai_provider_connection` | USER (admin) | `POST /api/ai-connections/rotate` after the new key was validated | `keyLast4`, `previousKeyLast4`, `baseUrlHost` |
| `ai.connection_revoked` | `ai_provider_connection` | USER (admin) | `POST /api/ai-connections/revoke` (the ciphertext is wiped) | `keyLast4`, `baseUrlHost`, `fromStatus` |
| `ai.connection_settings_changed` | `ai_provider_connection` | USER (admin) | `PATCH /api/ai-connections/settings` | `fromDefaultModel`, `toDefaultModel`, `fromMonthlyBudgetCents`, `toMonthlyBudgetCents`, `allowedModelCount` |
| `ai.disabled` | `organization` (`settings` for the platform switch) | USER (admin, or platform operator) | `POST /api/ai-connections/disable` (`entityId` is the organization id); `POST /api/settings/ai-kill-switch` with `disabled: true` (`entityId` is `ai_platform`, filed under the operator's organization) | `scope` (`organization` or `platform`) |
| `ai.enabled` | `organization` (`settings` for the platform switch) | USER (admin, or platform operator) | `POST /api/ai-connections/enable`; `POST /api/settings/ai-kill-switch` with `disabled: false` | `scope` |
| `ai.budget_alert` | `ai_provider_connection` | SYSTEM | The first BYOK call in a UTC month after which month-to-date estimated spend is at or above 80% of `monthlyBudgetCents`. Once per organization per month (checked in process and against `audit_events`) | `month` (`YYYY-MM`), `spentCents` (rounded), `budgetCents`, `thresholdPercent` |
| `ai.budget_exceeded` | `ai_provider_connection` | SYSTEM | A BYOK call was refused because month-to-date estimated spend reached the budget. At most one per organization per hour per API instance (`AI_BUDGET_EXCEEDED_AUDIT_WINDOW_MS` in `src/ai/governance.js`) | `month`, `spentCents`, `budgetCents` |
| `ai.tool_prepared` | `ai_action` | USER | A prepare/execute AI tool call became a pending action: `POST /api/ai-bridge/v1/actions/prepare`, or a tool call proposed by an assistant session (see [ai-tool-registry.md](ai-tool-registry.md)); `entityId` is the `AiBridgeAction` id | `tool`, `toolClass`, `source` (`ai_bridge` or `assistant`), `inputHash`, `correlationId` (the request id) |
| `ai.tool_approved` | `ai_action` | USER (the approver) | `POST /api/ai-tools/approvals/:id/approve` (`method: session_step_up`) or `POST /api/ai-bridge/v1/actions/:actionId/confirm` (`method: api_key_confirm`), once the action was claimed for execution | `tool`, `toolClass`, `source`, `requesterUserId`, `correlationId`, `method`, `reauthenticated`, `requesterApproved` |
| `ai.tool_rejected` | `ai_action` | USER | `POST /api/ai-tools/approvals/:id/reject` | `tool`, `toolClass`, `source`, `requesterUserId`, `correlationId`, `reason` (`not_needed`, `incorrect`, `unsafe`, `other`) |
| `ai.tool_executed` | `ai_action` | USER (the approver) | An approved action completed; the receipt holds the result | `tool`, `toolClass`, `source`, `requesterUserId`, `correlationId`, `outcome` (`succeeded`), `approverUserId` |
| `ai.tool_failed` | `ai_action` | USER (the approver) | An approved action failed. Never retried | `tool`, `toolClass`, `source`, `requesterUserId`, `correlationId`, `errorCode` (`ACTION_TARGET_UNAVAILABLE`, `ACTION_EXECUTION_FAILED`, `ACTION_TIMEOUT`), `outcome` (`failed`, or `unknown` when an external delivery was attempted) |
| `ai.tool_expired` | `ai_action` | USER | An approval was attempted after the action's approval window (10 minutes, *Proposal*) | `tool`, `toolClass`, `source`, `requesterUserId`, `correlationId` |
| `ai.tool_denied` | `ai_action` | USER | The executor refused a tool call or an approval. `entityId` is the action id when there is one | `tool`, `reason` (`TOOL_UNKNOWN`, `INPUT_TOO_LARGE`, `INVALID_INPUT`, `MALFORMED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`, `ROLE_DENIED`, `AI_DISABLED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `RECORD_NOT_FOUND`, `TARGET_UNAVAILABLE`, `APPROVER_NOT_ALLOWED`), `source`, `correlationId` |
| `ai.tool_session_run` | `ai_session` | USER | `POST /api/ai-tools/sessions` ran an assistant tool session (see [ai-tool-registry.md](ai-tool-registry.md#assistant-sessions)); `entityId` is the server-generated session id. Ids and counts only: never the prompt, the answer or tool output. Not written when the kill switch refuses the request before the session starts | `turns`, `toolCalls`, `readCount`, `pendingCount`, `deniedCount`, `stoppedReason` (`null`, `MAX_TURNS`, `TIMEOUT`, `CLIENT_CLOSED`, `ERROR` (an unexpected failure; counts are those reached so far), `AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_CONNECTION_DISABLED`, `AI_CONNECTION_UNAVAILABLE` or an `AI_PROVIDER_*` code), `answered`, `correlationId` (the request id) |
| `migration_import.applied` | `import_run` | SYSTEM | `scripts/import-slack-export.mjs --apply` after the import transaction commits; `entityId` is the `ImportRun` id (see [slack-export-migration.md](slack-export-migration.md)) | `source` (`SLACK_EXPORT`), `created`, `unchanged`, `alreadyPresent`, `channels` |
| `migration_import.rolled_back` | `import_run` | SYSTEM | `scripts/import-slack-export.mjs --rollback <runId>` | `source`, `deletedMessages`, `deletedRecords` |
| `review.session_created` | `review_session` | USER | `POST /api/reviews` (see [media-review.md](media-review.md)); `entityId` is the `ReviewSession` id | `projectId`, `attachmentId`, `version`, `previousSessionId` (the version it replaces, or `null`), `mediaKind` (`image`, `pdf`, `video`, `audio`) |
| `review.decision_recorded` | `review_session` | USER or CLIENT | `POST /api/reviews/:id/decisions` (`via: staff`) and `POST /api/portal/review/:token/decisions` (a client through a share link created with `allowDecision`, `via: share_link`, `actorUserId` null). The guest's name, email and note stay on the append-only `ReviewDecision` row, never in the event | `decisionId`, `decision` (`approved` or `changes_requested`), `fromStatus`, `toStatus`, `via`, `shareLinkId` |
| `review.share_link_created` | `review_share_link` | USER | `POST /api/reviews/:id/share-links` (step-up re-authentication); never the token or its hash | `sessionId`, `expiresAt`, `expiresInDays`, `allowDecision` |
| `review.share_link_revoked` | `review_share_link` | USER | `POST /api/reviews/:id/share-links/:linkId/revoke` (only the first revocation of a link) | `sessionId`, `wasExpired` |

`auth.login_failed` details:

- The account lookup is case-insensitive on email and is skipped when the
  email matches more than one account.
- It is written without being awaited so a known email is not measurably
  slower to reject than an unknown one.
- Volume is bounded to **one event per account per 60 seconds**
  (`LOGIN_FAILURE_AUDIT_WINDOW_MS` in `src/routes/auth.routes.js`): an
  in-process map suppresses repeats without a query, and a check for a recent
  event in `audit_events` covers other API instances. The per-IP auth rate
  limit bounds attempts; this bounds rows.

### Example

```json
{
  "id": "cm1q2w3e4r5t6y7u8i9o0p1a",
  "organizationId": "cm0orgexample000000000000",
  "actorUserId": null,
  "actorType": "WEBHOOK",
  "action": "payment.recorded",
  "entityType": "invoice_payment",
  "entityId": "cm1payexample00000000000",
  "requestId": "req-4f",
  "ip": null,
  "metadata": {
    "invoiceId": "cm1invexample00000000000",
    "amount": 1130,
    "method": "STRIPE",
    "source": "stripe_checkout",
    "stripeEventId": "evt_1Q...",
    "currency": "cad"
  },
  "createdAt": "2026-09-25T14:03:11.412Z"
}
```

## Reading the log

`GET /api/audit-events` requires an `ADMIN` session. `CLIENT`, `TEAM`/`STAFF`
and `BOT` principals get `403`.

| Query parameter | Meaning |
| --- | --- |
| `entityType`, `entityId` | Filter to one entity type and/or id. |
| `action` | One catalog action. |
| `actorUserId`, `actorType` | Filter by actor. |
| `from`, `to` | ISO timestamps, inclusive. `from` must not be after `to`. |
| `limit` | Default 50, clamped to 1–100. |
| `cursor` | The previous page's `nextCursor`. |

Results are ordered newest first by `(createdAt, id)` and paged with an opaque
keyset cursor, so events added while paging never shift or repeat a page.
Unknown parameters, catalog values or malformed cursors return `400`.
The response is `{ events, nextCursor, limit }`; each event also carries
`actorName` when the actor is a user in the same organization.
`GET /api/audit-events/catalog` returns the action, entity-type and actor-type
vocabulary for filters.

## Adding an event

1. Add the action, its entity type and its metadata allowlist to
   `AUDIT_EVENT_CATALOG` in `src/services/audit-event.service.js`.
2. Emit it after the business write succeeds, with
   `recordRequestAuditEvent(prisma, request, { action, entityId, metadata })`.
   On public or webhook routes, pass `actorType` and `ownerClientId` or
   `ownerInvoiceId` so the tenant is resolved from the record.
3. Add a row to the catalog above and an emission test in
   `src/tests/unit/audit-event-emission.test.js`. The service test fails if a
   catalog action is missing from this document.

## Retention

Audit events are kept indefinitely for now. Retention, archival, export and
legal-hold rules for audit history are decided in #310; until then nothing
deletes audit rows, and organization hard-deletes are blocked by the foreign
key. When #310 lands, retention must work by archiving or by a reviewed,
superuser-run migration, never by relaxing the append-only triggers for the
application role.
