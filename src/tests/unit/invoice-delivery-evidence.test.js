import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deliveryService = await import('../../services/invoiceDelivery.service.js').catch(() => ({}));

function harness() {
  const state = { nextAttempt: 0, attempts: [], events: [] };
  const delegates = {
    invoice: {
      update: async () => ({ emailDeliveryAttempt: ++state.nextAttempt }),
    },
    invoiceDeliveryAttempt: {
      findUnique: async ({ where }) => structuredClone(
        state.attempts.find(item => item.requestId === where.requestId) || null,
      ),
      create: async ({ data }) => {
        const created = { id: `attempt-${state.attempts.length + 1}`, ...structuredClone(data) };
        state.attempts.push(created);
        return structuredClone(created);
      },
      update: async ({ where, data }) => {
        const item = state.attempts.find(attempt => attempt.id === where.id);
        Object.assign(item, structuredClone(data));
        return structuredClone(item);
      },
    },
    invoiceDeliveryEvent: {
      create: async ({ data }) => {
        const created = { id: `event-${state.events.length + 1}`, ...structuredClone(data) };
        state.events.push(created);
        return structuredClone(created);
      },
    },
  };
  return {
    state,
    prisma: { ...delegates, $transaction: callback => callback(delegates) },
  };
}

const input = {
  invoiceId: 'invoice-1',
  requestId: 'delivery-request-1',
  kind: 'INITIAL',
  recipient: 'client@example.test',
  actorUserId: 'user-1',
  email: { invoiceNumber: 'INV-001' },
};

test('provider acceptance is recorded without claiming inbox delivery', async () => {
  assert.equal(typeof deliveryService.deliverInvoiceWithEvidence, 'function');
  const { prisma, state } = harness();
  const result = await deliveryService.deliverInvoiceWithEvidence({
    prisma,
    ...input,
    sender: async () => ({ ok: true, outcome: 'PROVIDER_ACCEPTED', id: '<provider-message-1>' }),
  });

  assert.equal(result.status, 'PROVIDER_ACCEPTED');
  assert.equal(result.providerMessageId, '<provider-message-1>');
  assert.equal(state.attempts[0].status, 'PROVIDER_ACCEPTED');
  assert.deepEqual(state.events.map(event => event.status), ['PREPARED', 'PROVIDER_ACCEPTED']);
  assert.doesNotMatch(JSON.stringify(result), /DELIVERED|RECEIVED/);
});

test('a confirmed provider rejection is durable and explicitly retryable', async () => {
  const { prisma, state } = harness();
  const result = await deliveryService.deliverInvoiceWithEvidence({
    prisma,
    ...input,
    sender: async () => ({ ok: false, outcome: 'FAILED', failureCode: 'PROVIDER_REJECTED' }),
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.retryable, true);
  assert.equal(state.attempts[0].failureCode, 'PROVIDER_REJECTED');
  assert.deepEqual(state.events.map(event => event.status), ['PREPARED', 'FAILED']);
});

test('an uncertain transport result is preserved and is not presented as safe to retry', async () => {
  const { prisma, state } = harness();
  const result = await deliveryService.deliverInvoiceWithEvidence({
    prisma,
    ...input,
    sender: async () => ({ ok: false, outcome: 'OUTCOME_UNKNOWN', failureCode: 'TRANSPORT_UNKNOWN' }),
  });

  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.retryable, false);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(state.attempts[0].failureCode, 'TRANSPORT_UNKNOWN');
});

test('the same request id returns its prior attempt without sending twice', async () => {
  const { prisma, state } = harness();
  let sends = 0;
  const sender = async () => {
    sends += 1;
    return { ok: true, outcome: 'PROVIDER_ACCEPTED', id: '<provider-message-1>' };
  };

  await deliveryService.deliverInvoiceWithEvidence({ prisma, ...input, sender });
  const replay = await deliveryService.deliverInvoiceWithEvidence({ prisma, ...input, sender });

  assert.equal(sends, 1);
  assert.equal(replay.duplicate, true);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.events.length, 2);
});

test('delivery attempts are tenant-scoped and delivery events are append-only', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const tenantProxy = readFileSync('src/utils/prisma-tenant-proxy.js', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827009000_invoice_delivery_evidence/migration.sql',
    'utf8',
  );
  const invoiceModel = schema.match(/model Invoice \{[\s\S]*?\n\}/)?.[0] || '';
  const attemptModel = schema.match(/model InvoiceDeliveryAttempt \{[\s\S]*?\n\}/)?.[0] || '';
  const eventModel = schema.match(/model InvoiceDeliveryEvent \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(invoiceModel, /emailDeliveryAttempt\s+Int/);
  assert.match(invoiceModel, /deliveryAttempts\s+InvoiceDeliveryAttempt\[\]/);
  assert.match(attemptModel, /requestId\s+String\s+@unique/);
  assert.match(attemptModel, /providerMessageId\s+String\?/);
  assert.match(eventModel, /attemptId\s+String/);
  assert.match(tenantProxy, /invoicedeliveryattempt:\s*\['invoice', 'client'\]/);
  assert.match(tenantProxy, /invoicedeliveryevent:\s*\['invoice', 'client'\]/);
  assert.match(migration, /invoice_delivery_attempt_status_supported/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "invoice_delivery_events"/);
  assert.match(migration, /Invoice delivery event rows are append-only/);
});

test('invoice routes share evidence recording and expose attempts to staff', () => {
  const routes = readFileSync('src/routes/invoice.routes.js', 'utf8');
  const sendRoute = routes.slice(routes.indexOf("fastify.post('/:id/send'"), routes.indexOf('// ─── GET /:id/pdf'));
  const resendRoute = routes.slice(routes.indexOf("fastify.post('/:id/resend'"), routes.indexOf("fastify.post('/:id/public-link/rotate'"));
  const detailRoute = routes.slice(routes.indexOf("fastify.get('/:id'"), routes.indexOf("fastify.post('/',"));

  assert.match(sendRoute, /deliverInvoiceWithEvidence/);
  assert.match(resendRoute, /deliverInvoiceWithEvidence/);
  assert.match(sendRoute, /request\.prisma/);
  assert.match(resendRoute, /request\.prisma/);
  assert.match(detailRoute, /deliveryAttempts/);
});

test('staff UI labels provider acceptance and never promises inbox delivery', () => {
  const detail = readFileSync('web/src/pages/InvoiceDetail.jsx', 'utf8');
  const list = readFileSync('web/src/pages/Invoices.jsx', 'utf8');
  assert.match(detail, /Accepted by email provider/);
  assert.match(detail, /Outcome unknown/);
  assert.doesNotMatch(detail, /Client will receive an email/);
  assert.doesNotMatch(list, /Client will receive an email/);
});
