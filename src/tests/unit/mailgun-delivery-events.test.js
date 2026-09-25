import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it, test } from 'node:test';
import Fastify from 'fastify';
import env from '../../config/env.js';
import mailgunRoutes from '../../routes/mailgun.routes.js';
import {
  classifyMailgunEvent,
  deliveryFieldsFromSend,
  mailgunTrackingFields,
  recordDeliveryEvent,
  verifyMailgunSignature,
  withDeliveryState,
} from '../../services/mailgun-delivery.service.js';
import { buildInvoiceDeliveryEmail } from '../../services/email.service.js';

const KEY = 'test-webhook-signing-key';

function sign(timestamp, token, key = KEY) {
  return crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
}

function signatureBlock({ ageSeconds = 0, token = crypto.randomUUID(), key = KEY } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  return { timestamp, token, signature: sign(timestamp, token, key) };
}

function eventData(overrides = {}) {
  return {
    event: 'failed',
    severity: 'permanent',
    reason: 'bounce',
    timestamp: 1_790_000_000,
    'delivery-status': { code: 550, description: 'mailbox does not exist' },
    message: { headers: { 'message-id': 'msg-1@mg.ashbi.ca' } },
    'user-variables': { 'ashbi-document-type': 'invoice', 'ashbi-document-id': 'inv-1' },
    ...overrides,
  };
}

function fakePrisma(documents = {}) {
  const receipts = new Map();
  const docs = { invoice: {}, proposal: {}, contract: {}, estimate: {}, ...documents };
  const delegate = (name) => ({
    findUnique: async ({ where }) => (docs[name][where.id] ? { ...docs[name][where.id] } : null),
    updateMany: async ({ where, data }) => {
      const row = docs[name][where.id];
      if (!row || (row.deliveryMessageId ?? null) !== (where.deliveryMessageId ?? null)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  });
  return {
    docs,
    receipts,
    invoice: delegate('invoice'),
    proposal: delegate('proposal'),
    contract: delegate('contract'),
    estimate: delegate('estimate'),
    mailgunWebhookReceipt: {
      create: async ({ data }) => {
        if (receipts.has(data.token)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        receipts.set(data.token, data);
        return data;
      },
      deleteMany: async ({ where }) => {
        if (where.token) receipts.delete(where.token);
        return { count: 0 };
      },
    },
  };
}

describe('Mailgun webhook signature verification', () => {
  it('accepts a fresh, correctly signed payload', () => {
    assert.deepEqual(verifyMailgunSignature(signatureBlock(), KEY), { ok: true });
  });

  it('rejects a payload signed with another key', () => {
    assert.equal(verifyMailgunSignature(signatureBlock({ key: 'attacker-key' }), KEY).reason, 'invalid');
  });

  it('rejects a tampered token and a malformed signature', () => {
    const block = signatureBlock();
    assert.equal(verifyMailgunSignature({ ...block, token: `${block.token}x` }, KEY).reason, 'invalid');
    assert.equal(verifyMailgunSignature({ ...block, signature: 'not-hex' }, KEY).reason, 'invalid');
    assert.equal(verifyMailgunSignature({ ...block, signature: block.signature.slice(0, 32) }, KEY).reason, 'invalid');
  });

  it('rejects a correctly signed payload older than 15 minutes', () => {
    assert.equal(verifyMailgunSignature(signatureBlock({ ageSeconds: 16 * 60 }), KEY).reason, 'stale');
    assert.deepEqual(verifyMailgunSignature(signatureBlock({ ageSeconds: 14 * 60 }), KEY), { ok: true });
  });

  it('fails closed without a key or signature fields', () => {
    assert.equal(verifyMailgunSignature(signatureBlock(), undefined).reason, 'not_configured');
    assert.equal(verifyMailgunSignature(undefined, KEY).reason, 'missing');
  });
});

test('Mailgun events map to delivery statuses; temporary failures are ignored', () => {
  assert.equal(classifyMailgunEvent({ event: 'delivered' }), 'DELIVERED');
  assert.equal(classifyMailgunEvent({ event: 'failed', severity: 'permanent', reason: 'bounce' }), 'BOUNCED');
  assert.equal(classifyMailgunEvent({ event: 'failed', severity: 'permanent', reason: 'generic' }), 'FAILED');
  assert.equal(classifyMailgunEvent({ event: 'failed', severity: 'temporary' }), null);
  assert.equal(classifyMailgunEvent({ event: 'complained' }), 'COMPLAINED');
  assert.equal(classifyMailgunEvent({ event: 'opened' }), null);
});

test('outgoing document emails carry correlating Mailgun custom variables', () => {
  assert.deepEqual(mailgunTrackingFields({ documentType: 'contract', documentId: 'c-1' }), {
    'v:ashbi-document-type': 'contract',
    'v:ashbi-document-id': 'c-1',
  });
  assert.deepEqual(mailgunTrackingFields({ documentType: 'user', documentId: 'u-1' }), {});
  const invoiceEmail = buildInvoiceDeliveryEmail({ to: 'a@b.test', invoiceNumber: 'INV-1', total: 1, viewUrl: 'https://x', invoiceId: 'inv-1' });
  assert.deepEqual(invoiceEmail.tracking, { documentType: 'invoice', documentId: 'inv-1' });
});

test('send results are recorded truthfully: provider rejection is FAILED, not sent', () => {
  const accepted = deliveryFieldsFromSend({ ok: true, id: '<msg-1@mg.ashbi.ca>' });
  assert.equal(accepted.deliveryStatus, 'ACCEPTED');
  assert.equal(accepted.deliveryMessageId, 'msg-1@mg.ashbi.ca');
  const rejected = deliveryFieldsFromSend({ ok: false, error: 'Forbidden' });
  assert.equal(rejected.deliveryStatus, 'FAILED');
  assert.equal(rejected.deliveryError, 'Forbidden');
  assert.equal(withDeliveryState({ deliveryStatus: 'BOUNCED' }).deliveryFailed, true);
  assert.equal(withDeliveryState({ deliveryStatus: 'DELIVERED' }).deliveryFailed, false);
});

describe('recording delivery events on documents', () => {
  it('marks a bounced invoice with the bounce diagnostic', async () => {
    const prisma = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: 'msg-1@mg.ashbi.ca', deliveryStatus: 'ACCEPTED', sentAt: new Date() } } });
    const result = await recordDeliveryEvent(prisma, eventData());
    assert.equal(result.recorded, true);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'BOUNCED');
    assert.match(prisma.docs.invoice['inv-1'].deliveryError, /550.*mailbox does not exist/);
  });

  it('records delivered and complaint events on each document type', async () => {
    for (const type of ['proposal', 'contract', 'estimate']) {
      const prisma = fakePrisma({ [type]: { d1: { id: 'd1', deliveryMessageId: 'msg-1@mg.ashbi.ca', deliveryStatus: 'ACCEPTED' } } });
      const vars = { 'ashbi-document-type': type, 'ashbi-document-id': 'd1' };
      await recordDeliveryEvent(prisma, eventData({ event: 'delivered', 'user-variables': vars }));
      assert.equal(prisma.docs[type].d1.deliveryStatus, 'DELIVERED');
      assert.equal(prisma.docs[type].d1.deliveryError, null);
      await recordDeliveryEvent(prisma, eventData({ event: 'complained', 'user-variables': vars }));
      assert.equal(prisma.docs[type].d1.deliveryStatus, 'COMPLAINED');
    }
  });

  it('ignores events for an older message after the document was re-sent', async () => {
    const prisma = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: 'msg-2@mg.ashbi.ca', deliveryStatus: 'DELIVERED' } } });
    const result = await recordDeliveryEvent(prisma, eventData());
    assert.deepEqual(result, { recorded: false, reason: 'stale_message' });
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'DELIVERED');
  });

  it('does not let a late delivered event erase a bounce', async () => {
    const prisma = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: 'msg-1@mg.ashbi.ca', deliveryStatus: 'BOUNCED' } } });
    const result = await recordDeliveryEvent(prisma, eventData({ event: 'delivered' }));
    assert.equal(result.reason, 'superseded');
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'BOUNCED');
  });

  it('ignores events that cannot be tied to the stored message id', async () => {
    const noHeaders = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: 'msg-1@mg.ashbi.ca', deliveryStatus: 'ACCEPTED' } } });
    const withoutId = await recordDeliveryEvent(noHeaders, eventData({ message: {} }));
    assert.deepEqual(withoutId, { recorded: false, reason: 'uncorrelated_message' });
    assert.equal(noHeaders.docs.invoice['inv-1'].deliveryStatus, 'ACCEPTED');

    // A re-send that failed stores no message id; a late bounce for the
    // earlier message must not overwrite that FAILED outcome.
    const failedResend = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: null, deliveryStatus: 'FAILED', deliveryError: 'Forbidden' } } });
    const lateBounce = await recordDeliveryEvent(failedResend, eventData({ event: 'complained' }));
    assert.deepEqual(lateBounce, { recorded: false, reason: 'uncorrelated_message' });
    assert.equal(failedResend.docs.invoice['inv-1'].deliveryStatus, 'FAILED');
    assert.equal(failedResend.docs.invoice['inv-1'].deliveryError, 'Forbidden');
  });

  it('ignores events without document variables', async () => {
    const prisma = fakePrisma();
    assert.equal((await recordDeliveryEvent(prisma, eventData({ 'user-variables': {} }))).reason, 'uncorrelated');
    assert.equal((await recordDeliveryEvent(prisma, eventData({ 'user-variables': { 'ashbi-document-type': 'user', 'ashbi-document-id': 'x' } }))).reason, 'uncorrelated');
  });
});

describe('POST /api/mailgun/events', () => {
  let app;
  let prisma;
  const originalKey = env.mailgunWebhookSigningKey;

  before(async () => {
    env.mailgunWebhookSigningKey = KEY;
    prisma = fakePrisma({ invoice: { 'inv-1': { id: 'inv-1', deliveryMessageId: 'msg-1@mg.ashbi.ca', deliveryStatus: 'ACCEPTED' } } });
    app = Fastify({ logger: false });
    app.decorate('authenticate', async () => {});
    app.decorate('prisma', prisma);
    await app.register(mailgunRoutes, { prefix: '/api/mailgun' });
    await app.ready();
  });

  after(async () => {
    env.mailgunWebhookSigningKey = originalKey;
    await app.close();
  });

  const post = payload => app.inject({ method: 'POST', url: '/api/mailgun/events', payload });

  it('rejects an invalid signature without touching the document', async () => {
    const response = await post({ signature: signatureBlock({ key: 'wrong' }), 'event-data': eventData() });
    assert.equal(response.statusCode, 401);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'ACCEPTED');
  });

  it('rejects a stale signature', async () => {
    const response = await post({ signature: signatureBlock({ ageSeconds: 3600 }), 'event-data': eventData() });
    assert.equal(response.statusCode, 406);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'ACCEPTED');
  });

  it('records a signed bounce and rejects a replay of the same token', async () => {
    const signature = signatureBlock();
    const first = await post({ signature, 'event-data': eventData() });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().recorded, true);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'BOUNCED');

    const replay = await post({ signature, 'event-data': eventData({ event: 'complained' }) });
    assert.equal(replay.statusCode, 406);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'BOUNCED');
  });

  it('acknowledges but ignores a signed event with no message id', async () => {
    const response = await post({ signature: signatureBlock(), 'event-data': eventData({ event: 'complained', message: {} }) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().recorded, false);
    assert.equal(prisma.docs.invoice['inv-1'].deliveryStatus, 'BOUNCED');
  });

  it('fails closed when the signing key is not configured', async () => {
    env.mailgunWebhookSigningKey = undefined;
    try {
      const response = await post({ signature: signatureBlock(), 'event-data': eventData() });
      assert.equal(response.statusCode, 503);
    } finally {
      env.mailgunWebhookSigningKey = KEY;
    }
  });
});
