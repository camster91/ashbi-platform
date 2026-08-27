import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';

const providerEvents = await import('../../services/invoiceDeliveryProviderEvent.service.js').catch(() => ({}));
const deliveryRoutes = await import('../../routes/mailgun-invoice-delivery.routes.js').catch(() => ({}));

test('Mailgun delivery webhook signatures require a valid fresh HMAC', () => {
  assert.equal(typeof providerEvents.verifyMailgunDeliverySignature, 'function');

  const signingKey = 'sandbox-signing-key';
  const timestamp = '1787803200';
  const token = 'a'.repeat(50);
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`)
    .digest('hex');

  assert.equal(providerEvents.verifyMailgunDeliverySignature({
    signingKey,
    signature: { timestamp, token, signature },
    now: new Date('2026-08-27T04:01:00.000Z'),
  }), true);
  assert.equal(providerEvents.verifyMailgunDeliverySignature({
    signingKey,
    signature: { timestamp, token, signature: '0'.repeat(64) },
    now: new Date('2026-08-27T04:01:00.000Z'),
  }), false);
  assert.equal(providerEvents.verifyMailgunDeliverySignature({
    signingKey,
    signature: {
      timestamp: '1787760000',
      token,
      signature: crypto.createHmac('sha256', signingKey).update(`1787760000${token}`).digest('hex'),
    },
    now: new Date('2026-08-27T04:01:00.000Z'),
  }), false);
});

test('a delivered event is reduced to recipient-server acceptance evidence without message content', () => {
  assert.equal(typeof providerEvents.normalizeMailgunDeliveryEvent, 'function');

  const normalized = providerEvents.normalizeMailgunDeliveryEvent({
    event: 'delivered',
    id: 'mailgun-event-1',
    timestamp: 1787803200.25,
    recipient: 'client@example.test',
    message: {
      headers: {
        'message-id': 'message-1@sandbox.mailgun.org',
        subject: 'Secret invoice subject',
      },
    },
    'delivery-status': { code: 250, message: 'private provider response' },
  });

  assert.deepEqual(normalized, {
    provider: 'MAILGUN',
    providerEventId: 'mailgun-event-1',
    providerEventKey: normalized.providerEventKey,
    messageId: 'message-1@sandbox.mailgun.org',
    recipient: 'client@example.test',
    type: 'RECIPIENT_SERVER_ACCEPTED',
    occurredAt: new Date(1787803200.25 * 1000),
    failureCode: null,
  });
  assert.match(normalized.providerEventKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(normalized), /Secret invoice subject|private provider response/);
});

test('a temporary Mailgun failure remains a non-final delivery lifecycle event', () => {
  const normalized = providerEvents.normalizeMailgunDeliveryEvent({
    event: 'failed',
    severity: 'temporary',
    id: 'mailgun-event-temporary',
    timestamp: 1787803300,
    recipient: 'client@example.test',
    message: { headers: { 'message-id': '<message-1@sandbox.mailgun.org>' } },
  });

  assert.equal(normalized.type, 'TEMPORARY_DELIVERY_FAILURE');
  assert.equal(normalized.failureCode, 'MAILGUN_TEMPORARY_FAILURE');
  assert.equal(normalized.messageId, 'message-1@sandbox.mailgun.org');
});

test('a permanent Mailgun failure is normalized as final provider evidence', () => {
  const normalized = providerEvents.normalizeMailgunDeliveryEvent({
    event: 'failed',
    severity: 'permanent',
    id: 'mailgun-event-permanent',
    timestamp: 1787803400,
    recipient: 'client@example.test',
    message: { headers: { 'message-id': 'message-1@sandbox.mailgun.org' } },
  });

  assert.equal(normalized.type, 'PERMANENT_DELIVERY_FAILURE');
  assert.equal(normalized.failureCode, 'MAILGUN_PERMANENT_FAILURE');
});

function providerEventHarness() {
  const state = {
    attempt: {
      id: 'attempt-1',
      invoiceId: 'invoice-1',
      status: 'PROVIDER_ACCEPTED',
      provider: 'MAILGUN',
      providerMessageId: '<message-1@sandbox.mailgun.org>',
      recipient: 'client@example.test',
      acceptedAt: null,
      providerLifecycleStatus: 'PENDING',
      lastProviderEventAt: null,
      recipientServerAcceptedAt: null,
      temporaryFailureAt: null,
      permanentFailureAt: null,
    },
    events: [],
    attemptLookup: null,
  };
  const delegates = {
    invoiceDeliveryEvent: {
      findUnique: async ({ where }) => structuredClone(
        state.events.find(event => event.providerEventKey === where.providerEventKey) || null,
      ),
      create: async ({ data }) => {
        const created = { id: `event-${state.events.length + 1}`, ...structuredClone(data) };
        state.events.push(created);
        return structuredClone(created);
      },
    },
    invoiceDeliveryAttempt: {
      findFirst: async ({ where }) => {
        state.attemptLookup = structuredClone(where);
        return structuredClone(state.attempt);
      },
      updateMany: async ({ where, data }) => {
        if (where.OR && state.attempt.lastProviderEventAt
          && !(state.attempt.lastProviderEventAt < where.OR[1].lastProviderEventAt.lt)) {
          return { count: 0 };
        }
        Object.assign(state.attempt, structuredClone(data));
        return { count: 1 };
      },
    },
  };
  return {
    state,
    prisma: { ...delegates, $transaction: callback => callback(delegates) },
  };
}

const deliveredEvent = {
  event: 'delivered',
  id: 'mailgun-event-1',
  timestamp: 1787803200.25,
  recipient: 'client@example.test',
  message: { headers: { 'message-id': 'message-1@sandbox.mailgun.org' } },
};

test('a matched delivered event appends evidence and marks recipient-server acceptance', async () => {
  assert.equal(typeof providerEvents.reconcileInvoiceDeliveryProviderEvent, 'function');
  const { prisma, state } = providerEventHarness();

  const result = await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });

  assert.deepEqual(result, {
    duplicate: false,
    attemptId: 'attempt-1',
    invoiceId: 'invoice-1',
    type: 'RECIPIENT_SERVER_ACCEPTED',
    stateApplied: true,
  });
  assert.equal(state.attempt.providerLifecycleStatus, 'RECIPIENT_SERVER_ACCEPTED');
  assert.deepEqual(state.attempt.recipientServerAcceptedAt, new Date(1787803200.25 * 1000));
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].providerEventId, 'mailgun-event-1');
  assert.equal(state.events[0].status, 'RECIPIENT_SERVER_ACCEPTED');
  assert.equal('recipient' in state.events[0], false);
  assert.deepEqual(state.attemptLookup.providerMessageId.in, [
    'message-1@sandbox.mailgun.org',
    '<message-1@sandbox.mailgun.org>',
  ]);
});

test('replaying the same Mailgun provider event is idempotent', async () => {
  const { prisma, state } = providerEventHarness();

  await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });
  const replay = await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });

  assert.equal(replay.duplicate, true);
  assert.equal(replay.stateApplied, false);
  assert.equal(state.events.length, 1);
});

test('a non-redacted recipient mismatch is rejected before evidence is written', async () => {
  const { prisma, state } = providerEventHarness();

  await assert.rejects(
    providerEvents.reconcileInvoiceDeliveryProviderEvent({
      prisma,
      eventData: { ...deliveredEvent, recipient: 'different@example.test' },
    }),
    /recipient did not match/i,
  );
  assert.equal(state.events.length, 0);
});

test('an older provider event is retained without replacing newer lifecycle state', async () => {
  const { prisma, state } = providerEventHarness();
  await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });

  const older = await providerEvents.reconcileInvoiceDeliveryProviderEvent({
    prisma,
    eventData: {
      ...deliveredEvent,
      event: 'failed',
      severity: 'temporary',
      id: 'mailgun-event-older',
      timestamp: 1787803100,
    },
  });

  assert.equal(older.stateApplied, false);
  assert.equal(state.events.length, 2);
  assert.equal(state.attempt.providerLifecycleStatus, 'RECIPIENT_SERVER_ACCEPTED');
  assert.deepEqual(state.attempt.lastProviderEventAt, new Date(1787803200.25 * 1000));
});

test('a signed provider event resolves an earlier unknown submission outcome', async () => {
  const { prisma, state } = providerEventHarness();
  state.attempt.status = 'OUTCOME_UNKNOWN';
  state.attempt.failureCode = 'TRANSPORT_UNKNOWN';

  await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });

  assert.equal(state.attempt.status, 'PROVIDER_ACCEPTED');
  assert.equal(state.attempt.failureCode, null);
  assert.equal(state.attempt.acceptedAt, null);
});

test('a simultaneous duplicate recovers from the provider-event uniqueness boundary', async () => {
  const normalized = providerEvents.normalizeMailgunDeliveryEvent(deliveredEvent);
  const existing = {
    attemptId: 'attempt-1',
    invoiceId: 'invoice-1',
    status: 'RECIPIENT_SERVER_ACCEPTED',
  };
  const delegates = {
    invoiceDeliveryEvent: {
      findUnique: async () => null,
      create: async () => {
        const error = new Error('unique constraint detail');
        error.code = 'P2002';
        throw error;
      },
    },
    invoiceDeliveryAttempt: {
      findFirst: async () => ({
        id: 'attempt-1',
        invoiceId: 'invoice-1',
        recipient: 'client@example.test',
      }),
    },
  };
  const prisma = {
    ...delegates,
    $transaction: callback => callback(delegates),
    invoiceDeliveryEvent: {
      ...delegates.invoiceDeliveryEvent,
      findUnique: async ({ where }) => (
        where.providerEventKey === normalized.providerEventKey ? existing : null
      ),
    },
  };

  const result = await providerEvents.reconcileInvoiceDeliveryProviderEvent({ prisma, eventData: deliveredEvent });

  assert.deepEqual(result, {
    duplicate: true,
    attemptId: 'attempt-1',
    invoiceId: 'invoice-1',
    type: 'RECIPIENT_SERVER_ACCEPTED',
    stateApplied: false,
  });
});

test('delivery lifecycle evidence has constrained append-only persistence', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260827016000_invoice_delivery_provider_events/migration.sql',
    'utf8',
  );
  const attemptModel = schema.match(/model InvoiceDeliveryAttempt \{[\s\S]*?\n\}/)?.[0] || '';
  const eventModel = schema.match(/model InvoiceDeliveryEvent \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(attemptModel, /providerLifecycleStatus\s+String\s+@default\("PENDING"\)/);
  assert.match(attemptModel, /lastProviderEventAt\s+DateTime\?/);
  assert.match(attemptModel, /recipientServerAcceptedAt\s+DateTime\?/);
  assert.match(attemptModel, /temporaryFailureAt\s+DateTime\?/);
  assert.match(attemptModel, /permanentFailureAt\s+DateTime\?/);
  assert.match(eventModel, /providerEventKey\s+String\?\s+@unique/);
  assert.match(eventModel, /providerEventId\s+String\?/);
  assert.match(eventModel, /providerOccurredAt\s+DateTime\?/);
  assert.match(migration, /RECIPIENT_SERVER_ACCEPTED/);
  assert.match(migration, /TEMPORARY_DELIVERY_FAILURE/);
  assert.match(migration, /PERMANENT_DELIVERY_FAILURE/);
  assert.match(migration, /invoice_delivery_events_providerEventKey_key/);
  assert.match(migration, /Invoice delivery event rows are append-only/);
});

test('the public Mailgun route verifies signatures before reconciling delivery evidence', async () => {
  assert.equal(typeof deliveryRoutes.default, 'function');
  const { prisma, state } = providerEventHarness();
  const signingKey = 'sandbox-signing-key';
  const timestamp = '1787803200';
  const token = 'b'.repeat(50);
  const signature = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
  const app = Fastify();
  app.decorate('prisma', prisma);
  await app.register(deliveryRoutes.default, {
    signingKey,
    now: () => new Date('2026-08-27T04:01:00.000Z'),
  });

  const accepted = await app.inject({
    method: 'POST',
    url: '/mailgun/invoice-delivery',
    payload: {
      signature: { timestamp, token, signature },
      'event-data': deliveredEvent,
    },
  });
  const invalid = await app.inject({
    method: 'POST',
    url: '/mailgun/invoice-delivery',
    payload: {
      signature: { timestamp, token, signature: '0'.repeat(64) },
      'event-data': { ...deliveredEvent, id: 'must-not-write' },
    },
  });

  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), {
    received: true,
    duplicate: false,
    type: 'RECIPIENT_SERVER_ACCEPTED',
  });
  assert.equal(invalid.statusCode, 401);
  assert.deepEqual(invalid.json(), { error: 'Invalid Mailgun webhook signature' });
  assert.equal(state.events.length, 1);
  await app.close();
});

test('a transient persistence failure returns a retryable server error without leaking details', async () => {
  const signingKey = 'sandbox-signing-key';
  const timestamp = '1787803200';
  const token = 'c'.repeat(50);
  const signature = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
  const app = Fastify();
  app.decorate('prisma', {
    $transaction: async () => { throw new Error('private database connection detail'); },
  });
  await app.register(deliveryRoutes.default, {
    signingKey,
    now: () => new Date('2026-08-27T04:01:00.000Z'),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/mailgun/invoice-delivery',
    payload: {
      signature: { timestamp, token, signature },
      'event-data': deliveredEvent,
    },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Invoice delivery event could not be recorded' });
  assert.doesNotMatch(response.body, /private database connection detail/);
  await app.close();
});

test('the canonical webhook registrar exposes the Mailgun invoice delivery route', () => {
  const routes = readFileSync('src/routes/webhook.routes.js', 'utf8');

  assert.match(routes, /import mailgunInvoiceDeliveryRoutes from '.\/mailgun-invoice-delivery\.routes\.js'/);
  assert.match(routes, /register\(mailgunInvoiceDeliveryRoutes\)/);
});

test('staff invoice history distinguishes recipient-server acceptance from inbox delivery', () => {
  const detail = readFileSync('web/src/pages/InvoiceDetail.jsx', 'utf8');

  assert.match(detail, /attempt\.providerLifecycleStatus/);
  assert.match(detail, /Accepted by recipient mail server/);
  assert.match(detail, /Temporary delivery failure/);
  assert.match(detail, /Permanent delivery failure/);
  assert.match(detail, /This does not prove the person opened or read the email/);
  assert.doesNotMatch(detail, /Delivered to inbox/);
});

test('operating documentation keeps provider-event code separate from sandbox proof', () => {
  const runbook = readFileSync('docs/invoice-email-sandbox-validation.md', 'utf8');
  const productStatus = readFileSync('docs/product-status.md', 'utf8');

  assert.match(runbook, /POST `\/api\/webhooks\/mailgun\/invoice-delivery`/);
  assert.match(runbook, /delivered`, `temporary_fail`, and `permanent_fail`/);
  assert.match(runbook, /does not prove inbox placement or human reading/i);
  assert.match(runbook, /webhook has not been configured or exercised/i);
  assert.match(productStatus, /signed post-acceptance Mailgun events/i);
  assert.doesNotMatch(productStatus, /provider webhooks for post-acceptance email events[^.]*pending/i);
});
