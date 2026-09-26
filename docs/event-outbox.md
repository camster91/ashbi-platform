# Domain event outbox

Status: **code-present, not target verified** (#412). The mechanisms below are
implemented and tested against PostgreSQL; the numbers marked *Proposal* are
defaults for the owner to confirm.

Ashbi Hub records facts about the client-to-payment journey (an invoice was
paid, a proposal approved, a contract signed) as **domain events** in a
transactional outbox. The event row is written in the same database
transaction as the business change, and a worker delivers it afterwards. That
gives consumers a reliable, ordered, replayable feed without a distributed
transaction and without losing events when a process dies.

The outbox complements the [audit event log](audit-events.md); it does not
replace it:

| | Audit events (`audit_events`) | Domain events (`domain_events`) |
| --- | --- | --- |
| Purpose | Evidence: who did what, from where | Integration: a fact other parts of the system react to |
| Write semantics | Best effort, never fails the action | Transactional: commits or rolls back with the action |
| Mutability | Append-only (trigger) | Envelope immutable (trigger); dispatch bookkeeping changes |
| Delivery | None (read by admins) | At least once to subscribers, ordered per aggregate |
| Organization deletion | Blocked (`RESTRICT`) | Rows removed with it (`CASCADE`) |

Code:

- Table `domain_events` (Prisma `DomainEvent`), migration
  `20260926160000_domain_event_outbox`.
- Catalog: `src/services/domain-event-catalog.js`.
- Writer: `recordDomainEvent` in `src/services/domain-event.service.js`;
  journey producers in `src/services/domain-event-producers.js`.
- Dispatcher, subscriber registry and replay:
  `src/services/domain-event-dispatcher.service.js`; scheduled by the worker
  on the `domain-events` BullMQ queue (`src/jobs/queue.js`, `worker.js`).
- Admin API: `GET /api/domain-events`, `POST /api/domain-events/replay`
  (`src/routes/domain-event.routes.js`).

## Event envelope

| Field | Type | Notes |
| --- | --- | --- |
| `id` | cuid | Event id. Consumers dedupe on it. |
| `organizationId` | string | Owning tenant. From the signed-in principal, or on public/webhook routes from the owning client. |
| `type` | string | Dotted `aggregate.past_tense_verb`, e.g. `invoice.paid`. Must be in the catalog; the database also checks the format. |
| `schemaVersion` | int ≥ 1 | Version of the payload schema for `type` (always the catalog's current version when written). |
| `aggregateType` | string | Fixed per type by the catalog (`invoice`, `proposal`, `contract`). |
| `aggregateId` | string | Id of the aggregate the event is about. No foreign key: the event outlives the row. |
| `sequence` | int ≥ 1 | Position in the aggregate's stream: 1, 2, 3... without gaps, per organization and aggregate. |
| `payload` | JSON object | Catalog-validated. Ids, enums, amounts, hashes, timestamps only. |
| `correlationId` | string | The Fastify request id of the originating request (the same value as `requestId` in audit events and `traceId` in request logs), or a new UUID outside a request. |
| `causationId` | string or null | Id of the message that directly caused this event, e.g. `stripe:evt_...` for a Stripe webhook, or a parent domain event id. |
| `idempotencyKey` | string | Unique per organization. Names the business fact (see below). |
| `occurredAt` | timestamp | When the event was recorded, inside the business transaction. |

Dispatch bookkeeping (the only mutable columns): `status` (`pending`,
`dispatching`, `published`, `dead`), `attempts`, `nextAttemptAt`,
`lastAttemptAt`, `lockedUntil` (claim lease), `claimToken`, `publishedAt`,
`lastError` (error name, code and message, at most 300 characters; never a
stack or payload), `replayCount`.

## Writing an event

```js
await prisma.$transaction(async (tx) => {
  const payment = await tx.invoicePayment.create({ data });
  await recordInvoicePaid(tx, { invoice, paymentId: payment.id, method, source: 'manual', paidAt, correlationId: request.id });
});
```

Rules, enforced in code:

1. **Inside the business transaction.** `recordDomainEvent(tx, ...)` takes the
   interactive transaction client of the write it describes. It refuses a
   client without `$executeRaw`/`domainEvent`. Do not catch its errors inside
   the transaction.
2. **It throws.** Unknown types, payloads that fail the catalog schema, a
   missing organization, and an idempotency key reused for a different fact
   abort the business transaction. This is deliberate: a payment without its
   event is the failure the outbox exists to prevent. Trace ids are the
   exception: a malformed correlation or causation id is dropped (a new
   correlation id is generated), never fatal.
3. **Tenant.** Defaults to the request context's organization; inside a
   tenant request an event naming another organization is rejected. Public
   capability-link and webhook producers resolve it from the owning client,
   bypassing soft-delete filtering so a trashed client's documents still
   record their events.
4. **Isolation level.** Sequencing relies on PostgreSQL's default READ
   COMMITTED isolation (Prisma's default). Do not record events from a
   REPEATABLE READ or SERIALIZABLE transaction.
5. **Several aggregates in one transaction:** record them in a consistent
   order (e.g. sorted by aggregate id) so two transactions cannot deadlock on
   the per-aggregate locks.

## Catalog, versioning and deprecation

The catalog (`DOMAIN_EVENT_CATALOG`) is closed: each type lists its aggregate
type, its current version and a strict Zod schema per version.

| Type | Aggregate | v1 payload | Producers | Idempotency key |
| --- | --- | --- | --- | --- |
| `invoice.paid` | `invoice` | `invoiceId`, `clientId`, `paymentId`, `total`, `currency` (upper-case ISO 4217), `method`, `source` (`manual` or `stripe_checkout`), `paidAt` | `POST /api/invoices/:id/mark-paid`, `POST /api/invoices/bulk/mark-paid` (one event per paid invoice), Stripe `checkout.session.completed` on `/api/webhooks/stripe` and `/api/invoices/stripe-webhook` (causation `stripe:<event id>`; a replayed delivery records nothing) | `invoice.paid:<invoiceId>:<paymentId>` |
| `proposal.approved` | `proposal` | `proposalId`, `clientId`, `projectId`, `total`, `via` (`portal_link` or `public_link`), `approvedAt` | `POST /api/portal/proposal/:viewToken/approve`, `POST /api/proposals/client/:viewToken/approve`; only the compare-and-set winner | `proposal.approved:<proposalId>` |
| `contract.signed` | `contract` | `contractId`, `clientId`, `proposalId`, `signingMethod` (`type` or `draw`), `documentHash` (sha256 of the signed content), `via`, `signedAt` | `POST /api/portal/contract/:signToken/sign`, `POST /api/contracts/sign/:signToken`; only the compare-and-set winner | `contract.signed:<contractId>` |

Payloads never carry names, email addresses, notes, signature images, IP
addresses or free text; every schema is `.strict()`, so an unlisted field is
a validation error rather than silently stored. Consumers that need more load
it by id, through tenant-scoped access.

Versioning rules:

- **Additive, optional changes** (a new nullable field consumers may ignore)
  still get a new version: add `versions[n + 1]`, bump `currentVersion`, and
  keep every older version in the catalog. Producers always write the current
  version; consumers parse with `parseDomainEventPayload(event)`, which uses the
  version the row was written with.
- **Breaking changes** (renamed, removed or retyped fields, changed meaning)
  use a **new type** (for example `invoice.settled`), not a new version of the
  old one.
- **Deprecation**: mark the spec `deprecated: { since, replacedBy }`, stop
  producing it, and keep the entry (and its schemas) until no stored or
  replayable row of that type remains under the retention policy (#310).
  Removing a type from the catalog makes its stored rows unparseable.
- A type's `aggregateType` never changes.

## Idempotency

- **Producer side.** `idempotencyKey` is unique per organization. Recording
  the same key again (e.g. a retried request that reaches the event write)
  returns the first event with `duplicate: true` and writes nothing. The same
  key for a different type or aggregate is an error. Keys name the business
  fact (table above), so they are stable across retries.
- **Consumer side.** Delivery is at least once. A subscriber can receive the
  same event again after a sibling subscriber failed, a worker crashed after
  delivering but before marking the row, a claim lease expired, or an admin
  replay. Subscribers must be idempotent, keyed on `event.id` (or the
  idempotency key), for example with a unique constraint on the effect they
  write.

## Ordering

Guaranteed:

- Within one aggregate (organization + aggregate type + aggregate id), events
  get contiguous sequence numbers in commit order: producers take a
  transaction-scoped advisory lock on the aggregate before reading
  `MAX(sequence)`, and a unique index on
  `(organizationId, aggregateType, aggregateId, sequence)` is the backstop.
- The dispatcher only claims event N when every earlier event of the same
  aggregate is `published`, so subscribers see an aggregate's events in
  sequence order. An in-flight or `dead` predecessor blocks its successors
  until it is published (for a dead one, after a replay).

Not guaranteed:

- Any order between different aggregates or different organizations (the
  dispatcher claims oldest-first, but concurrent dispatchers and retries
  interleave).
- Exactly-once delivery (see idempotency).
- Delivery latency: the dispatch tick runs every 15 seconds (*Proposal*,
  `DOMAIN_EVENT_DISPATCH_INTERVAL_MS`) and each run keeps claiming until
  nothing is due, up to 10 rounds of 25.

## Dispatch

Each tick claims due events with one statement: `pending` events whose
`nextAttemptAt` has passed, and `dispatching` events whose lease expired
(their worker died), whose predecessors are all published, oldest first,
`FOR UPDATE SKIP LOCKED`. Claimed rows become `dispatching` with a 2-minute
lease (*Proposal*) and a fresh claim token, and `attempts` increases. Several
worker replicas never claim the same row.

Each claimed event is delivered to the in-process subscribers registered for
its type (`registerDomainEventSubscriber`), in registration order, inside a
tenant scope for the event's organization. There is no external delivery in
this slice. The built-in `journal` subscriber writes one structured log line
per delivered event (ids and envelope fields, never the payload).

Outcomes are conditional on `(id, status = 'dispatching', claimToken)`, so a
worker that lost its lease cannot overwrite a newer claim:

| Outcome | New state |
| --- | --- |
| Every subscriber succeeded | `published`, `publishedAt` set |
| A subscriber threw, attempts < 10 (*Proposal*) | `pending`, `nextAttemptAt` = now + backoff, `lastError` set |
| A subscriber threw on attempt 10 | `dead`, logged as `Domain event dead-lettered` (alert on it) |

Backoff (*Proposal*): exponential from 10 seconds, doubling, capped at 1 hour,
with equal jitter (the delay is between half and all of the capped value). Ten
failed attempts take roughly 1.5 to 3 hours before an event is dead-lettered.

## Replay safeguards

`POST /api/domain-events/replay` with `{ "eventIds": [...] }` requeues
dead-lettered events:

- **Admin only, with step-up re-authentication** (`requireRecentAuth`, see
  [privileged-actions.md](privileged-actions.md)).
- **Tenant-scoped**: runs through the request-scoped client, so another
  organization's ids are reported as `not_found` and never touched.
- **Dead events only**: `published` events are never re-sent by this path
  (`not_dead`), which keeps replay from duplicating effects that already
  happened.
- **Bounded**: at most 50 ids per call and 5 replays per event
  (*Proposal*, `replay_limit`).
- **Race-safe**: each requeue is a conditional update on the status and replay
  count read, so concurrent replays requeue an event once (`changed`).
- **Audited**: each requeued event writes a `domain_event.replayed` audit event
  (see [audit-events.md](audit-events.md)).

A replay resets `attempts` to 0 and makes the event due immediately; it keeps
`lastError` until the next attempt. `GET /api/domain-events?status=dead`
lists candidates (admin only, tenant-scoped, filterable by status, type,
aggregate and correlation id, keyset-paginated).

## Correlation and causation

- `correlationId` groups everything caused by one originating request: the
  request id is passed explicitly by producers (`request.id`), or taken from
  the request context, or generated. Join it to request logs (`traceId`) and
  audit events (`requestId`).
- `causationId` names the immediate cause when it is a message rather than a
  request: `stripe:<event id>` for Stripe webhooks. A subscriber that records
  a follow-up event should pass the parent event's `correlationId` and set
  `causationId` to the parent event's `id`.

## Tenancy and integrity

- `DomainEvent` is a direct tenant model in `src/utils/prisma-tenant-proxy.js`:
  request-scoped reads are filtered to the caller's organization and writes
  are forced into it. In request scope the model cannot be deleted or
  upserted, and updates may only touch the bookkeeping columns.
- A `BEFORE UPDATE` trigger rejects any change to the envelope columns
  (`domain event envelope is immutable`) for every database role. CHECK
  constraints cover the type format, status values, non-negative counters,
  an object payload, field lengths, `publishedAt` for published rows, and a
  lease and token for claimed rows.
- The dispatcher runs as a background job with the unscoped client and
  scopes each delivery to the event's organization.

## Retention

Published rows are kept for now. How long published and dead events are
retained, and whether they are archived or deleted, is part of the privacy and
retention decision in [#310](https://github.com/camster91/ashbi-platform/issues/310).
Deleting rows is not blocked by the trigger, but no code path deletes events
today except organization deletion (`CASCADE`).

## Deferred

- External delivery (signed webhooks to customer endpoints) and per-subscriber
  delivery receipts; there is no existing signed outbound webhook sender to
  reuse.
- More producers (invoice sent, estimate accepted, project created) and real
  consumers; existing automations (`onProposalApproved`, `onContractSigned`)
  still run directly, unchanged.
- A web UI for the outbox; the admin API is the interface.
- Metrics/alerts on outbox lag and dead-letter counts beyond the log lines.
