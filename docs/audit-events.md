# Audit event log

Ashbi Hub keeps an append-only, per-organization record of sensitive revenue,
authentication and administrative actions. It is the evidence trail asked for
in #412 ("audit history must be append-only for privileged and automated
actions; mutable presentation records are not sufficient evidence").

- Table: `audit_events` (Prisma model `AuditEvent`), added by migration
  `20260925130000_audit_events`.
- Writer: `recordAuditEvent` / `recordRequestAuditEvent` in
  `src/services/audit-event.service.js`.
- Reader: `GET /api/audit-events` (admin only), shown in the web app under
  **Settings → Activity log**.

## Guarantees

| Guarantee | How it is enforced |
| --- | --- |
| Append-only | A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise `audit events are append-only`. The request-scoped Prisma proxy also rejects `update`, `updateMany`, `upsert`, `delete` and `deleteMany` on the model, and the HTTP API has no write route. |
| Tenant-scoped | `organizationId` is required and indexed. The model is a *direct* tenant model in `src/utils/prisma-tenant-proxy.js`, so request-scoped reads are filtered to the caller's organization and request-scoped writes overwrite any forged `organizationId`. |
| History outlives its subjects | `actorUserId` and `entityId` have no foreign keys, so deleting a user or record does not remove or rewrite its history. The organization FK is `ON DELETE RESTRICT`: an organization with audit history cannot be hard-deleted until the retention policy decides how (see #310). |
| Never breaks the business action | `recordAuditEvent` never throws. On failure it logs `Audit event write failed` with the action name and error code (never the metadata) and returns `null`. The invoice still sends and the password still changes. Alert on that log line. |
| Closed vocabulary | Unknown actions and actor types are dropped and logged; the database also checks `actorType` and the `action` format. |

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

`sanitizeAuditMetadata` keeps at most 20 keys, each a primitive (string of at
most 200 characters, finite number, boolean, null, or date). It drops nested
objects, arrays, and any key that looks like a credential or personal data
(for example keys containing `password`, `secret`, `token`, `key`, `session`,
`signature`, `email`, `phone`, `address`, `name`, `content` or `body`).
Metadata never holds free text such as payment notes, signer names, email
addresses, API key material or password hashes.

## Event catalog

| Action | Entity type | Actor | Emitted by | Metadata |
| --- | --- | --- | --- | --- |
| `invoice.sent` | `invoice` | USER | `POST /api/invoices/:id/send`, `POST /api/invoices/bulk/send` | `fromStatus`, `toStatus`, `deliveryAccepted`, `paymentLinkAttached`, `total`, `currency`, `bulk` (bulk only) |
| `invoice.paid` | `invoice` | USER or WEBHOOK | `POST /api/invoices/:id/mark-paid`, `POST /api/invoices/bulk/mark-paid`, Stripe `checkout.session.completed` (`/api/webhooks/stripe`, `/api/invoices/stripe-webhook`) | `fromStatus`, `toStatus`, `method`, `bulk`, `total`, `currency`; Stripe: `stripeEventId` |
| `payment.recorded` | `invoice_payment` | USER or WEBHOOK | Same paths as `invoice.paid`; `entityId` is the `InvoicePayment` id | `invoiceId`, `amount`, `method`, `source` (`manual` or `stripe_checkout`), `bulk`, `currency`, `stripeEventId` |
| `proposal.approved` | `proposal` | CLIENT | `POST /api/proposals/client/:viewToken/approve` | `fromStatus`, `toStatus`, `total`, `via: public_link` |
| `contract.signed` | `contract` | CLIENT | `POST /api/contracts/sign/:signToken` | `fromStatus`, `toStatus`, `signingMethod` (`type` or `draw`), `documentHash` (SHA-256 of the signed content), `via: public_link` |
| `user.role_changed` | `user` | USER (admin) | `PUT /api/team/:id` when the role actually changes | `fromRole`, `toRole` |
| `user.deactivated` | `user` | USER (admin) | `PUT /api/team/:id` when `isActive` goes true → false | `fromActive`, `toActive` |
| `user.reactivated` | `user` | USER (admin) | `PUT /api/team/:id` when `isActive` goes false → true | `fromActive`, `toActive` |
| `auth.login_failed` | `user` | USER or CLIENT | `POST /api/auth/login` (any failure) and `POST /api/auth/client/login` (wrong password) for an **existing** account; unknown emails have no tenant and are not logged | `portal` (`staff` or `client`), `accountActive` |
| `auth.password_changed` | `user` | USER | `POST /api/auth/change-password`, `POST /api/auth/reset-password`, `POST /api/team/:id/reset-password` | `method` (`self_service`, `reset_link`, `admin_reset`), `sessionsRevoked` |
| `api_key.created` | `api_key` | USER | `POST /api/api-keys` | `ownerUserId`, `expires` |
| `api_key.revoked` | `api_key` | USER | `DELETE /api/api-keys/:id` | `ownerUserId` |
| `settings.ai_provider_changed` | `settings` | USER (platform operator) | `POST /api/settings/ai-provider`; `entityId` is `ai_provider`. The provider is deployment-wide; the event is filed under the operator's organization | `fromProvider`, `toProvider`, `fromModel`, `toModel` |
| `client_portal.document_deleted` | `attachment` | CLIENT | `DELETE /api/client-portal/documents/:docId` | `projectId`, `clientId`, `mimeType`, `size` |

`auth.login_failed` is written without being awaited so a known email is not
measurably slower to reject than an unknown one.

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

1. Add the action and its entity type to `AUDIT_ACTIONS` in
   `src/services/audit-event.service.js`.
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
