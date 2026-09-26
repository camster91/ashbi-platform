// Domain event outbox (#412, docs/event-outbox.md): catalog validation,
// recordDomainEvent sequencing/dedupe/tenancy, the dispatcher's ordering,
// backoff and dead-lettering, replay safeguards, the request-scoped proxy
// policy and the admin route. Real PostgreSQL behaviour (advisory locks,
// SKIP LOCKED, constraints, rollback) is proven in
// src/tests/integration/domain-events.database.test.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { outboxStore } = await import('../helpers/domain-event-fake.js');
const {
  DOMAIN_EVENT_CATALOG,
  DomainEventValidationError,
  parseDomainEventPayload,
  validateDomainEventPayload,
} = await import('../../services/domain-event-catalog.js');
const {
  DomainEventIdempotencyConflictError,
  aggregateLockKey,
  recordDomainEvent,
} = await import('../../services/domain-event.service.js');
const {
  DISPATCH_DEFAULTS,
  MAX_REPLAY_BATCH,
  SUBSCRIBER_TIMEOUT_MS,
  computeBackoffMs,
  deadLetterAbandonedClaims,
  describeDispatchError,
  discardDeadDomainEvents,
  dispatchDomainEvents,
  registerDomainEventSubscriber,
  replayDeadDomainEvents,
  subscribersFor,
  unregisterDomainEventSubscriber,
} = await import('../../services/domain-event-dispatcher.service.js');
const {
  UNKNOWN_CURRENCY,
  idempotencyKeyFor,
  recordContractSigned,
  recordInvoicePaid,
  recordProposalApproved,
} = await import('../../services/domain-event-producers.js');
const { createScopedPrisma, tenantModelPolicy } = await import('../../utils/prisma-tenant-proxy.js');
const { requestStorage } = await import('../../utils/request-context.js');
const { default: domainEventRoutes } = await import('../../routes/domain-event.routes.js');

const PAID_AT = '2026-09-26T12:00:00.000Z';

function invoicePaid(overrides = {}) {
  return {
    type: 'invoice.paid',
    organizationId: 'org-1',
    aggregateId: 'inv-1',
    idempotencyKey: 'invoice.paid:inv-1:pay-1',
    correlationId: 'req-1',
    payload: {
      invoiceId: 'inv-1', clientId: 'client-1', paymentId: 'pay-1', amount: 113, total: 113, currency: 'CAD',
      method: 'CHEQUE', source: 'manual', paidAt: PAID_AT,
    },
    ...overrides,
  };
}

function fakeTx() {
  const outbox = outboxStore();
  return { outbox, tx: { domainEvent: outbox.domainEvent, $executeRaw: outbox.$executeRaw } };
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

test('the catalog is closed, versioned and strict', () => {
  for (const [type, spec] of Object.entries(DOMAIN_EVENT_CATALOG)) {
    assert.match(type, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    assert.ok(spec.versions[spec.currentVersion], `${type} has a schema for its current version`);
  }
  assert.throws(() => validateDomainEventPayload('invoice.refunded', {}), DomainEventValidationError);
  assert.throws(() => validateDomainEventPayload('invoice.paid', invoicePaid().payload, 99), /Unknown schema version/);
  // Unlisted fields (free text, names) fail validation rather than being stored.
  assert.throws(
    () => validateDomainEventPayload('invoice.paid', { ...invoicePaid().payload, notes: 'cheque #12' }),
    (err) => err instanceof DomainEventValidationError && err.issues.length > 0 && !JSON.stringify(err.issues).includes('cheque #12'),
  );
  assert.throws(() => validateDomainEventPayload('invoice.paid', { ...invoicePaid().payload, currency: 'cad' }), /Invalid invoice.paid/);
  assert.throws(() => validateDomainEventPayload('contract.signed', {
    contractId: 'k-1', clientId: 'c-1', proposalId: null, signingMethod: 'type', documentHash: 'not-a-hash', via: 'public_link', signedAt: PAID_AT,
  }), DomainEventValidationError);
  assert.deepEqual(parseDomainEventPayload({ type: 'invoice.paid', schemaVersion: 1, payload: invoicePaid().payload }), invoicePaid().payload);
});

// ─── recordDomainEvent ───────────────────────────────────────────────────────

test('recordDomainEvent assigns contiguous per-aggregate sequences under an aggregate lock', async () => {
  const { outbox, tx } = fakeTx();
  const a1 = await recordDomainEvent(tx, invoicePaid());
  const a2 = await recordDomainEvent(tx, invoicePaid({ idempotencyKey: 'invoice.paid:inv-1:pay-2', payload: { ...invoicePaid().payload, paymentId: 'pay-2' } }));
  const b1 = await recordDomainEvent(tx, invoicePaid({ aggregateId: 'inv-2', idempotencyKey: 'invoice.paid:inv-2:pay-3', payload: { ...invoicePaid().payload, invoiceId: 'inv-2', paymentId: 'pay-3' } }));
  assert.deepEqual([a1.event.sequence, a2.event.sequence, b1.event.sequence], [1, 2, 1]);
  assert.deepEqual([a1.duplicate, a2.duplicate, b1.duplicate], [false, false, false]);
  assert.equal(a1.event.aggregateType, 'invoice', 'aggregate type comes from the catalog');
  assert.equal(a1.event.schemaVersion, 1);
  assert.deepEqual(outbox.locks, [
    aggregateLockKey('org-1', 'invoice', 'inv-1'),
    aggregateLockKey('org-1', 'invoice', 'inv-1'),
    aggregateLockKey('org-1', 'invoice', 'inv-2'),
  ]);
});

test('recordDomainEvent dedupes by idempotency key and rejects a key reused for another fact', async () => {
  const { outbox, tx } = fakeTx();
  const first = await recordDomainEvent(tx, invoicePaid());
  const again = await recordDomainEvent(tx, invoicePaid({ correlationId: 'req-2' }));
  assert.equal(again.duplicate, true);
  assert.equal(again.event.id, first.event.id);
  assert.equal(outbox.events.length, 1);
  await assert.rejects(
    recordDomainEvent(tx, invoicePaid({ aggregateId: 'inv-9', payload: { ...invoicePaid().payload, invoiceId: 'inv-9' } })),
    DomainEventIdempotencyConflictError,
  );
  // Same key and aggregate but a different payload is not the same fact.
  await assert.rejects(
    recordDomainEvent(tx, invoicePaid({ payload: { ...invoicePaid().payload, amount: 50 } })),
    DomainEventIdempotencyConflictError,
  );
  // Key order does not matter (JSONB does not preserve it).
  const reordered = Object.fromEntries(Object.entries(invoicePaid().payload).reverse());
  assert.equal((await recordDomainEvent(tx, invoicePaid({ payload: reordered }))).duplicate, true);
  // The same key in another organization is a different fact.
  const otherTenant = await recordDomainEvent(tx, invoicePaid({ organizationId: 'org-2' }));
  assert.equal(otherTenant.duplicate, false);
});

test('recordDomainEvent rejects unknown types, bad payloads, missing tenants and non-transaction clients', async () => {
  const { outbox, tx } = fakeTx();
  await assert.rejects(recordDomainEvent(tx, invoicePaid({ type: 'invoice.unknown' })), /Unknown domain event type/);
  await assert.rejects(recordDomainEvent(tx, invoicePaid({ payload: { invoiceId: 'inv-1' } })), DomainEventValidationError);
  await assert.rejects(recordDomainEvent(tx, invoicePaid({ organizationId: null })), /organizationId is required/);
  await assert.rejects(recordDomainEvent(tx, invoicePaid({ idempotencyKey: '' })), /idempotencyKey is required/);
  await assert.rejects(recordDomainEvent({ domainEvent: outbox.domainEvent }, invoicePaid()), /business transaction client/);
  assert.equal(outbox.events.length, 0);
});

test('correlation comes from the request, causation is optional, and bad trace ids never fail the write', async () => {
  const { tx } = fakeTx();
  const fromContext = await requestStorage.run(
    { prisma: null, organizationId: 'org-1', requestId: 'req-ctx' },
    () => recordDomainEvent(tx, invoicePaid({ correlationId: undefined })),
  );
  assert.equal(fromContext.event.correlationId, 'req-ctx');
  assert.equal(fromContext.event.causationId, null);

  const generated = await recordDomainEvent(tx, invoicePaid({
    aggregateId: 'inv-3', idempotencyKey: 'k-3', correlationId: 'has spaces', causationId: 'x'.repeat(300),
    payload: { ...invoicePaid().payload, invoiceId: 'inv-3' },
  }));
  assert.match(generated.event.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(generated.event.causationId, null);
});

test('inside a tenant request the event cannot name another organization', async () => {
  const { outbox, tx } = fakeTx();
  await assert.rejects(
    requestStorage.run({ prisma: null, organizationId: 'org-1', requestId: 'req-1' },
      () => recordDomainEvent(tx, invoicePaid({ organizationId: 'org-2' }))),
    /does not match the request tenant/,
  );
  const defaulted = await requestStorage.run({ prisma: null, organizationId: 'org-1', requestId: 'req-1' },
    () => recordDomainEvent(tx, invoicePaid({ organizationId: undefined })));
  assert.equal(defaulted.event.organizationId, 'org-1');
  assert.equal(outbox.events.length, 1);
});

// ─── Tenant proxy policy ─────────────────────────────────────────────────────

test('domain events are a direct tenant model whose envelope request scope cannot change', async () => {
  assert.equal(tenantModelPolicy.domainevent, 'direct');
  const outbox = outboxStore();
  const mustNotRun = async () => { throw new Error('the unscoped method must not run'); };
  const delegate = { ...outbox.domainEvent, delete: mustNotRun, deleteMany: mustNotRun, upsert: mustNotRun };
  const scopedA = createScopedPrisma({ domainEvent: delegate, $executeRaw: outbox.$executeRaw }, 'org-a');
  const scopedB = createScopedPrisma({ domainEvent: delegate, $executeRaw: outbox.$executeRaw }, 'org-b');

  // A scoped write forces the caller's organization even if another is named.
  await scopedA.domainEvent.create({ data: { organizationId: 'org-b', type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1, idempotencyKey: 'k' } });
  assert.equal(outbox.events[0].organizationId, 'org-a');
  assert.equal((await scopedB.domainEvent.findMany({})).length, 0, 'tenant B cannot see tenant A events');
  assert.equal(await scopedB.domainEvent.findFirst({ where: { id: outbox.events[0].id } }), null);
  assert.equal((await scopedB.domainEvent.updateMany({ where: { id: outbox.events[0].id }, data: { status: 'pending' } })).count, 0);

  await assert.rejects(scopedA.domainEvent.updateMany({ where: {}, data: { payload: {} } }), /fields payload are immutable/);
  await assert.rejects(scopedA.domainEvent.update({ where: { id: 'x' }, data: { type: 'contract.signed' } }), /immutable/);
  await assert.rejects(scopedA.domainEvent.delete({ where: { id: 'x' } }), /not permitted/);
  await assert.rejects(scopedA.domainEvent.deleteMany({}), /not permitted/);
  await assert.rejects(scopedA.domainEvent.upsert({ where: { id: 'x' }, create: {}, update: {} }), /not permitted/);
  const bookkeeping = await scopedA.domainEvent.updateMany({ where: { id: outbox.events[0].id }, data: { status: 'dead', lastError: 'x' } });
  assert.equal(bookkeeping.count, 1);
});

test('recordDomainEvent through a tenant-scoped transaction writes and reads only that tenant', async () => {
  const outbox = outboxStore();
  const base = { domainEvent: outbox.domainEvent, $executeRaw: outbox.$executeRaw };
  // Tenant B already has sequence 1 for an aggregate with the same id.
  await recordDomainEvent(base, invoicePaid({ organizationId: 'org-b' }));
  const scopedA = createScopedPrisma(base, 'org-a');
  const result = await requestStorage.run({ prisma: scopedA, organizationId: 'org-a', requestId: 'req-a' },
    () => recordDomainEvent(scopedA, invoicePaid({ organizationId: undefined })));
  assert.equal(result.duplicate, false, 'tenant B\'s identical key is invisible to tenant A');
  assert.equal(result.event.organizationId, 'org-a');
  assert.equal(result.event.sequence, 1, 'sequences are per tenant and aggregate');
});

// ─── Dispatcher ──────────────────────────────────────────────────────────────

test('backoff is exponential, capped and jittered within bounds', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 60_000 };
  assert.equal(computeBackoffMs(1, { ...opts, random: () => 1 }), 1000);
  assert.equal(computeBackoffMs(1, { ...opts, random: () => 0 }), 500);
  assert.equal(computeBackoffMs(4, { ...opts, random: () => 1 }), 8000);
  assert.equal(computeBackoffMs(30, { ...opts, random: () => 1 }), 60_000);
  assert.equal(computeBackoffMs(30, { ...opts, random: () => 0 }), 30_000);
  assert.equal(computeBackoffMs(1000, { ...opts, random: () => 5 }), 60_000, 'jitter is clamped');
  assert.equal(describeDispatchError(Object.assign(new Error('x'.repeat(1000)), { code: 'E_X' })).length, 300);
});

/**
 * In-memory stand-in for claimDomainEvents with the same eligibility rules:
 * due pending rows or expired leases, predecessors published, oldest first.
 */
function memoryOutbox(rows) {
  const events = rows.map((row, index) => ({
    id: `e${index + 1}`, organizationId: 'org-1', aggregateType: 'invoice', status: 'pending', attempts: 0,
    nextAttemptAt: new Date(0), lockedUntil: null, claimToken: null, lastError: null, replayCount: 0,
    occurredAt: new Date(index), correlationId: 'req-1', causationId: null, ...row,
  }));
  let tokens = 0;
  const claim = async (_prisma, { now, limit, leaseMs, maxAttempts }) => {
    const eligible = events.filter((event) => (
      (event.status === 'pending' && event.nextAttemptAt <= now)
      || (event.status === 'dispatching' && event.lockedUntil < now && event.attempts < maxAttempts)
    ) && !events.some((other) => other.organizationId === event.organizationId && other.aggregateType === event.aggregateType
      && other.aggregateId === event.aggregateId && other.sequence < event.sequence && !['published', 'discarded'].includes(other.status)))
      .sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence)
      .slice(0, limit);
    const claimToken = `claim-${++tokens}`;
    for (const event of eligible) {
      Object.assign(event, { status: 'dispatching', attempts: event.attempts + 1, lockedUntil: new Date(now.getTime() + leaseMs), claimToken });
    }
    return eligible.map((event) => ({ ...event }));
  };
  const matchesWhere = (event, where) => Object.entries(where).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('lt' in condition) return event[field] !== null && event[field] < condition.lt;
      if ('gte' in condition) return event[field] >= condition.gte;
      return false;
    }
    return event[field] === condition;
  });
  const prisma = {
    domainEvent: {
      updateMany: async ({ where, data }) => {
        const targets = events.filter((event) => matchesWhere(event, where));
        for (const target of targets) Object.assign(target, data);
        return { count: targets.length };
      },
    },
  };
  return { events, claim, prisma };
}

const inTenant = async (_prisma, organizationId, callback) => callback({ organizationId });
const silent = { info() {}, warn() {}, error() {} };

test('the dispatcher delivers each aggregate in sequence order and publishes', async () => {
  const { events, claim, prisma } = memoryOutbox([
    { aggregateId: 'inv-1', sequence: 2, type: 'invoice.paid', occurredAt: new Date(1) },
    { aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid', occurredAt: new Date(5) },
    { aggregateId: 'inv-2', sequence: 1, type: 'proposal.approved', occurredAt: new Date(2) },
  ]);
  const delivered = [];
  const subscribers = [{ name: 'spy', types: null, handle: (event, ctx) => delivered.push([event.aggregateId, event.sequence, ctx.prisma.organizationId]) }];
  const summary = await dispatchDomainEvents(prisma, { claim, subscribers, runInTenant: inTenant, logger: silent, batchSize: 10 });
  assert.deepEqual(delivered, [['inv-2', 1, 'org-1'], ['inv-1', 1, 'org-1'], ['inv-1', 2, 'org-1']]);
  assert.deepEqual(summary, { claimed: 3, published: 3, retried: 0, dead: 0, leaseLost: 0, abandoned: 0 });
  assert.ok(events.every((event) => event.status === 'published' && event.publishedAt && event.claimToken === null));
});

test('a failing subscriber retries with backoff, blocks its successors, then dead-letters', async () => {
  let clock = new Date('2026-09-26T00:00:00Z');
  const { events, claim, prisma } = memoryOutbox([
    { aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid' },
    { aggregateId: 'inv-1', sequence: 2, type: 'invoice.paid' },
  ]);
  const seen = [];
  const subscribers = [{
    name: 'flaky', types: new Set(['invoice.paid']),
    handle: (event) => { seen.push(event.sequence); throw Object.assign(new Error('downstream unavailable'), { code: 'E_DOWN' }); },
  }];
  const options = {
    claim, subscribers, runInTenant: inTenant, logger: silent, now: () => clock,
    maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10_000, random: () => 1,
  };

  let summary = await dispatchDomainEvents(prisma, options);
  assert.deepEqual(summary, { claimed: 1, published: 0, retried: 1, dead: 0, leaseLost: 0, abandoned: 0 });
  assert.equal(events[0].status, 'pending');
  assert.equal(events[0].nextAttemptAt.getTime(), clock.getTime() + 1000);
  assert.equal(events[0].lastError, 'Error [E_DOWN]: downstream unavailable');
  assert.equal(events[1].status, 'pending', 'the successor was never claimed');

  summary = await dispatchDomainEvents(prisma, options);
  assert.equal(summary.claimed, 0, 'not due until the backoff elapses');

  clock = new Date(clock.getTime() + 1000);
  summary = await dispatchDomainEvents(prisma, options);
  assert.equal(summary.retried, 1);
  assert.equal(events[0].nextAttemptAt.getTime(), clock.getTime() + 2000, 'the delay doubles');

  clock = new Date(clock.getTime() + 2000);
  summary = await dispatchDomainEvents(prisma, options);
  assert.equal(summary.dead, 1);
  assert.equal(events[0].status, 'dead');
  assert.equal(events[0].attempts, 3);

  clock = new Date(clock.getTime() + 60_000);
  summary = await dispatchDomainEvents(prisma, options);
  assert.equal(summary.claimed, 0, 'a dead predecessor blocks the aggregate');
  assert.deepEqual(seen, [1, 1, 1]);
});

test('a dispatcher that lost its lease does not overwrite the newer claim', async () => {
  const { events, claim, prisma } = memoryOutbox([{ aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid' }]);
  const subscribers = [{
    name: 'slow', types: null,
    // While this delivery runs, another dispatcher reclaims the row.
    handle: () => { events[0].claimToken = 'someone-else'; },
  }];
  const summary = await dispatchDomainEvents(prisma, { claim, subscribers, runInTenant: inTenant, logger: silent });
  assert.equal(summary.leaseLost, 1);
  assert.equal(events[0].status, 'dispatching');
  assert.equal(events[0].claimToken, 'someone-else');
});

test('a claim abandoned on its final attempt is dead-lettered, not reclaimed forever', async () => {
  const now = new Date('2026-09-26T00:00:00Z');
  const expired = new Date(now.getTime() - 1);
  const { events, claim, prisma } = memoryOutbox([
    // Crashed its worker on the last allowed attempt.
    { aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid', status: 'dispatching', attempts: 3, lockedUntil: expired, claimToken: 'dead-worker' },
    // Crashed with attempts left: reclaimed and delivered.
    { aggregateId: 'inv-2', sequence: 1, type: 'invoice.paid', status: 'dispatching', attempts: 1, lockedUntil: expired, claimToken: 'dead-worker' },
    // Lease still valid: left alone.
    { aggregateId: 'inv-3', sequence: 1, type: 'invoice.paid', status: 'dispatching', attempts: 3, lockedUntil: new Date(now.getTime() + 60_000), claimToken: 'live' },
  ]);
  const delivered = [];
  const subscribers = [{ name: 'spy', types: null, handle: (event) => delivered.push(event.aggregateId) }];
  const summary = await dispatchDomainEvents(prisma, {
    claim, subscribers, runInTenant: inTenant, logger: silent, now: () => now, maxAttempts: 3,
  });
  assert.equal(summary.abandoned, 1);
  assert.deepEqual(delivered, ['inv-2']);
  assert.deepEqual([events[0].status, events[0].claimToken, events[0].lockedUntil], ['dead', null, null]);
  assert.match(events[0].lastError, /^LeaseExpired/);
  assert.equal(events[2].status, 'dispatching');
  // The sweep on its own, as the worker calls it.
  assert.equal(await deadLetterAbandonedClaims(prisma, { now, maxAttempts: 3 }), 0);
});

test('a subscriber that hangs times out below the lease and counts as a failed attempt', async () => {
  assert.ok(SUBSCRIBER_TIMEOUT_MS < DISPATCH_DEFAULTS.leaseMs);
  const { events, claim, prisma } = memoryOutbox([{ aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid' }]);
  const subscribers = [{ name: 'hang', types: null, handle: () => new Promise(() => {}) }];
  const summary = await dispatchDomainEvents(prisma, {
    claim, subscribers, runInTenant: inTenant, logger: silent, subscriberTimeoutMs: 20, leaseMs: 1000,
  });
  assert.equal(summary.retried, 1);
  assert.equal(events[0].status, 'pending');
  assert.match(events[0].lastError, /^DomainEventSubscriberTimeoutError \[SUBSCRIBER_TIMEOUT\]/);
  await assert.rejects(
    dispatchDomainEvents(prisma, { claim, subscribers, runInTenant: inTenant, logger: silent, subscriberTimeoutMs: 1000, leaseMs: 1000 }),
    /shorter than leaseMs/,
  );
});

test('a discarded predecessor no longer blocks its aggregate', async () => {
  const { events, claim, prisma } = memoryOutbox([
    { aggregateId: 'inv-1', sequence: 1, type: 'invoice.paid', status: 'dead', attempts: 10, replayCount: 5 },
    { aggregateId: 'inv-1', sequence: 2, type: 'invoice.paid' },
  ]);
  const delivered = [];
  const subscribers = [{ name: 'spy', types: null, handle: (event) => delivered.push(event.sequence) }];
  const options = { claim, subscribers, runInTenant: inTenant, logger: silent };
  assert.equal((await dispatchDomainEvents(prisma, options)).claimed, 0, 'dead predecessor blocks');
  events[0].status = 'discarded';
  events[0].discardedAt = new Date();
  await dispatchDomainEvents(prisma, options);
  assert.deepEqual(delivered, [2]);
  assert.equal(events[0].status, 'discarded', 'discarded events are never delivered');
});

test('the subscriber registry filters by type and refuses duplicates', () => {
  registerDomainEventSubscriber({ name: 'test-contracts', types: ['contract.signed'], handle: () => {} });
  try {
    assert.throws(() => registerDomainEventSubscriber({ name: 'test-contracts', types: '*', handle: () => {} }), /already registered/);
    assert.deepEqual(subscribersFor('contract.signed').map((s) => s.name), ['journal', 'test-contracts']);
    assert.deepEqual(subscribersFor('invoice.paid').map((s) => s.name), ['journal']);
  } finally {
    unregisterDomainEventSubscriber('test-contracts');
  }
});

// ─── Replay ──────────────────────────────────────────────────────────────────

test('replay requeues only this tenant\'s dead events, within the per-event limit', async () => {
  const outbox = outboxStore();
  const seed = (id, organizationId, status, replayCount = 0) => outbox.events.push({
    id, organizationId, status, replayCount, attempts: 10, type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1,
  });
  seed('dead-a', 'org-a', 'dead');
  seed('published-a', 'org-a', 'published');
  seed('exhausted-a', 'org-a', 'dead', 5);
  seed('dead-b', 'org-b', 'dead');
  const scopedA = createScopedPrisma({ domainEvent: outbox.domainEvent }, 'org-a');
  const now = new Date('2026-09-26T00:00:00Z');

  const result = await replayDeadDomainEvents(scopedA, ['dead-a', 'published-a', 'exhausted-a', 'dead-b', 'missing'], { now });
  assert.deepEqual(result.requeued.map((event) => [event.id, event.replayCount, event.previousAttempts]), [['dead-a', 1, 10]]);
  assert.deepEqual(result.skipped, [
    { id: 'published-a', reason: 'not_dead' },
    { id: 'exhausted-a', reason: 'replay_limit' },
    { id: 'dead-b', reason: 'not_found' },
    { id: 'missing', reason: 'not_found' },
  ]);
  const row = outbox.events.find((event) => event.id === 'dead-a');
  assert.deepEqual([row.status, row.attempts, row.replayCount, row.nextAttemptAt], ['pending', 0, 1, now]);
  assert.equal(outbox.events.find((event) => event.id === 'dead-b').status, 'dead', 'other tenant untouched');

  await assert.rejects(replayDeadDomainEvents(scopedA, []), /between 1 and/);
  await assert.rejects(replayDeadDomainEvents(scopedA, Array.from({ length: MAX_REPLAY_BATCH + 1 }, (_, i) => `e${i}`)), /between 1 and/);
});

test('discard settles only this tenant\'s dead events', async () => {
  const outbox = outboxStore();
  const seed = (id, organizationId, status) => outbox.events.push({
    id, organizationId, status, replayCount: 5, attempts: 10, type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1,
  });
  seed('dead-a', 'org-a', 'dead');
  seed('pending-a', 'org-a', 'pending');
  seed('dead-b', 'org-b', 'dead');
  const scopedA = createScopedPrisma({ domainEvent: outbox.domainEvent }, 'org-a');
  const now = new Date('2026-09-26T00:00:00Z');
  const result = await discardDeadDomainEvents(scopedA, ['dead-a', 'pending-a', 'dead-b'], { now });
  assert.deepEqual(result.discarded.map((event) => event.id), ['dead-a']);
  assert.deepEqual(result.skipped, [{ id: 'pending-a', reason: 'not_dead' }, { id: 'dead-b', reason: 'not_found' }]);
  const row = outbox.events.find((event) => event.id === 'dead-a');
  assert.deepEqual([row.status, row.discardedAt], ['discarded', now]);
  assert.equal(outbox.events.find((event) => event.id === 'dead-b').status, 'dead');
  await assert.rejects(discardDeadDomainEvents(scopedA, []), /between 1 and/);
});

// ─── Producers ───────────────────────────────────────────────────────────────

test('producers normalize out-of-shape business data instead of failing the write', async () => {
  const { outbox, tx } = fakeTx();
  const paid = await recordInvoicePaid(tx, {
    organizationId: 'org-1',
    invoice: { id: 'inv-legacy', clientId: 'client 1 (old import)', total: Number.NaN, currency: 'C$' },
    paymentId: 'pay-1', amount: Number.POSITIVE_INFINITY, method: 'E TRANSFER', source: 'manual', paidAt: new Date('not a date'),
  });
  const payload = paid.event.payload;
  assert.equal(payload.currency, UNKNOWN_CURRENCY);
  assert.equal(payload.total, 0);
  assert.equal(payload.amount, 0);
  assert.equal(payload.method, 'UNKNOWN');
  assert.match(payload.clientId, /^invalid-[0-9a-f]{32}$/);
  assert.match(payload.paidAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(payload.dataIssues.sort(), ['amount', 'clientId', 'currency', 'method', 'paidAt', 'total']);
  // Deterministic: the same bad id always maps to the same id.
  const again = await recordInvoicePaid(tx, {
    organizationId: 'org-1',
    invoice: { id: 'inv-legacy-2', clientId: 'client 1 (old import)', total: 10, currency: null },
    paymentId: 'pay-2', amount: 10, method: 'OTHER', source: 'manual', paidAt: new Date(PAID_AT),
  });
  assert.equal(again.event.payload.clientId, payload.clientId);
  assert.equal(again.event.payload.currency, 'CAD', 'a missing currency defaults to CAD, like Stripe checkout');
  assert.deepEqual(again.event.payload.dataIssues, ['clientId'], 'only the out-of-shape field is flagged');
  const clean = await recordInvoicePaid(tx, {
    organizationId: 'org-1', invoice: { id: 'inv-clean', clientId: 'client-1', total: 10, currency: 'usd' },
    paymentId: 'pay-3', amount: 10, method: 'OTHER', source: 'manual', paidAt: new Date(PAID_AT),
  });
  assert.equal(clean.event.payload.dataIssues, undefined, 'clean data carries no dataIssues');
  assert.equal(clean.event.payload.currency, 'USD');

  const approved = await recordProposalApproved(tx, {
    organizationId: 'org-1', proposal: { id: 'prop-1', clientId: 'client-1', projectId: 'bad id!', total: undefined },
    via: 'public_link', approvedAt: new Date(PAID_AT),
  });
  assert.deepEqual(approved.event.payload.dataIssues.sort(), ['projectId', 'total']);
  const signed = await recordContractSigned(tx, {
    organizationId: 'org-1', contract: { id: 'k-1', clientId: 'client-1', proposalId: null },
    signingMethod: 'stamp', documentHash: 'nope', via: 'portal_link', signedAt: new Date(PAID_AT),
  });
  assert.deepEqual(signed.event.payload.dataIssues.sort(), ['documentHash', 'signingMethod']);
  assert.match(signed.event.payload.documentHash, /^[0-9a-f]{64}$/);
  assert.equal(outbox.events.length, 5);
});

test('idempotency keys stay within the column limit deterministically', () => {
  assert.equal(idempotencyKeyFor('invoice.paid', 'inv-1', 'pay-1'), 'invoice.paid:inv-1:pay-1');
  const long = idempotencyKeyFor('invoice.paid', 'a'.repeat(191), 'b'.repeat(191));
  assert.ok(long.length <= 255);
  assert.equal(long, idempotencyKeyFor('invoice.paid', 'a'.repeat(191), 'b'.repeat(191)));
  assert.match(long, /^invoice\.paid:sha256:[0-9a-f]{64}$/);
});

// ─── Admin route ─────────────────────────────────────────────────────────────

const ADMIN = { id: 'admin-1', role: 'ADMIN', organizationId: 'org-a' };

async function buildRouteApp(t, user = ADMIN) {
  const outbox = outboxStore();
  outbox.events.push(
    { id: 'dead-a', organizationId: 'org-a', status: 'dead', replayCount: 0, attempts: 10, type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1, occurredAt: new Date('2026-09-02T00:00:00Z'), payload: {} },
    { id: 'ok-a', organizationId: 'org-a', status: 'published', replayCount: 0, attempts: 1, type: 'proposal.approved', aggregateType: 'proposal', aggregateId: 'p-1', sequence: 1, occurredAt: new Date('2026-09-01T00:00:00Z'), payload: {} },
    { id: 'dead-b', organizationId: 'org-b', status: 'dead', replayCount: 0, attempts: 10, type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-9', sequence: 1, occurredAt: new Date('2026-09-03T00:00:00Z'), payload: {} },
  );
  const audits = [];
  const base = {
    domainEvent: {
      ...outbox.domainEvent,
      findMany: async ({ where, take, select }) => (await outbox.domainEvent.findMany({ where: flatten(where) }))
        .sort((a, b) => b.occurredAt - a.occurredAt).slice(0, take)
        .map((row) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key] ?? null])) : row)),
    },
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const principal = user ? withSession(user) : null;
  app.decorate('adminOnly', async (request, reply) => {
    request.user = principal;
    if (principal?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
  });
  app.addHook('onRequest', async (request) => {
    request.prisma = createScopedPrisma(base, 'org-a');
  });
  await app.register(domainEventRoutes);
  t.after(() => app.close());
  return { app, outbox, audits };
}

// Reduce the route's { AND: [...] } where (plus the proxy's organizationId)
// to the flat equality filter the fake store understands.
function flatten(where = {}) {
  const flat = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') for (const part of value) Object.assign(flat, flatten(part));
    else flat[key] = value;
  }
  return flat;
}

test('GET /api/domain-events lists only the caller\'s organization, filterable by status', async (t) => {
  const { app } = await buildRouteApp(t);
  const all = await app.inject({ method: 'GET', url: '/' });
  assert.equal(all.statusCode, 200, all.body);
  assert.deepEqual(all.json().events.map((event) => event.id), ['dead-a', 'ok-a']);
  const dead = await app.inject({ method: 'GET', url: '/?status=dead' });
  assert.deepEqual(dead.json().events.map((event) => event.id), ['dead-a']);
  assert.equal((await app.inject({ method: 'GET', url: '/?status=exploded' })).statusCode, 400);
});

test('POST /api/domain-events/replay needs an admin with step-up and audits each requeue', async (t) => {
  const { app, outbox, audits } = await buildRouteApp(t);
  const payload = { eventIds: ['dead-a', 'dead-b', 'ok-a'] };

  const noStepUp = await app.inject({ method: 'POST', url: '/replay', payload });
  assert.equal(noStepUp.statusCode, 403);
  assert.equal(noStepUp.json().code, 'REAUTH_REQUIRED');
  assert.equal(outbox.events.find((event) => event.id === 'dead-a').status, 'dead');

  const response = await app.inject({ method: 'POST', url: '/replay', payload, cookies: reauthCookies(ADMIN) });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().requeued, ['dead-a']);
  assert.deepEqual(response.json().skipped, [{ id: 'dead-b', reason: 'not_found' }, { id: 'ok-a', reason: 'not_dead' }]);
  assert.equal(outbox.events.find((event) => event.id === 'dead-b').status, 'dead');
  assert.equal(audits.length, 1);
  assert.deepEqual(
    [audits[0].action, audits[0].entityType, audits[0].entityId, audits[0].organizationId, audits[0].actorUserId],
    ['domain_event.replayed', 'domain_event', 'dead-a', 'org-a', 'admin-1'],
  );
  assert.deepEqual(audits[0].metadata, {
    type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1,
    fromStatus: 'dead', toStatus: 'pending', replayCount: 1, previousAttempts: 10,
  });

  const invalid = await app.inject({ method: 'POST', url: '/replay', payload: { eventIds: [] }, cookies: reauthCookies(ADMIN) });
  assert.equal(invalid.statusCode, 400);
});

test('POST /api/domain-events/discard needs an admin with step-up, a reason, and audits each discard', async (t) => {
  const { app, outbox, audits } = await buildRouteApp(t);
  const payload = { eventIds: ['dead-a', 'dead-b', 'ok-a'], reason: 'poison_payload' };
  const noStepUp = await app.inject({ method: 'POST', url: '/discard', payload });
  assert.equal(noStepUp.statusCode, 403);
  assert.equal(outbox.events.find((event) => event.id === 'dead-a').status, 'dead');
  const noReason = await app.inject({ method: 'POST', url: '/discard', payload: { eventIds: ['dead-a'] }, cookies: reauthCookies(ADMIN) });
  assert.equal(noReason.statusCode, 400);

  const response = await app.inject({ method: 'POST', url: '/discard', payload, cookies: reauthCookies(ADMIN) });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    discarded: ['dead-a'],
    skipped: [{ id: 'dead-b', reason: 'not_found' }, { id: 'ok-a', reason: 'not_dead' }],
  });
  const row = outbox.events.find((event) => event.id === 'dead-a');
  assert.equal(row.status, 'discarded');
  assert.ok(row.discardedAt instanceof Date);
  assert.equal(outbox.events.find((event) => event.id === 'dead-b').status, 'dead');
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].action, audits[0].entityId, audits[0].organizationId], ['domain_event.discarded', 'dead-a', 'org-a']);
  assert.deepEqual(audits[0].metadata, {
    type: 'invoice.paid', aggregateType: 'invoice', aggregateId: 'inv-1', sequence: 1,
    fromStatus: 'dead', toStatus: 'discarded', reason: 'poison_payload', replayCount: 0, previousAttempts: 10,
  });
  // A discarded event cannot be replayed.
  const replay = await app.inject({ method: 'POST', url: '/replay', payload: { eventIds: ['dead-a'] }, cookies: reauthCookies(ADMIN) });
  assert.deepEqual(replay.json().skipped, [{ id: 'dead-a', reason: 'not_dead' }]);
});

test('non-admins cannot read or replay the outbox', async (t) => {
  const staff = { id: 'staff-1', role: 'STAFF', organizationId: 'org-a' };
  const { app } = await buildRouteApp(t, staff);
  assert.equal((await app.inject({ method: 'GET', url: '/' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/replay', payload: { eventIds: ['dead-a'] }, cookies: reauthCookies(staff) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/discard', payload: { eventIds: ['dead-a'], reason: 'other' }, cookies: reauthCookies(staff) })).statusCode, 403);
});
