import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { sendGmailWithReceipt, readGmailSendReceipt, reconcileGmailSendReceipt } from '../../services/gmail-send.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
// Inject a local storage failure inside the real interactive transaction.
// All transports below are fixtures; this test never calls Gmail or OAuth.
function fault(client, { auditAction, messageCreate = false, beforeReceiptCreate }) {
  return new Proxy(client, { get(target, key) {
    if (key === '$transaction') return (fn, ...args) => target.$transaction(tx => fn(fault(tx, { auditAction, messageCreate, beforeReceiptCreate })), ...args);
    if (key === 'auditEvent' || key === 'message' || key === 'gmailSendReceipt') return new Proxy(target[key], { get(delegate, method) {
      if (method === 'create') return async args => {
        if (key === 'gmailSendReceipt' && beforeReceiptCreate) await beforeReceiptCreate();
        if (key === 'auditEvent' && args.data.action === auditAction || key === 'message' && messageCreate) throw Error('Synthetic local write failure');
        return delegate.create(args);
      };
      const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value;
    } });
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('durable Gmail intents enforce PostgreSQL claims, unknown outcome fences and atomic repair without provider calls', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 150_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `gmail-receipt-${key}-${randomUUID()}`);
  const users = [], clients = [], threadIds = [];
  let providerCalls = 0;
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Gmail receipt QA' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Receipt staff', password: randomUUID(), role: 'ADMIN' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Receipt client' } }));
    }
    async function draft(index) {
      const thread = await raw.thread.create({ data: { clientId: clients[0].id, assignedToId: users[0].id, subject: `Receipt thread ${index}` } });
      threadIds.push(thread.id);
      const response = await raw.response.create({ data: { threadId: thread.id, draftedById: users[0].id, subject: `Approved subject ${index}`, body: `Approved body ${index}`, status: 'APPROVED' } });
      return { idempotencyKey: randomUUID(), to: 'client@example.test', subject: response.subject, body: response.body, hubThreadId: thread.id, responseId: response.id };
    }
    const prepare = async () => ({ mailbox: 'verified@example.test', send: async snapshot => {
      providerCalls++;
      const receipt = await raw.gmailSendReceipt.findFirst({ where: { organizationId: orgs[0], snapshot: { path: ['responseId'], equals: snapshot.responseId }, status: 'DISPATCHING' } });
      assert.ok(receipt, 'provider request must follow committed durable claim');
      assert.equal(await raw.auditEvent.count({ where: { entityId: receipt.id, action: 'gmail_send.claimed' } }), 1);
      return { id: `gmail-${randomUUID()}`, threadId: 'gmail-thread' };
    } });
    const first = await draft('concurrent-identical');
    const results = await Promise.all([
      sendGmailWithReceipt(raw, users[0], first, { prepare }),
      sendGmailWithReceipt(raw, users[0], first, { prepare }),
    ]);
    assert.equal(providerCalls, 1); assert.ok(results.every(result => [200, 202].includes(result.statusCode)));
    const completed = await reconcileGmailSendReceipt(raw, users[0], first.idempotencyKey);
    assert.equal(completed.body.status, 'COMPLETED'); assert.equal(providerCalls, 1);
    assert.equal(await raw.message.count({ where: { threadId: first.hubThreadId } }), 1);
    assert.equal((await raw.thread.findUnique({ where: { id: first.hubThreadId } })).status, 'AWAITING_RESPONSE');
    assert.equal((await raw.response.findUnique({ where: { id: first.responseId } })).status, 'SENT');
    await assert.rejects(sendGmailWithReceipt(raw, users[0], { ...first, body: 'Changed' }, { prepare }), { code: 'GMAIL_SEND_CONFLICT' });
    await assert.rejects(sendGmailWithReceipt(raw, users[0], { ...first, idempotencyKey: randomUUID() }, { prepare }), { code: 'GMAIL_RESPONSE_CHANGED' });
    const read = await readGmailSendReceipt(raw, users[0], first.idempotencyKey);
    assert.doesNotMatch(JSON.stringify(read), /Approved body|client@example|snapshot|payloadHash|mailbox/);
    await assert.rejects(readGmailSendReceipt(raw, users[1], first.idempotencyKey), { statusCode: 404 });
    await assert.rejects(raw.gmailSendReceipt.update({ where: { id: read.body.receiptId }, data: { status: 'DISPATCHING' } }));
    await assert.rejects(raw.gmailSendReceipt.update({ where: { id: read.body.receiptId }, data: { mailbox: 'different@example.test' } }));
    await assert.rejects(raw.gmailSendReceipt.create({ data: { organizationId: orgs[1], userId: users[0].id, idempotencyKey: randomUUID(), payloadHash: 'a'.repeat(64), mailbox: 'verified@example.test', snapshot: { to: first.to, subject: first.subject, body: first.body, hubThreadId: first.hubThreadId }, status: 'DISPATCHING' } }));

    const differentKeys = await draft('concurrent-different'); const beforeDifferent = providerCalls;
    const collision = await Promise.allSettled([
      sendGmailWithReceipt(raw, users[0], differentKeys, { prepare }),
      sendGmailWithReceipt(raw, users[0], { ...differentKeys, idempotencyKey: randomUUID() }, { prepare }),
    ]);
    assert.equal(collision.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(collision.find(result => result.status === 'rejected').reason.statusCode, 409);
    assert.equal(providerCalls - beforeDifferent, 1);

    const timeout = await draft('unknown'); let unknownCalls = 0;
    const unknownPrepare = async () => ({ mailbox: 'verified@example.test', send: async () => { unknownCalls++; throw Error('Synthetic provider timeout'); } });
    assert.equal((await sendGmailWithReceipt(raw, users[0], timeout, { prepare: unknownPrepare })).body.status, 'UNKNOWN');
    await sendGmailWithReceipt(raw, users[0], timeout, { prepare: unknownPrepare });
    await reconcileGmailSendReceipt(raw, users[0], timeout.idempotencyKey);
    assert.equal(unknownCalls, 1); assert.equal(await raw.message.count({ where: { threadId: timeout.hubThreadId } }), 0);
    await assert.rejects(sendGmailWithReceipt(raw, users[0], { ...timeout, idempotencyKey: randomUUID() }, { prepare }), { code: 'GMAIL_SEND_CONFLICT' });

    const pending = await draft('repair'); const beforeRepair = providerCalls;
    assert.equal((await sendGmailWithReceipt(fault(raw, { messageCreate: true }), users[0], pending, { prepare })).body.status, 'ACCEPTED_PENDING_RECORD');
    assert.equal(await raw.message.count({ where: { threadId: pending.hubThreadId } }), 0);
    assert.equal((await raw.response.findUnique({ where: { id: pending.responseId } })).status, 'APPROVED');
    const auditCount = await raw.auditEvent.count({ where: { organizationId: orgs[0] } });
    assert.equal((await readGmailSendReceipt(raw, users[0], pending.idempotencyKey)).body.status, 'ACCEPTED_PENDING_RECORD');
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgs[0] } }), auditCount);
    const repairs = await Promise.all([reconcileGmailSendReceipt(raw, users[0], pending.idempotencyKey), reconcileGmailSendReceipt(raw, users[0], pending.idempotencyKey)]);
    assert.ok(repairs.every(result => result.body.status === 'COMPLETED'));
    assert.equal(providerCalls - beforeRepair, 1); assert.equal(await raw.message.count({ where: { threadId: pending.hubThreadId } }), 1);

    const fence = await draft('acceptance-write-failure'); const beforeFence = providerCalls;
    assert.equal((await sendGmailWithReceipt(fault(raw, { auditAction: 'gmail_send.accepted' }), users[0], fence, { prepare })).body.status, 'DISPATCHING');
    await sendGmailWithReceipt(raw, users[0], fence, { prepare }); await reconcileGmailSendReceipt(raw, users[0], fence.idempotencyKey);
    assert.equal(providerCalls - beforeFence, 1); assert.equal(await raw.message.count({ where: { threadId: fence.hubThreadId } }), 0);

    const rollback = await draft('claim-audit-rollback'); const beforeRollback = providerCalls;
    await assert.rejects(sendGmailWithReceipt(fault(raw, { auditAction: 'gmail_send.claimed' }), users[0], rollback, { prepare }), { code: 'GMAIL_SEND_AUDIT_UNAVAILABLE' });
    assert.equal(await raw.gmailSendReceipt.count({ where: { organizationId: orgs[0], idempotencyKey: rollback.idempotencyKey } }), 0);
    assert.equal(providerCalls, beforeRollback);
    // Reassign after the service's authorization read but before receipt INSERT.
    // The locked SQL check must refuse stale TEAM authority before dispatch.
    const reassigned = await draft('reassigned-before-claim'); const beforeReassignment = providerCalls;
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'TEAM' } });
    await assert.rejects(sendGmailWithReceipt(fault(raw, {
      beforeReceiptCreate: () => raw.thread.update({ where: { id: reassigned.hubThreadId }, data: { assignedToId: null } }),
    }), { ...users[0], role: 'TEAM' }, reassigned, { prepare }));
    assert.equal(providerCalls, beforeReassignment);
    assert.equal(await raw.gmailSendReceipt.count({ where: { organizationId: orgs[0], idempotencyKey: reassigned.idempotencyKey } }), 0);
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'ADMIN' } });
    const audits = await raw.auditEvent.findMany({ where: { organizationId: orgs[0], action: { startsWith: 'gmail_send.' } } });
    assert.doesNotMatch(JSON.stringify(audits.map(row => row.metadata)), /Approved body|client@example|snapshot|tokens/);
    await raw.user.update({ where: { id: users[0].id }, data: { isActive: false } });
    await assert.rejects(readGmailSendReceipt(raw, users[0], first.idempotencyKey), { code: 'ROLE_DENIED' });
  } finally {
    await raw.gmailSendReceipt.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.response.deleteMany({ where: { threadId: { in: threadIds } } });
    await raw.message.deleteMany({ where: { threadId: { in: threadIds } } });
    await raw.thread.deleteMany({ where: { id: { in: threadIds } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
