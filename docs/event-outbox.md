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
- Manual settlement (compare-and-set mark-paid):
  `src/services/invoice-payment.service.js`.
- Admin API: `GET /api/domain-events`, `POST /api/domain-events/replay`,
  `POST /api/domain-events/discard` (`src/routes/domain-event.routes.js`).

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
`dispatching`, `published`, `dead`, `discarded`), `attempts`, `nextAttemptAt`,
`lastAttemptAt`, `lockedUntil` (claim lease), `claimToken`, `publishedAt`,
`discardedAt`, `lastError` (error name, code and message, at most 300
characters; never a stack or payload), `replayCount`.

## Writing an event

```js
await prisma.$transaction(async (tx) => {
  const payment = await tx.invoicePayment.create({ data });
  await recordInvoicePaid(tx, { invoice, paymentId: payment.id, amount: payment.amount, method, source: 'manual', paidAt, correlationId: request.id });
});
```

Rules, enforced in code:

1. **Inside the business transaction.** `recordDomainEvent(tx, ...)` takes the
   interactive transaction client of the write it describes. It refuses a
   client without `$executeRaw`/`domainEvent`. Do not catch its errors inside
   the transaction.
2. **Data never blocks the write; code defects do.** The journey producers
   (`domain-event-producers.js`) normalize what they read from the database
   before validation, so a valid business write always yields a valid event
   (see [Normalized data](#normalized-data)). `recordDomainEvent` itself
   stays strict and throws on programmer errors: an unknown type, a payload
   that fails the catalog schema, a missing organization, or an idempotency
   key reused for a different fact. Those abort the business transaction,
   deliberately: a payment without its event is the failure the outbox exists
   to prevent. Trace ids are never fatal: a malformed correlation or
   causation id is dropped (a new correlation id is generated).
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

### Normalized data

Legacy or out-of-shape rows must not stop a payment, approval or signature.
The producers therefore map each field to a valid value and list every field
they had to change in the payload's optional `dataIssues` array:

| Field kind | Out of shape | Becomes |
| --- | --- | --- |
| Currency | not three letters after upper-casing (e.g. `Euro`, `C$`) | `XXX` (ISO 4217 "no currency"); missing currency becomes `CAD`, like Stripe checkout, without a data issue |
| Amounts (`amount`, `total`) | `NaN`, `Infinity`, missing | `0` |
| Ids | outside `^[A-Za-z0-9_:.-]+$` or over 191 characters | `invalid-<first 32 hex of sha256(value)>`, the same for the same value |
| Codes (`method`) | outside `^[A-Za-z0-9_-]{1,40}$` | `UNKNOWN` |
| Enums (`signingMethod`) | not an allowed value | the first allowed value (`type`) |
| Hashes (`documentHash`) | not a sha256 hex digest | sha256 of the value |
| Timestamps | invalid date | the time the event is recorded |

A payload with `dataIssues` is a prompt to repair the source row; consumers
must not trust the normalized fields for money decisions. Idempotency keys
longer than 255 characters become `<type>:sha256:<hex>`, deterministically.

### Stripe webhook failures

A verified `checkout.session.completed` delivery that is not recorded answers
Stripe with a distinct code (`handleCheckoutFailure` in
`src/services/stripe.service.js`, both webhook routes):

| Code | HTTP | Meaning | Action |
| --- | --- | --- | --- |
| `CHECKOUT_MISMATCH` | 200 (`recorded: false`) | The session does not match the invoice (amount, currency, number, unpaid) | Logged as a warning; acknowledged because Stripe retries every non-2xx answer and a retry cannot help |
| `INVOICE_ALREADY_PAID` | 200 (`recorded: false`) | Another payment settled the invoice first (e.g. a manual mark-paid won the race) | Logged and alerted (`stripe_checkout_invoice_already_paid`): the customer may need a refund |
| `INVOICE_VOID` | 200 (`recorded: false`) | The invoice was voided after its Checkout session was created (voiding expires the session, best-effort) | The invoice stays VOID; logged and alerted (`stripe_checkout_invoice_void`): refund or re-issue |
| `DOMAIN_EVENT_INVALID` | 500 | The outbox event was rejected, so the payment transaction rolled back | Logged and alerted (`domain_event_invalid`): a code defect; Stripe keeps retrying until fixed |
| `CHECKOUT_RECORDING_FAILED` | 500 | Anything else, e.g. the database was unavailable | Logged; nothing was committed and Stripe retries the delivery |

## Catalog, versioning and deprecation

The catalog (`DOMAIN_EVENT_CATALOG`) is closed: each type lists its aggregate
type, its current version and a strict Zod schema per version.

| Type | Aggregate | v1 payload | Producers | Idempotency key |
| --- | --- | --- | --- | --- |
| `invoice.paid` | `invoice` | `invoiceId`, `clientId`, `paymentId`, `amount` (from the payment row), `total` (invoice total), `currency` (upper-case ISO 4217), `method`, `source` (`manual` or `stripe_checkout`), `paidAt`, optional `dataIssues` | `POST /api/invoices/:id/mark-paid`, `POST /api/invoices/bulk/mark-paid` (one event per paid invoice; both compare-and-set, so a concurrent mark-paid or Stripe settlement cannot double-pay: the loser gets `409 INVOICE_NOT_PAYABLE`, or a bulk `skipped` entry with reason `changed`), Stripe `checkout.session.completed` on `/api/webhooks/stripe` and `/api/invoices/stripe-webhook` (causation `stripe:<event id>`; a replayed delivery records nothing) | `invoice.paid:<invoiceId>:<paymentId>` |
| `proposal.approved` | `proposal` | `proposalId`, `clientId`, `projectId`, `total`, `via` (`portal_link` or `public_link`), `approvedAt`, optional `dataIssues` | `POST /api/portal/proposal/:viewToken/approve`, `POST /api/proposals/client/:viewToken/approve`; only the compare-and-set winner | `proposal.approved:<proposalId>` |
| `contract.signed` | `contract` | `contractId`, `clientId`, `proposalId`, `signingMethod` (`type` or `draw`), `documentHash` (sha256 of the signed content), `via`, `signedAt`, optional `dataIssues` | `POST /api/portal/contract/:signToken/sign`, `POST /api/contracts/sign/:signToken`; only the compare-and-set winner | `contract.signed:<contractId>` |

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
  key with a different type, aggregate, schema version or payload is an error
  (payloads are compared with object keys sorted, since JSONB does not keep
  key order). Keys name the business fact (table above), so they are stable
  across retries.
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
  aggregate is settled (`published` or `discarded`), so subscribers see an
  aggregate's events in sequence order. An in-flight or `dead` predecessor
  blocks its successors until it is published (for a dead one, after a
  replay) or discarded by an admin.

Not guaranteed:

- Any order between different aggregates or different organizations (the
  dispatcher claims oldest-first, but concurrent dispatchers and retries
  interleave).
- Exactly-once delivery (see idempotency).
- Strict order under redelivery: a dispatcher that lost its lease (a
  delivery slower than the lease, a paused process) can still deliver event
  N after the next claimer published N and delivered N+1. Subscribers that
  care must compare `sequence` with the last one they applied.
- Delivery latency: the dispatch tick runs every 15 seconds (*Proposal*,
  `DOMAIN_EVENT_DISPATCH_INTERVAL_MS`) and each run keeps claiming until
  nothing is due, up to 10 rounds of 25.

## Dispatch

Each run first dead-letters claims abandoned on their final attempt:
`dispatching` rows whose lease expired with `attempts` already at the maximum
(a worker that crashes or hangs on an event every time would otherwise be
reclaimed forever). It then claims due events with one statement: `pending`
events whose `nextAttemptAt` has passed, and `dispatching` events whose lease
expired with attempts left (their worker died), whose predecessors are all
settled, oldest first,
`FOR UPDATE SKIP LOCKED`. Claimed rows become `dispatching` with a 2-minute
lease (*Proposal*) and a fresh claim token, and `attempts` increases (so a
claim abandoned by a crashed worker counts as an attempt). Several worker
replicas never claim the same row.

Each claimed event is delivered to the in-process subscribers registered for
its type (`registerDomainEventSubscriber`), in registration order, inside a
tenant scope for the event's organization. All subscribers of one event must
finish within 60 seconds (`SUBSCRIBER_TIMEOUT_MS`, *Proposal*), which the
dispatcher requires to be shorter than the lease; a timeout counts as a failed
attempt. The timed-out work cannot be cancelled and may still finish, which
is one more reason subscribers must be idempotent. There is no external
delivery in this slice. The built-in `journal` subscriber writes one structured log line
per delivered event (ids and envelope fields, never the payload).

Outcomes are conditional on `(id, status = 'dispatching', claimToken)`, so a
worker that lost its lease cannot overwrite a newer claim:

| Outcome | New state |
| --- | --- |
| Every subscriber succeeded | `published`, `publishedAt` set |
| A subscriber threw, attempts < 10 (*Proposal*) | `pending`, `nextAttemptAt` = now + backoff, `lastError` set |
| A subscriber threw or timed out on attempt 10 | `dead`, logged as `Domain event dead-lettered` (alert on it) |
| The lease expired after attempt 10 without an outcome (crash or hang) | `dead` with `lastError` `LeaseExpired: ...`, logged as `Domain events dead-lettered after an abandoned final attempt` |

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
`lastError` until the next attempt.

## Discarding a dead event

A dead event blocks every later event of its aggregate. When it will never be
deliverable, `POST /api/domain-events/discard` with
`{ "eventIds": [...], "reason": "poison_payload" | "consumer_retired" | "superseded" | "other" }`
moves it to `discarded`:

- Admin only, with step-up re-authentication; tenant-scoped; `dead` events
  only (`not_dead` otherwise); at most 50 ids per call; conditional update.
- `discarded` is terminal: the event is never delivered or replayed, but the
  row, its payload, `lastError` and a `discardedAt` timestamp are kept.
- It counts as settled for ordering, so the aggregate's next event becomes
  claimable on the next dispatch tick.
- Each discard writes a `domain_event.discarded` audit event with the reason.

Operator procedure for a dead event:

1. `GET /api/domain-events?status=dead` and read `lastError`; find the
   subscriber in the logs by `domainEventId` / `correlationId`.
2. If the cause was transient or has been fixed (deploy, configuration,
   downstream outage over), replay it (`POST /api/domain-events/replay`).
3. If it keeps dying after replays (the limit is 5), or the event can never
   succeed (a consumer was retired, the payload is poison, a later event
   supersedes it), discard it with the matching reason, and record in the
   incident notes what, if anything, must be done by hand for its effect.
4. Check that the aggregate's later events publish on the next tick. `GET /api/domain-events?status=dead`
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
  an object payload, field lengths, `publishedAt` for published rows,
  `discardedAt` for discarded rows, and a lease and token for claimed rows.
- The organization foreign key is `ON DELETE CASCADE` and `ON UPDATE
  RESTRICT`: `organizationId` is part of the immutable envelope, so an
  organization id change is refused rather than cascaded into the trigger.
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
