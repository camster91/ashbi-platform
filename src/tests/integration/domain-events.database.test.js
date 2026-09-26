// Real-database proof of the transactional outbox (#412, docs/event-outbox.md):
// concurrent producers get distinct contiguous sequences, idempotency keys
// dedupe, a rolled-back business transaction leaves no event, SKIP LOCKED
// claims never double-deliver, ordering holds per aggregate, the envelope is
// immutable, and tenants cannot see each other's events.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { withSoftDelete } from '../../services/soft-delete.service.js';
import { recordDomainEvent } from '../../services/domain-event.service.js';
import { recordInvoicePaid } from '../../services/domain-event-producers.js';
import {
  claimDomainEvents,
  dispatchDomainEvents,
  replayDeadDomainEvents,
} from '../../services/domain-event-dispatcher.service.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };

function paidEvent(organizationId, invoiceId, paymentId, overrides = {}) {
  return {
    type: 'invoice.paid',
    organizationId,
    aggregateId: invoiceId,
    idempotencyKey: `invoice.paid:${invoiceId}:${paymentId}`,
    correlationId: `req-${paymentId}`,
    payload: {
      invoiceId, clientId: 'client-x', paymentId, total: 10, currency: 'CAD', method: 'OTHER', source: 'manual',
      paidAt: '2026-09-26T00:00:00.000Z',
    },
    ...overrides,
  };
}

test('the domain event outbox is transactional, ordered, idempotent and tenant-scoped', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 20 }) });
  // Application code runs on the soft-delete-wrapped client (src/config/db.js).
  const db = withSoftDelete(raw);
  const suffix = randomUUID();
  const orgA = `outbox-org-a-${suffix}`;
  const orgB = `outbox-org-b-${suffix}`;
  const ours = { organizationId: { in: [orgA, orgB] } };

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Outbox Tenant A', slug: `outbox-a-${suffix}` },
      { id: orgB, name: 'Outbox Tenant B', slug: `outbox-b-${suffix}` },
    ] });

    // ── Concurrent producers on one aggregate: distinct, contiguous sequences.
    const producers = Array.from({ length: 12 }, (_, index) => db.$transaction(
      (tx) => recordDomainEvent(tx, paidEvent(orgA, 'inv-hot', `pay-${index}`)),
      { timeout: 30_000, maxWait: 30_000 },
    ));
    const produced = await Promise.all(producers);
    assert.deepEqual(
      produced.map(({ event }) => event.sequence).sort((a, b) => a - b),
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    assert.ok(produced.every(({ duplicate }) => duplicate === false));

    // ── Concurrent retries of one fact: a single row, one original.
    const retries = await Promise.all(Array.from({ length: 6 }, () => db.$transaction(
      (tx) => recordDomainEvent(tx, paidEvent(orgA, 'inv-dup', 'pay-once')),
      { timeout: 30_000, maxWait: 30_000 },
    )));
    assert.equal(retries.filter(({ duplicate }) => !duplicate).length, 1);
    assert.equal(new Set(retries.map(({ event }) => event.id)).size, 1);
    assert.equal(await raw.domainEvent.count({ where: { organizationId: orgA, aggregateId: 'inv-dup' } }), 1);
    // A key reused for another aggregate aborts the transaction.
    await assert.rejects(
      db.$transaction((tx) => recordDomainEvent(tx, paidEvent(orgA, 'inv-other', 'pay-once', { idempotencyKey: 'invoice.paid:inv-dup:pay-once' }))),
      /Idempotency key already used/,
    );

    // ── A rolled-back business transaction leaves neither the change nor the event.
    const user = await raw.user.create({ data: { organizationId: orgA, email: `outbox-${suffix}@example.test`, name: 'Outbox', password: 'x' } });
    const client = await raw.client.create({ data: { name: 'Outbox Client', organizationId: orgA } });
    const invoice = await raw.invoice.create({ data: {
      invoiceNumber: `OUTBOX-${suffix}`, clientId: client.id, createdById: user.id, total: 113, currency: 'CAD', status: 'SENT',
    } });
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      const payment = await tx.invoicePayment.create({ data: { invoiceId: invoice.id, amount: 113, method: 'OTHER' } });
      await recordInvoicePaid(tx, { invoice, paymentId: payment.id, method: 'OTHER', source: 'manual', paidAt: new Date(), correlationId: 'req-rollback' });
      throw new Error('business rule failed after the event was written');
    }), /business rule failed/);
    assert.equal((await raw.invoice.findUnique({ where: { id: invoice.id } })).status, 'SENT');
    assert.equal(await raw.domainEvent.count({ where: { organizationId: orgA, aggregateId: invoice.id } }), 0);
    // An invalid payload aborts the business write too.
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      await recordDomainEvent(tx, paidEvent(orgA, invoice.id, 'p', { payload: { invoiceId: invoice.id } }));
    }), /Invalid invoice.paid/);
    assert.equal((await raw.invoice.findUnique({ where: { id: invoice.id } })).status, 'SENT');
    // The committed path, with the owner resolved from the client (public/webhook producers).
    const committed = await db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      const payment = await tx.invoicePayment.create({ data: { invoiceId: invoice.id, amount: 113, method: 'STRIPE' } });
      return recordInvoicePaid(tx, { invoice, paymentId: payment.id, method: 'STRIPE', source: 'stripe_checkout', paidAt: new Date(), correlationId: 'req-ok', causationId: 'stripe:evt_1' });
    });
    assert.equal(committed.event.organizationId, orgA);
    assert.equal(committed.event.causationId, 'stripe:evt_1');

    // ── Tenant isolation through the request-scoped proxy.
    const tenantA = createScopedPrisma(raw, orgA);
    const tenantB = createScopedPrisma(raw, orgB);
    const bEvent = await tenantB.$transaction((tx) => recordDomainEvent(tx, paidEvent(orgB, 'inv-hot', 'pay-0')));
    assert.equal(bEvent.duplicate, false, 'tenant A\'s identical key is invisible to tenant B');
    assert.equal(bEvent.event.sequence, 1, 'sequences are per tenant');
    assert.equal(await tenantB.domainEvent.count({}), 1);
    assert.equal(await tenantB.domainEvent.findFirst({ where: { id: committed.event.id } }), null);
    assert.equal((await tenantA.domainEvent.findMany({ where: { id: bEvent.event.id } })).length, 0);
    await assert.rejects(tenantA.domainEvent.deleteMany({}), /not permitted/);
    await assert.rejects(tenantA.domainEvent.updateMany({ where: {}, data: { payload: {} } }), /immutable/);

    // ── Database-level guarantees.
    await assert.rejects(raw.domainEvent.update({ where: { id: committed.event.id }, data: { payload: { tampered: true } } }), /envelope is immutable/);
    await assert.rejects(raw.$executeRawUnsafe('UPDATE "domain_events" SET "sequence" = 99 WHERE "id" = $1', committed.event.id), /envelope is immutable/);
    await assert.rejects(raw.domainEvent.update({ where: { id: committed.event.id }, data: { status: 'exploded' } }), /status_check/);
    await assert.rejects(raw.domainEvent.update({ where: { id: committed.event.id }, data: { status: 'published' } }), /published_at_check/);
    await assert.rejects(raw.domainEvent.create({ data: {
      organizationId: orgA, type: 'Invoice Paid', schemaVersion: 1, aggregateType: 'invoice', aggregateId: 'x', sequence: 1,
      payload: {}, correlationId: 'c', idempotencyKey: 'bad-type',
    } }), /type_format_check/);
    await assert.rejects(raw.domainEvent.create({ data: {
      organizationId: orgA, type: 'invoice.paid', schemaVersion: 1, aggregateType: 'invoice', aggregateId: 'x', sequence: 1,
      payload: [], correlationId: 'c', idempotencyKey: 'bad-payload',
    } }), /payload_object_check/);

    // ── SKIP LOCKED: concurrent claimers never share a row; order holds.
    // Only aggregate heads are claimable: inv-hot sequence 1 (A and B), inv-dup,
    // and the committed invoice. Add 16 single-event aggregates.
    for (let index = 0; index < 16; index += 1) {
      await db.$transaction((tx) => recordDomainEvent(tx, paidEvent(orgA, `inv-spread-${index}`, 'pay')));
    }
    const concurrentClaims = await Promise.all(Array.from({ length: 5 }, () => claimDomainEvents(raw, { limit: 10 })));
    const claimedIds = concurrentClaims.flat().filter((row) => row.organizationId === orgA || row.organizationId === orgB).map((row) => row.id);
    assert.equal(new Set(claimedIds).size, claimedIds.length, 'no row was claimed twice');
    const claimedHot = concurrentClaims.flat().filter((row) => row.organizationId === orgA && row.aggregateId === 'inv-hot');
    assert.deepEqual(claimedHot.map((row) => row.sequence), [1], 'only the head of an aggregate is claimable');
    assert.equal(claimedIds.length, 20, '16 spread + inv-hot(A) + inv-hot(B) + inv-dup + committed invoice');
    // Put the claims back to pending so the dispatcher can deliver them.
    await raw.domainEvent.updateMany({ where: { ...ours, status: 'dispatching' }, data: { status: 'pending', lockedUntil: null, claimToken: null } });

    // ── Two concurrent dispatchers deliver every event exactly once, in order.
    const deliveries = [];
    const subscribers = [{ name: 'spy', types: null, handle: (event) => { deliveries.push(event); } }];
    const ourEvent = (event) => event.organizationId === orgA || event.organizationId === orgB;
    await Promise.all([
      dispatchDomainEvents(raw, { subscribers, logger: silent, batchSize: 5, maxRounds: 50 }),
      dispatchDomainEvents(raw, { subscribers, logger: silent, batchSize: 5, maxRounds: 50 }),
    ]);
    const mine = deliveries.filter(ourEvent);
    const total = await raw.domainEvent.count({ where: ours });
    assert.equal(mine.length, total, 'every event delivered');
    assert.equal(new Set(mine.map((event) => event.id)).size, mine.length, 'no event delivered twice');
    assert.equal(await raw.domainEvent.count({ where: { ...ours, status: { not: 'published' } } }), 0);
    const hotOrder = mine.filter((event) => event.organizationId === orgA && event.aggregateId === 'inv-hot').map((event) => event.sequence);
    assert.deepEqual(hotOrder, Array.from({ length: 12 }, (_, index) => index + 1), 'per-aggregate order');

    // ── Dead-lettering, tenant-scoped replay, redelivery.
    const failing = await db.$transaction((tx) => recordDomainEvent(tx, paidEvent(orgA, 'inv-fail', 'pay-1')));
    const blocked = await db.$transaction((tx) => recordDomainEvent(tx, paidEvent(orgA, 'inv-fail', 'pay-2')));
    const boom = [{ name: 'boom', types: null, handle: (event) => { if (event.organizationId === orgA && event.aggregateId === 'inv-fail') throw new Error('downstream down'); } }];
    const failed = await dispatchDomainEvents(raw, { subscribers: boom, logger: silent, maxAttempts: 1 });
    assert.ok(failed.dead >= 1);
    const deadRow = await raw.domainEvent.findUnique({ where: { id: failing.event.id } });
    assert.deepEqual([deadRow.status, deadRow.attempts, deadRow.lastError], ['dead', 1, 'Error: downstream down']);
    assert.equal((await raw.domainEvent.findUnique({ where: { id: blocked.event.id } })).status, 'pending', 'successor blocked');

    const foreign = await replayDeadDomainEvents(tenantB, [failing.event.id]);
    assert.deepEqual(foreign, { requeued: [], skipped: [{ id: failing.event.id, reason: 'not_found' }] });
    const replayed = await replayDeadDomainEvents(tenantA, [failing.event.id]);
    assert.deepEqual(replayed.requeued.map((event) => event.id), [failing.event.id]);
    const again = await replayDeadDomainEvents(tenantA, [failing.event.id]);
    assert.deepEqual(again.skipped, [{ id: failing.event.id, reason: 'not_dead' }]);

    const redelivered = [];
    await dispatchDomainEvents(raw, { subscribers: [{ name: 'ok', types: null, handle: (event) => { if (ourEvent(event)) redelivered.push(event.id); } }], logger: silent });
    assert.deepEqual(redelivered, [failing.event.id, blocked.event.id], 'replayed head first, then its successor');
    const replayedRow = await raw.domainEvent.findUnique({ where: { id: failing.event.id } });
    assert.deepEqual([replayedRow.status, replayedRow.replayCount], ['published', 1]);

    // ── Organization deletion takes its outbox rows (delivery state, not evidence).
    await raw.domainEvent.deleteMany({ where: { organizationId: orgB } });
  } finally {
    await raw.invoicePayment.deleteMany({ where: { invoice: { client: { organizationId: { in: [orgA, orgB] } } } } }).catch(() => {});
    await raw.invoice.deleteMany({ where: { client: { organizationId: { in: [orgA, orgB] } } } }).catch(() => {});
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => {});
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => {});
    await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => {});
    assert.equal(await raw.domainEvent.count({ where: ours }), 0, 'outbox rows cascade with their organization');
    await raw.$disconnect();
  }
});
