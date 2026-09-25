import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  AUDIT_ACTIONS,
  AUDIT_EVENT_CATALOG,
  actorTypeForRole,
  auditContextFromRequest,
  recordAuditEvent,
  recordRequestAuditEvent,
  sanitizeAuditMetadata,
  truncateIp,
} from '../../services/audit-event.service.js';
import { createScopedPrisma, tenantModelPolicy } from '../../utils/prisma-tenant-proxy.js';

function silentLogger() {
  const calls = { warn: [], error: [] };
  return {
    calls,
    warn: (...args) => calls.warn.push(args),
    error: (...args) => calls.error.push(args),
  };
}

function capturingPrisma(extra = {}) {
  const writes = [];
  return {
    writes,
    auditEvent: { create: async ({ data }) => { writes.push(data); return { id: `audit-${writes.length}`, ...data }; } },
    ...extra,
  };
}

test('a failed audit write is logged and never thrown into the business action', async () => {
  const logger = silentLogger();
  const prisma = { auditEvent: { create: async () => { throw Object.assign(new Error('db down'), { code: 'P1001' }); } } };
  const result = await recordAuditEvent(prisma, {
    organizationId: 'org-1', actorType: 'USER', action: 'invoice.sent', entityId: 'inv-1',
    metadata: { total: 10 },
  }, { logger });
  assert.equal(result, null);
  assert.equal(logger.calls.error.length, 1);
  assert.match(logger.calls.error[0][1], /write failed/);
  // The log carries the action but never the metadata payload.
  assert.doesNotMatch(JSON.stringify(logger.calls.error), /"total"/);
});

test('a prisma client without the audit delegate cannot break the caller', async () => {
  const logger = silentLogger();
  const result = await recordAuditEvent({}, { organizationId: 'org-1', actorType: 'USER', action: 'invoice.sent' }, { logger });
  assert.equal(result, null);
  assert.equal(logger.calls.error.length, 1);
});

test('unknown actions, unknown actor types and ownerless events are dropped, not written', async () => {
  const prisma = capturingPrisma({ client: { findUnique: async () => null } });
  const logger = silentLogger();
  assert.equal(await recordAuditEvent(prisma, { organizationId: 'org-1', actorType: 'USER', action: 'invoice.hacked' }, { logger }), null);
  assert.equal(await recordAuditEvent(prisma, { organizationId: 'org-1', actorType: 'ROOT', action: 'invoice.sent' }, { logger }), null);
  assert.equal(await recordAuditEvent(prisma, { ownerClientId: 'missing', actorType: 'CLIENT', action: 'proposal.approved' }, { logger }), null);
  assert.equal(await recordAuditEvent(prisma, null, { logger }), null);
  assert.equal(prisma.writes.length, 0);
  assert.equal(logger.calls.warn.length, 4);
});

test('writes the catalog entity type, truncated ip and sanitized metadata', async () => {
  const prisma = capturingPrisma();
  const row = await recordAuditEvent(prisma, {
    organizationId: 'org-1', actorUserId: 'user-1', actorType: 'USER', action: 'payment.recorded',
    entityId: 'pay-1', requestId: 'req-7', ip: '203.0.113.77',
    metadata: { amount: 125.5, method: 'CHEQUE', password: 'hunter2', clientEmail: 'a@b.test', nested: { x: 1 } },
  });
  assert.equal(row.id, 'audit-1');
  assert.deepEqual(prisma.writes[0], {
    organizationId: 'org-1', actorUserId: 'user-1', actorType: 'USER', action: 'payment.recorded',
    entityType: 'invoice_payment', entityId: 'pay-1', requestId: 'req-7', ip: '203.0.113.0/24',
    metadata: { amount: 125.5, method: 'CHEQUE' },
  });
});

test('public and webhook events resolve their tenant from the owning client or invoice', async () => {
  const prisma = capturingPrisma({
    client: { findUnique: async ({ where }) => (where.id === 'client-1' ? { organizationId: 'org-c' } : null) },
    invoice: { findUnique: async ({ where }) => (where.id === 'inv-1' ? { client: { organizationId: 'org-i' } } : null) },
  });
  await recordAuditEvent(prisma, { ownerClientId: 'client-1', actorType: 'CLIENT', action: 'contract.signed', entityId: 'k-1' });
  await recordAuditEvent(prisma, { ownerInvoiceId: 'inv-1', actorType: 'WEBHOOK', action: 'invoice.paid', entityId: 'inv-1' });
  assert.deepEqual(prisma.writes.map((row) => row.organizationId), ['org-c', 'org-i']);
});

test('ip addresses are reduced to a network prefix', () => {
  assert.equal(truncateIp('198.51.100.23'), '198.51.100.0/24');
  assert.equal(truncateIp('::ffff:198.51.100.23'), '198.51.100.0/24');
  assert.equal(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::/48');
  assert.equal(truncateIp('2001:db8::1'), '2001:db8:0::/48');
  assert.equal(truncateIp('::1'), '0:0:0::/48');
  assert.equal(truncateIp('not-an-ip'), null);
  assert.equal(truncateIp(undefined), null);
});

test('metadata keeps only the fields the action allows, as bounded primitives', () => {
  // Allowed names are kept even when they contain words a denylist would
  // reject ("session"), and everything unlisted is dropped.
  assert.deepEqual(
    sanitizeAuditMetadata({ method: 'self_service', sessionsRevoked: true, password: 'x', apiKey: 'y', ok: true }, 'auth.password_changed'),
    { method: 'self_service', sessionsRevoked: true },
  );
  assert.deepEqual(
    sanitizeAuditMetadata({ ownerUserId: 'user-1', expires: false, rawKey: 'ashbi_x' }, 'api_key.created'),
    { ownerUserId: 'user-1', expires: false },
  );
  // Strings must be short id/code values: free text and oversized values are
  // dropped rather than truncated.
  assert.deepEqual(
    sanitizeAuditMetadata({ fromStatus: 'SENT', toStatus: 'paid by cheque #12 from Jane', via: 'x'.repeat(129) }, 'proposal.approved'),
    { fromStatus: 'SENT' },
  );
  assert.deepEqual(
    sanitizeAuditMetadata({ total: Number.NaN, amount: 12.5, invoiceId: { nested: true }, currency: null }, 'payment.recorded'),
    { amount: 12.5, currency: null },
  );
  assert.deepEqual(sanitizeAuditMetadata({ fromModel: new Date('2026-01-01T00:00:00Z') }, 'settings.ai_provider_changed'), { fromModel: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(sanitizeAuditMetadata({ method: 'x' }, 'unknown.action'), {});
  assert.deepEqual(sanitizeAuditMetadata(['a'], 'auth.password_changed'), {});
  assert.deepEqual(sanitizeAuditMetadata('str', 'auth.password_changed'), {});
});

test('every catalog action declares a metadata allowlist', () => {
  for (const [action, spec] of Object.entries(AUDIT_EVENT_CATALOG)) {
    assert.equal(AUDIT_ACTIONS[action], spec.entityType);
    assert.ok(Array.isArray(spec.metadata) && spec.metadata.length > 0, action);
  }
});

test('request context uses the Fastify request id as the correlation id', async () => {
  const request = { id: 'req-42', ip: '192.0.2.9', user: { id: 'user-1', role: 'CLIENT', organizationId: 'org-1' } };
  assert.deepEqual(auditContextFromRequest(request), {
    organizationId: 'org-1', actorUserId: 'user-1', actorType: 'CLIENT', requestId: 'req-42', ip: '192.0.2.9',
  });
  assert.equal(actorTypeForRole('BOT'), 'BOT');
  assert.equal(actorTypeForRole('ADMIN'), 'USER');

  const prisma = capturingPrisma();
  await recordRequestAuditEvent(prisma, request, { action: 'api_key.created', entityId: 'key-1', actorType: undefined });
  assert.equal(prisma.writes[0].requestId, 'req-42');
  assert.equal(prisma.writes[0].actorType, 'CLIENT', 'undefined overrides keep the derived value');
  assert.equal(prisma.writes[0].ip, '192.0.2.0/24');
});

test('the tenant proxy scopes audit reads and forbids every mutation path', async () => {
  assert.equal(tenantModelPolicy.auditevent, 'direct');
  const calls = [];
  const delegate = {
    findMany: async (args) => { calls.push(['findMany', args]); return []; },
    create: async (args) => { calls.push(['create', args]); return args.data; },
    update: async () => { throw new Error('update must not reach the client'); },
    updateMany: async () => { throw new Error('updateMany must not reach the client'); },
    upsert: async () => { throw new Error('upsert must not reach the client'); },
    delete: async () => { throw new Error('delete must not reach the client'); },
    deleteMany: async () => { throw new Error('deleteMany must not reach the client'); },
  };
  const scoped = createScopedPrisma({ auditEvent: delegate }, 'org-a');

  await scoped.auditEvent.findMany({ where: { organizationId: 'org-b', action: 'invoice.sent' } });
  assert.deepEqual(calls[0][1].where, { organizationId: 'org-a', action: 'invoice.sent' });

  await scoped.auditEvent.create({ data: { organizationId: 'org-b', action: 'invoice.sent' } });
  assert.equal(calls[1][1].data.organizationId, 'org-a', 'a forged tenant is overwritten on write');

  for (const method of ['update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    await assert.rejects(scoped.auditEvent[method]({ where: { id: 'a' }, data: {} }), /append-only/, method);
  }
});

test('the migration makes audit events append-only at the database level', () => {
  const migration = fs.readFileSync(new URL('../../../prisma/migrations/20260925130500_audit_events/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "audit_events"/);
  assert.match(migration, /BEFORE TRUNCATE ON "audit_events"/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /"actorType" IN \('USER', 'CLIENT', 'SYSTEM', 'WEBHOOK', 'BOT'\)/);
  assert.doesNotMatch(migration, /DROP |ALTER TABLE "(?!audit_events)/, 'the migration is additive only');
});

test('the admin API exposes no write route and the catalog is documented', () => {
  const routes = fs.readFileSync(new URL('../../routes/audit-event.routes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /fastify\.(post|put|patch|delete)\(/);
  assert.doesNotMatch(routes, /auditEvent\.(create|update|upsert|delete)/);
  const doc = fs.readFileSync(new URL('../../../docs/audit-events.md', import.meta.url), 'utf8');
  for (const action of Object.keys(AUDIT_ACTIONS)) {
    assert.match(doc, new RegExp(`\`${action.replace('.', '\\.')}\``), `${action} is documented`);
  }
  assert.match(doc, /#310/);
});
